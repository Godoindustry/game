import { describe, it, expect, beforeEach } from "vitest";
import { freshApp, Client, registered } from "./helpers";
import { getDb } from "@/server/db/database";

beforeEach(async () => {
  await freshApp();
});

describe("Cadastro", () => {
  it("cria conta, abre sessão com cookie httpOnly e não guarda a senha em texto", async () => {
    const c = new Client();
    const r = await c.post("/api/auth/register", { email: "Ana@Teste.local", password: "Senha1234", displayName: "Ana" });
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe("ana@teste.local");
    expect(r.body.user.role).toBe("user");
    const sc = r.headers.getSetCookie().find((s) => s.startsWith("ls_session="))!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    const row = (await getDb().get<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'ana@teste.local'"))!;
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain("Senha1234");
    const me = await c.get("/api/auth/me");
    expect(me.body.user.displayName).toBe("Ana");
  });
  it("rejeita e-mail duplicado, senha fraca e e-mail inválido", async () => {
    await registered("Bia");
    const c = new Client();
    const email = (await c.post("/api/auth/register", { email: "x@teste.local", password: "Senha1234", displayName: "Xavier" })).status;
    expect(email).toBe(200);
    expect((await new Client().post("/api/auth/register", { email: "x@teste.local", password: "Senha1234", displayName: "Yara" })).status).toBe(409);
    expect((await new Client().post("/api/auth/register", { email: "y@teste.local", password: "curta", displayName: "Yara" })).status).toBe(400);
    expect((await new Client().post("/api/auth/register", { email: "semarroba", password: "Senha1234", displayName: "Yara" })).status).toBe(400);
  });
  it("não permite que o usuário se autopromova a administrador", async () => {
    const r = await new Client().post("/api/auth/register", { email: "hacker@teste.local", password: "Senha1234", displayName: "Hack", role: "master" });
    expect(r.status).toBe(400);
    expect((await getDb().get("SELECT 1 FROM users WHERE email = 'hacker@teste.local'"))).toBeUndefined();
  });
  it("escapa/limpa HTML no nome de exibição", async () => {
    const r = await new Client().post("/api/auth/register", { email: "xss@teste.local", password: "Senha1234", displayName: "<script>Zé</script>" });
    expect(r.status).toBe(200);
    expect(r.body.user.displayName).not.toMatch(/[<>]/);
  });
});

describe("Login e sessão", () => {
  it("faz login com a senha correta e recusa a errada com mensagem genérica", async () => {
    const { email } = await registered("Caio");
    const c = new Client();
    const bad = await c.post("/api/auth/login", { email, password: "Errada123" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("E-mail ou senha incorretos.");
    const unknown = await c.post("/api/auth/login", { email: "naoexiste@teste.local", password: "Errada123" });
    expect(unknown.body.error).toBe(bad.body.error); // não revela se o e-mail existe
    const ok = await c.post("/api/auth/login", { email, password: "Senha1234" });
    expect(ok.status).toBe(200);
    expect((await c.get("/api/profile")).status).toBe(200);
  });
  it("bloqueia após 5 tentativas erradas (força bruta)", async () => {
    const { email } = await registered("Dani");
    const c = new Client("10.9.9.9");
    for (let i = 0; i < 5; i++) expect((await c.post("/api/auth/login", { email, password: "Errada123" })).status).toBe(401);
    const locked = await c.post("/api/auth/login", { email, password: "Senha1234" });
    expect(locked.status).toBe(429);
    expect((await getDb().get("SELECT 1 FROM security_logs WHERE kind = 'login_blocked'"))).toBeDefined();
  });
  it("logout invalida a sessão no servidor", async () => {
    const { client } = await registered("Edu");
    const token = client.cookies.ls_session;
    await client.post("/api/auth/logout");
    expect((await client.get("/api/profile")).status).toBe(401);
    const replay = new Client();
    replay.cookies.ls_session = token;
    expect((await replay.get("/api/profile")).status).toBe(401);
  });
  it("usuário banido perde acesso imediatamente", async () => {
    const { client, user } = await registered("Fabi");
    (await getDb().run("UPDATE users SET status = 'banned' WHERE id = ?", user.id));
    expect((await client.get("/api/profile")).status).toBe(401);
  });
});

describe("Recuperação de senha", () => {
  it("envia link, redefine a senha, encerra sessões antigas e o token é de uso único", async () => {
    const { client, email } = await registered("Gabi");
    const anon = new Client();
    const r = await anon.post("/api/auth/forgot", { email });
    expect(r.status).toBe(200);
    const same = await anon.post("/api/auth/forgot", { email: "ninguem@teste.local" });
    expect(same.body.message).toBe(r.body.message);
    const mail = (await getDb().get<{ body: string }>("SELECT body FROM mail_outbox WHERE to_email = ?", email))!;
    const token = decodeURIComponent(mail.body.match(/token=([^\s]+)/)![1]);
    expect((await anon.post("/api/auth/reset", { token, password: "NovaSenha99" })).status).toBe(200);
    expect((await client.get("/api/profile")).status).toBe(401); // sessão antiga derrubada
    expect((await anon.post("/api/auth/login", { email, password: "Senha1234" })).status).toBe(401);
    expect((await anon.post("/api/auth/login", { email, password: "NovaSenha99" })).status).toBe(200);
    expect((await anon.post("/api/auth/reset", { token, password: "OutraSenha1" })).status).toBe(400);
  });
});

describe("CSRF e origem", () => {
  it("rejeita requisição que altera estado sem token CSRF", async () => {
    const c = new Client();
    const r = await c.request("POST", "/api/auth/register", { email: "z@teste.local", password: "Senha1234", displayName: "Zeca" }, { csrf: false });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf");
  });
  it("rejeita origem estrangeira mesmo com token", async () => {
    const { client } = await registered("Hugo");
    const r = await client.request("POST", "/api/campaigns", { name: "x".repeat(5), mode: "solo" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });
});

describe("Google OAuth", () => {
  it("fica desativado sem credenciais e informa isso ao frontend", async () => {
    const meta = await new Client().get("/api/meta");
    expect(meta.body.googleEnabled).toBe(false);
    const start = await new Client().get("/api/auth/google/start");
    expect(start.status).toBe(503);
  });
  it("com credenciais, redireciona ao Google com state e PKCE", async () => {
    await freshApp({ GOOGLE_CLIENT_ID: "id-teste", GOOGLE_CLIENT_SECRET: "segredo" });
    const c = new Client();
    const r = await c.get("/api/auth/google/start");
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.hostname).toBe("accounts.google.com");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("state")).toBe(c.cookies.ls_oauth_state);
  });
});
