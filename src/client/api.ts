"use client";
/**
 * Cliente HTTP do frontend. Envia o token CSRF (double-submit) em toda mutação
 * e converte erros da API em ApiError com mensagem legível.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

let csrf: string | null = null;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function ensureCsrf(): Promise<string> {
  csrf = readCookie("ls_csrf") ?? csrf;
  if (csrf) return csrf;
  const r = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  const data = (await r.json()) as { csrfToken: string };
  csrf = data.csrfToken;
  return csrf;
}

export async function api<T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["x-csrf-token"] = await ensureCsrf();
    headers["content-type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor. Tentando de novo em instantes…", "rede");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 403 && data?.code === "csrf") csrf = null;
    throw new ApiError(res.status, data?.error ?? "Erro inesperado.", data?.code);
  }
  return data as T;
}

export const newIdempotencyKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
