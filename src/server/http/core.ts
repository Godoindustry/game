/**
 * Infra HTTP independente de framework (Request/Response da Web API).
 * O Next só encaminha /api/* para `handleApi`; os testes chamam `handleApi` direto.
 */
import { ZodError } from "zod";
import { AppError } from "../services/errors";
import { getConfig, isProduction } from "../config";
import { userFromSessionToken, type SessionUser } from "../services/auth";
import { newToken } from "../services/ids";
import { getDb } from "../db/database";
import { securityLog } from "../services/audit";

export const SESSION_COOKIE = "ls_session";
export const CSRF_COOKIE = "ls_csrf";
export const CSRF_HEADER = "x-csrf-token";

// ---------- Cookies ----------
export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { httpOnly?: boolean; maxAgeSec?: number; path?: string; sameSite?: "Lax" | "Strict" } = {},
): string {
  const secure = getConfig().COOKIE_SECURE ?? isProduction();
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
    `SameSite=${opts.sameSite ?? "Lax"}`,
    opts.httpOnly !== false ? "HttpOnly" : "",
    secure ? "Secure" : "",
    opts.maxAgeSec !== undefined ? `Max-Age=${opts.maxAgeSec}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

// ---------- Contexto ----------
export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  cookies: Record<string, string>;
  ip: string | null;
  user: SessionUser | null;
  setCookies: string[];
  body: <T = unknown>() => Promise<T>;
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? null;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

export interface RouteOpts {
  auth?: boolean; // exige sessão
  master?: boolean; // exige ADM MASTER
  rate?: "auth" | "api" | "action";
  raw?: boolean; // handler devolve Response
}

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  opts: RouteOpts;
}

// ---------- Rate limiting (tabela rate_limits: vale entre instâncias serverless) ----------
const LIMITS = { auth: { max: 20, windowMs: 15 * 60_000 }, api: { max: 240, windowMs: 60_000 }, action: { max: 30, windowMs: 60_000 } };

/** Janela fixa por chave. Um único UPSERT atômico conta a requisição. */
export async function rateLimited(kind: keyof typeof LIMITS, key: string): Promise<boolean> {
  const { max, windowMs } = LIMITS[kind];
  const now = Date.now();
  const cutoff = now - windowMs;
  const row = await getDb().get<{ count: number }>(
    `INSERT INTO rate_limits(key, window_start, count) VALUES(?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < ? THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < ? THEN ? ELSE rate_limits.window_start END
     RETURNING count`,
    `${kind}:${key}`, now, cutoff, cutoff, now,
  );
  if (Math.random() < 0.01) await getDb().run("DELETE FROM rate_limits WHERE window_start < ?", now - 3600_000);
  return Number(row?.count ?? 0) > max;
}

export async function resetRateLimits(): Promise<void> {
  await getDb().run("DELETE FROM rate_limits");
}

// ---------- Respostas ----------
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

export function jsonResponse(status: number, data: unknown, setCookies: string[] = []): Response {
  const headers = new Headers(SECURITY_HEADERS);
  for (const c of setCookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(err: unknown, setCookies: string[]): Response {
  if (err instanceof AppError) return jsonResponse(err.status, { error: err.message, code: err.code }, setCookies);
  if (err instanceof ZodError) {
    const i = err.issues[0];
    const field = i.path.join(".");
    return jsonResponse(400, { error: `${field ? `${field}: ` : ""}${i.message}`, code: "validacao" }, setCookies);
  }
  if (err instanceof SyntaxError) return jsonResponse(400, { error: "JSON inválido.", code: "json" }, setCookies);
  console.error("[api] erro inesperado", err);
  return jsonResponse(500, { error: "Erro interno. Tente novamente.", code: "interno" }, setCookies);
}

// ---------- Roteador ----------
export class Router {
  private routes: Route[] = [];
  add(method: string, path: string, handler: Handler, opts: RouteOpts = {}): this {
    this.routes.push({ method, parts: path.split("/").filter(Boolean), handler, opts });
    return this;
  }
  get = (p: string, h: Handler, o?: RouteOpts) => this.add("GET", p, h, o);
  post = (p: string, h: Handler, o?: RouteOpts) => this.add("POST", p, h, o);
  patch = (p: string, h: Handler, o?: RouteOpts) => this.add("PATCH", p, h, o);
  delete = (p: string, h: Handler, o?: RouteOpts) => this.add("DELETE", p, h, o);

  private match(method: string, pathname: string): { route: Route; params: Record<string, string> } | "method" | null {
    const parts = pathname.split("/").filter(Boolean);
    let methodMismatch = false;
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const ok = r.parts.every((p, i) => {
        if (p.startsWith(":")) {
          if (!/^[A-Za-z0-9_-]{1,100}$/.test(parts[i])) return false;
          params[p.slice(1)] = parts[i];
          return true;
        }
        return p === parts[i];
      });
      if (!ok) continue;
      if (r.method !== method) {
        methodMismatch = true;
        continue;
      }
      return { route: r, params };
    }
    return methodMismatch ? "method" : null;
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const setCookies: string[] = [];
    try {
      const m = this.match(req.method, url.pathname);
      if (m === null) return jsonResponse(404, { error: "Rota não encontrada.", code: "rota" });
      if (m === "method") return jsonResponse(405, { error: "Método não permitido.", code: "metodo" });
      const { route, params } = m;
      const cookies = parseCookies(req);
      const ip = clientIp(req);

      if (route.opts.rate && (await rateLimited(route.opts.rate, `${ip ?? "local"}`))) {
        await securityLog("rate_limited", null, { path: url.pathname }, ip);
        return jsonResponse(429, { error: "Muitas requisições. Aguarde um pouco.", code: "limite" });
      }

      // CSRF: métodos que alteram estado exigem Origin coerente + token double-submit.
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin && origin !== url.origin && origin !== new URL(getConfig().APP_URL).origin) {
          return jsonResponse(403, { error: "Origem não permitida.", code: "csrf" });
        }
        const header = req.headers.get(CSRF_HEADER);
        if (!header || !cookies[CSRF_COOKIE] || header !== cookies[CSRF_COOKIE]) {
          return jsonResponse(403, { error: "Token CSRF ausente ou inválido. Recarregue a página.", code: "csrf" });
        }
      }

      const user = await userFromSessionToken(cookies[SESSION_COOKIE]);
      if ((route.opts.auth || route.opts.master) && !user) {
        return jsonResponse(401, { error: "Faça login para continuar.", code: "nao_autenticado" });
      }
      if (route.opts.master && user?.role !== "master") {
        await securityLog("admin_denied", user?.id ?? null, { path: url.pathname }, ip);
        return jsonResponse(403, { error: "Área restrita ao ADM MASTER.", code: "proibido" });
      }

      let parsedBody: unknown;
      const ctx: Ctx = {
        req, url, params, cookies, ip, user, setCookies,
        body: async <T,>() => {
          if (parsedBody === undefined) {
            const text = await req.text();
            if (text.length > 20_000) throw new AppError(413, "Corpo grande demais.", "payload");
            parsedBody = text ? JSON.parse(text) : {};
          }
          return parsedBody as T;
        },
      };
      const result = await route.handler(ctx);
      if (route.opts.raw && result instanceof Response) {
        for (const c of setCookies) result.headers.append("Set-Cookie", c);
        return result;
      }
      return jsonResponse(200, result ?? { ok: true }, setCookies);
    } catch (err) {
      return errorResponse(err, setCookies);
    }
  }
}

export function sessionCookie(token: string): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAgeSec: getConfig().SESSION_TTL_HOURS * 3600 });
}
export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAgeSec: 0 });
}
export function csrfCookie(token = newToken(24)): { cookie: string; token: string } {
  // Não-httpOnly de propósito: o frontend lê e reenvia no cabeçalho (double-submit).
  return { cookie: serializeCookie(CSRF_COOKIE, token, { httpOnly: false, maxAgeSec: 7 * 24 * 3600, sameSite: "Strict" }), token };
}
