import { describe, it, expect, beforeEach } from "vitest";
import { freshApp, Client, registered, soloCampaign, act } from "./helpers";
import { getDb } from "@/server/db/database";

beforeEach(async () => {
  await freshApp();
});

async function master() {
  const c = new Client("10.7.7.7");
  const r = await c.post("/api/auth/login", { email: "master@teste.local", password: "Master12345" });
  expect(r.status).toBe(200);
  expect(r.body.user.role).toBe("master");
  return c;
}

describe("Permissões e acesso indevido", () => {
  it("rotas protegidas exigem login", async () => {
    const anon = new Client();
    for (const p of ["/api/campaigns", "/api/profile", "/api/ranking", "/api/admin/stats"]) {
      expect((await anon.get(p)).status).toBe(401);
    }
  });
  it("não membro não vê nem age em campanha alheia (404, sem vazar existência)", async () => {
    const a = await registered("Dono");
    const b = await registered("Intruso");
    const id = await soloCampaign(a.client);
    expect((await b.client.get(`/api/campaigns/${id}/state`)).status).toBe(404);
    expect((await act(b.client, id, "examinar")).status).toBe(404);
    expect((await b.client.post(`/api/campaigns/${id}/end`)).status).toBe(403);
  });
  it("jogador comum não acessa o painel administrativo; tentativa é registrada", async () => {
    const { client } = await registered("Comum");
    expect((await client.get("/api/admin/stats")).status).toBe(403);
    expect((await client.post("/api/admin/users/qualquer/action", { action: "grant_premium" })).status).toBe(403);
    expect((await getDb().get("SELECT 1 FROM security_logs WHERE kind = 'admin_denied'"))).toBeDefined();
  });
  it("participante que não é dono não convida, não inicia e não remove", async () => {
    const owner = await registered("Dona");
    const guest = await registered("Convidado");
    const c = await owner.client.post("/api/campaigns", { name: "Grupo", mode: "coop" });
    const inv = await owner.client.post(`/api/campaigns/${c.body.id}/invites`);
    await guest.client.post("/api/invites/accept", { code: inv.body.code });
    expect((await guest.client.post(`/api/campaigns/${c.body.id}/invites`)).status).toBe(403);
    expect((await guest.client.post(`/api/campaigns/${c.body.id}/start`)).status).toBe(403);
    expect((await guest.client.del(`/api/campaigns/${c.body.id}/members/${owner.user.id}`)).status).toBe(403);
    // Dono pode remover o convidado
    expect((await owner.client.del(`/api/campaigns/${c.body.id}/members/${guest.user.id}`)).status).toBe(200);
  });
  it("ADM MASTER gerencia usuários e toda ação fica auditada", async () => {
    const m = await master();
    const { user, client } = await registered("Alvo");
    expect((await m.post(`/api/admin/users/${user.id}/action`, { action: "ban" })).status).toBe(200);
    expect((await client.get("/api/profile")).status).toBe(401);
    expect((await m.post(`/api/admin/users/${user.id}/action`, { action: "unban" })).status).toBe(200);
    const logs = await m.get("/api/admin/logs");
    expect(logs.body.admin.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(["user.ban", "user.unban"]));
  });
  it("não existe caminho para conceder o papel master pela API", async () => {
    const m = await master();
    const { user } = await registered("Quer");
    const r = await m.post(`/api/admin/users/${user.id}/action`, { action: "make_master" });
    expect(r.status).toBe(400);
    const p = await (await registered("Outro")).client.patch("/api/profile", { role: "master" });
    expect(p.status).toBe(400);
  });
});

