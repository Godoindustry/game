/**
 * Autenticação: cadastro, login, sessões, recuperação de senha e Google OAuth.
 *
 * Sessões: token aleatório de 256 bits no cookie httpOnly; o banco guarda só o SHA-256.
 * Força bruta: 5 falhas por e-mail em 15 min bloqueiam o e-mail; 30 falhas por IP bloqueiam o IP.
 * Enumeração: login e "esqueci a senha" respondem igual para e-mails existentes ou não.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { getDb, nowIso } from "../db/database";
import { getConfig } from "../config";
import { hashPassword, verifyPassword, DUMMY_HASH } from "./password";
import { newId, newToken, sha256 } from "./ids";
import { badRequest, conflict, forbidden, tooMany, unauthorized, AppError } from "./errors";
import { tryGrantEarlyAdopter, isPremium } from "./premium";
import { securityLog } from "./audit";
import { getMailer } from "./mailer";
import { unlockAchievement } from "./achievements";

export const LOCK_WINDOW_MIN = 15;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_IP = 30;

export const passwordSchema = z
  .string()
  .min(8, "A senha precisa de pelo menos 8 caracteres.")
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "A senha precisa ter letras e números.");

const emailSchema = z.email("E-mail inválido.").max(254).transform((e) => e.trim().toLowerCase());
const nameSchema = z
  .string()
  .max(40)
  .transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, "").trim())
  .pipe(z.string().min(2, "Nome muito curto."));

// strictObject: campos extras (ex.: "role": "master") são rejeitados, não ignorados.
export const registerSchema = z.strictObject({ email: emailSchema, password: passwordSchema, displayName: nameSchema });
// Login aceita e-mail ou nome de usuário (só contas criadas pelo servidor têm nome de usuário).
const identifierSchema = z
  .string()
  .trim()
  .max(254)
  .transform((v) => v.toLowerCase())
  .refine((v) => (v.includes("@") ? z.email().safeParse(v).success : /^[a-z0-9_.-]{3,32}$/.test(v)), "E-mail ou usuário inválido.");
export const loginSchema = z.strictObject({ email: identifierSchema, password: z.string().min(1).max(128) });

export interface SessionUser {
  id: string;
  email: string;
  role: "user" | "master";
  displayName: string;
  avatar: string;
  premium: boolean;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  role: "user" | "master";
  status: "active" | "banned";
}

export async function register(input: unknown, ip: string | null): Promise<SessionUser> {
  const data = registerSchema.parse(input);
  const db = getDb();
  const id = newId();
  const now = nowIso();
  const passwordHash = hashPassword(data.password); // fora da transação (CPU)
  await db.tx(async () => {
    if (await db.get("SELECT 1 FROM users WHERE email = ?", data.email)) throw conflict("Este e-mail já está cadastrado.", "email_em_uso");
    await db.run(
      "INSERT INTO users(id,email,password_hash,role,status,created_at,updated_at) VALUES(?,?,?,'user','active',?,?)",
      id, data.email, passwordHash, now, now,
    );
    await db.run("INSERT INTO profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)", id, data.displayName, now, now);
    const slot = await tryGrantEarlyAdopter(id);
    if (slot) await unlockAchievement(id, "pioneiro", null);
  });
  await securityLog("register", id, {}, ip);
  return (await loadSessionUser(id))!;
}

async function recentFailures(column: "email" | "ip", value: string): Promise<number> {
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60_000).toISOString();
  const row = await getDb().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM login_attempts WHERE ${column} = ? AND success = 0 AND created_at >= ?`,
    value, since,
  );
  return Number(row?.n ?? 0);
}

export async function login(input: unknown, ip: string | null, userAgent: string | null): Promise<{ token: string; user: SessionUser }> {
  const data = loginSchema.parse(input);
  const db = getDb();
  if ((await recentFailures("email", data.email)) >= MAX_FAILS_PER_EMAIL || (ip && (await recentFailures("ip", ip)) >= MAX_FAILS_PER_IP)) {
    await securityLog("login_blocked", null, { email: data.email }, ip);
    throw tooMany("Muitas tentativas de login. Aguarde 15 minutos.");
  }
  const user = await db.get<UserRow>(
    "SELECT id,email,password_hash,role,status FROM users WHERE email = ? OR (username IS NOT NULL AND username = ?)",
    data.email, data.email,
  );
  const ok = verifyPassword(data.password, user?.password_hash ?? DUMMY_HASH) && Boolean(user?.password_hash);
  await db.run("INSERT INTO login_attempts(email,ip,success,created_at) VALUES(?,?,?,?)", data.email, ip, ok ? 1 : 0, nowIso());
  if (!user || !ok) {
    await securityLog("login_failed", user?.id ?? null, { email: data.email }, ip);
    throw unauthorized("E-mail ou senha incorretos.");
  }
  if (user.status === "banned") throw forbidden("Esta conta está suspensa.");
  const token = await createSession(user.id, ip, userAgent);
  await securityLog("login", user.id, {}, ip);
  return { token, user: (await loadSessionUser(user.id))! };
}

export async function createSession(userId: string, ip: string | null, userAgent: string | null): Promise<string> {
  const db = getDb();
  const token = newToken();
  const now = new Date();
  const expires = new Date(now.getTime() + getConfig().SESSION_TTL_HOURS * 3600_000);
  await db.run(
    "INSERT INTO sessions(id,user_id,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?)",
    sha256(token), userId, now.toISOString(), expires.toISOString(), ip, userAgent?.slice(0, 200) ?? null,
  );
  await db.run("UPDATE users SET last_login_at = ? WHERE id = ?", now.toISOString(), userId);
  return token;
}

export async function logout(token: string | undefined): Promise<void> {
  if (token) await getDb().run("DELETE FROM sessions WHERE id = ?", sha256(token));
}

export async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const row = await getDb().get<{ id: string; email: string; role: "user" | "master"; status: string; display_name: string; avatar: string }>(
    `SELECT u.id, u.email, u.role, u.status, p.display_name, p.avatar
       FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`,
    userId,
  );
  if (!row || row.status !== "active") return null;
  return { id: row.id, email: row.email, role: row.role, displayName: row.display_name, avatar: row.avatar, premium: await isPremium(row.id) };
}

export async function userFromSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const s = await getDb().get<{ user_id: string; expires_at: string }>("SELECT user_id, expires_at FROM sessions WHERE id = ?", sha256(token));
  if (!s) return null;
  if (s.expires_at < nowIso()) {
    await getDb().run("DELETE FROM sessions WHERE id = ?", sha256(token));
    return null;
  }
  return loadSessionUser(s.user_id);
}

// ---------- Recuperação de senha ----------
export async function requestPasswordReset(input: unknown, ip: string | null): Promise<void> {
  const { email } = z.strictObject({ email: emailSchema }).parse(input);
  const db = getDb();
  const user = await db.get<{ id: string }>("SELECT id FROM users WHERE email = ? AND status = 'active'", email);
  await securityLog("password_reset_requested", user?.id ?? null, { email }, ip);
  if (!user) return; // resposta idêntica — não revela se o e-mail existe
  const token = newToken();
  const now = new Date();
  await db.run(
    "INSERT INTO password_resets(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)",
    newId(), user.id, sha256(token), new Date(now.getTime() + 30 * 60_000).toISOString(), now.toISOString(),
  );
  const link = `${getConfig().APP_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
  await getMailer().send(
    email,
    "Linha de Sobrevivência — redefinição de senha",
    `Recebemos um pedido para redefinir sua senha.\n\nUse este link em até 30 minutos:\n${link}\n\nSe não foi você, ignore este e-mail.`,
  );
}

export async function resetPassword(input: unknown, ip: string | null): Promise<void> {
  const { token, password } = z.strictObject({ token: z.string().min(10).max(200), password: passwordSchema }).parse(input);
  const db = getDb();
  const row = await db.get<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    "SELECT id,user_id,expires_at,used_at FROM password_resets WHERE token_hash = ?",
    sha256(token),
  );
  if (!row || row.used_at || row.expires_at < nowIso()) throw badRequest("Link inválido ou expirado.", "token_invalido");
  const passwordHash = hashPassword(password);
  await db.tx(async () => {
    // "used_at IS NULL" garante uso único mesmo com duas requisições simultâneas.
    const r = await db.run("UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL", nowIso(), row.id);
    if (r.changes === 0) throw badRequest("Link inválido ou expirado.", "token_invalido");
    await db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", passwordHash, nowIso(), row.user_id);
    await db.run("DELETE FROM sessions WHERE user_id = ?", row.user_id); // encerra sessões antigas
  });
  await securityLog("password_reset_done", row.user_id, {}, ip);
}

// ---------- Google OAuth (Authorization Code + PKCE + state) ----------
export function googleEnabled(): boolean {
  const c = getConfig();
  return Boolean(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET);
}

export function googleStart(): { url: string; state: string; verifier: string } {
  if (!googleEnabled()) throw new AppError(503, "Login com Google não está configurado.", "oauth_desativado");
  const c = getConfig();
  const state = newToken(24);
  const verifier = newToken(48);
  const challenge = createHash("sha256").update(verifier).digest().toString("base64url");
  const params = new URLSearchParams({
    client_id: c.GOOGLE_CLIENT_ID!,
    redirect_uri: `${c.APP_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state, verifier };
}

export async function googleCallback(
  code: string,
  state: string,
  cookieState: string | undefined,
  verifier: string | undefined,
  ip: string | null,
  ua: string | null,
): Promise<{ token: string; user: SessionUser }> {
  if (!googleEnabled()) throw new AppError(503, "Login com Google não está configurado.", "oauth_desativado");
  if (!cookieState || !verifier || cookieState !== state) throw badRequest("Estado OAuth inválido.", "oauth_state");
  const c = getConfig();
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.GOOGLE_CLIENT_ID!,
      client_secret: c.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${c.APP_URL}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!tokenRes.ok) throw badRequest("Falha ao validar login com Google.", "oauth_token");
  const tokens = (await tokenRes.json()) as { access_token?: string };
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!infoRes.ok) throw badRequest("Falha ao obter perfil do Google.", "oauth_userinfo");
  const info = (await infoRes.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string };
  if (!info.sub || !info.email || !info.email_verified) throw badRequest("E-mail do Google não verificado.", "oauth_email");
  const userId = await linkOrCreateOAuthUser("google", info.sub, info.email.toLowerCase(), info.name ?? info.email.split("@")[0]);
  const user = await loadSessionUser(userId);
  if (!user) throw forbidden("Esta conta está suspensa.");
  await securityLog("login_oauth", userId, { provider: "google" }, ip);
  return { token: await createSession(userId, ip, ua), user };
}

export async function linkOrCreateOAuthUser(provider: string, providerUserId: string, email: string, name: string): Promise<string> {
  const db = getDb();
  return db.tx(async () => {
    const linked = await db.get<{ user_id: string }>(
      "SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?",
      provider, providerUserId,
    );
    if (linked) return linked.user_id;
    const now = nowIso();
    let user = await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", email);
    if (!user) {
      user = { id: newId() };
      await db.run(
        "INSERT INTO users(id,email,password_hash,role,status,email_verified,created_at,updated_at) VALUES(?,?,NULL,'user','active',1,?,?)",
        user.id, email, now, now,
      );
      await db.run("INSERT INTO profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)", user.id, name.slice(0, 40), now, now);
      if (await tryGrantEarlyAdopter(user.id)) await unlockAchievement(user.id, "pioneiro", null);
    }
    await db.run(
      "INSERT INTO oauth_accounts(id,user_id,provider,provider_user_id,created_at) VALUES(?,?,?,?,?)",
      newId(), user.id, provider, providerUserId, now,
    );
    return user.id;
  });
}