describe("Premium para os 12 primeiros", () => {
  it("os 12 primeiros cadastros recebem premium; o 13º não; o master não ocupa vaga", async () => {
    await master(); // master existe e não conta
    const users = [];
    for (let i = 0; i < 13; i++) users.push(await registered(`P${i}`));
    for (let i = 0; i < 12; i++) expect(users[i].user.premium).toBe(true);
    expect(users[12].user.premium).toBe(false);
    const slots = (await getDb().all<{ slot_number: number }>("SELECT slot_number FROM premium_status WHERE slot_number IS NOT NULL ORDER BY slot_number"));
    expect(slots.map((s) => s.slot_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const ach = await users[0].client.get("/api/achievements");
    expect(ach.body.find((a: { id: string }) => a.id === "pioneiro").unlockedAt).toBeTruthy();
  });
  it("vaga removida não é reaproveitada", async () => {
    const users = [];
    for (let i = 0; i < 12; i++) users.push(await registered(`Q${i}`));
    (await getDb().run("DELETE FROM users WHERE id = ?", users[0].user.id));
    const late = await registered("Atrasado");
    expect(late.user.premium).toBe(false);
  });
  it("admin pode conceder/revogar premium manualmente", async () => {
    for (let i = 0; i < 12; i++) await registered(`R${i}`);
    const { user, client } = await registered("Extra");
    expect(user.premium).toBe(false);
    const m = await master();
    await m.post(`/api/admin/users/${user.id}/action`, { action: "grant_premium" });
    expect((await client.get("/api/auth/me")).body.user.premium).toBe(true);
    await m.post(`/api/admin/users/${user.id}/action`, { action: "revoke_premium" });
    expect((await client.get("/api/auth/me")).body.user.premium).toBe(false);
  });
});

describe("ADM MASTER configurado pelo .env", () => {
  it("entra com nome de usuário, é premium sem ocupar vaga de pioneiro, e a senha segue o .env", async () => {
    await freshApp({ ADMIN_EMAIL: "chefe@teste.local", ADMIN_PASSWORD: "Chefe12345", ADMIN_USERNAME: "Chefe" });
    const c = new Client("10.8.8.8");
    const r = await c.post("/api/auth/login", { email: "chefe", password: "Chefe12345" });
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe("master");
    expect(r.body.user.premium).toBe(true);
    expect((await c.get("/api/admin/stats")).status).toBe(200);
    const slot = await getDb().get<{ slot_number: number | null }>("SELECT slot_number FROM premium_status WHERE user_id = ?", r.body.user.id);
    expect(slot!.slot_number).toBeNull();
    // Trocar a senha no .env e reiniciar: a antiga deixa de funcionar
    const { setConfig, getConfig } = await import("@/server/config");
    const { resetApiForTests } = await import("@/server/http/api");
    setConfig({ ...getConfig(), ADMIN_PASSWORD: "NovaChefe99" });
    resetApiForTests();
    expect((await new Client("10.8.8.9").post("/api/auth/login", { email: "chefe", password: "Chefe12345" })).status).toBe(401);
    expect((await new Client("10.8.8.10").post("/api/auth/login", { email: "chefe@teste.local", password: "NovaChefe99" })).status).toBe(200);
  });
  it("usuário comum não ganha nome de usuário nem entra por ele; entrada inválida é recusada", async () => {
    const { email } = await registered("Normal");
    const c = new Client("10.8.8.11");
    expect((await c.post("/api/auth/login", { email: email.split("@")[0], password: "Senha1234" })).status).toBe(401);
    expect((await c.post("/api/auth/login", { email: "x", password: "Senha1234" })).status).toBe(400);
  });
});

describe("Promoção de conta existente pelo .env", () => {
  it("conta já cadastrada vira master (com usuário e premium) no próximo boot", async () => {
    const { email } = await registered("Futuro Chefe");
    const { setConfig, getConfig } = await import("@/server/config");
    const { resetApiForTests } = await import("@/server/http/api");
    setConfig({ ...getConfig(), ADMIN_EMAIL: email, ADMIN_PASSWORD: "Promovido123", ADMIN_USERNAME: "futurochefe" });
    resetApiForTests();
    const r = await new Client("10.8.9.1").post("/api/auth/login", { email: "futurochefe", password: "Promovido123" });
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe("master");
    expect(r.body.user.premium).toBe(true);
  });
});
