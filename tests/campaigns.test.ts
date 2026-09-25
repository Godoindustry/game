import { describe, it, expect, beforeEach } from "vitest";
import { freshApp, registered, VALID_SHEET, act } from "./helpers";
import { getDb } from "@/server/db/database";
import { setConfig, getConfig } from "@/server/config";

beforeEach(async () => {
  await freshApp();
});

async function coop(name = "Dono") {
  const owner = await registered(name);
  const c = await owner.client.post("/api/campaigns", { name: "Expedição", mode: "coop" });
  expect(c.status).toBe(200);
  return { owner, id: c.body.id as string };
}

describe("Convites", () => {
  it("dono gera convite e outro jogador entra", async () => {
    const { owner, id } = await coop();
    const inv = await owner.client.post(`/api/campaigns/${id}/invites`);
    expect(inv.status).toBe(200);
    expect(inv.body.code.length).toBeGreaterThanOrEqual(20);
    // o banco guarda só o hash do código
    expect((await getDb().get("SELECT 1 FROM campaign_invites WHERE code_hash = ?", inv.body.code))).toBeUndefined();
    const guest = await registered("Guest");
    const r = await guest.client.post("/api/invites/accept", { code: inv.body.code });
    expect(r.status).toBe(200);
    expect(r.body.campaignId).toBe(id);
    const lobby = await guest.client.get(`/api/campaigns/${id}/lobby`);
    expect(lobby.body.members).toHaveLength(2);
  });
  it("rejeita código inválido, expirado e revogado", async () => {
    const { owner, id } = await coop();
    const guest = await registered("Gil");
    expect((await guest.client.post("/api/invites/accept", { code: "codigo-que-nao-existe-123" })).status).toBe(400);
    const inv = await owner.client.post(`/api/campaigns/${id}/invites`);
    (await getDb().run("UPDATE campaign_invites SET expires_at = '2000-01-01T00:00:00.000Z'"));
    expect((await guest.client.post("/api/invites/accept", { code: inv.body.code })).status).toBe(400);
    const inv2 = await owner.client.post(`/api/campaigns/${id}/invites`);
    await owner.client.del(`/api/campaigns/${id}/invites`);
    expect((await guest.client.post("/api/invites/accept", { code: inv2.body.code })).status).toBe(400);
  });
  it("campanha solo não aceita convites", async () => {
    const a = await registered("Solo");
    const c = await a.client.post("/api/campaigns", { name: "Sozinho", mode: "solo" });
    expect((await a.client.post(`/api/campaigns/${c.body.id}/invites`)).status).toBe(400);
  });
});

describe("Limite de 4 jogadores", () => {
  it("o 5º jogador é recusado, mesmo com convites diferentes", async () => {
    const { owner, id } = await coop();
    const codes = [];
    for (let i = 0; i < 2; i++) codes.push((await owner.client.post(`/api/campaigns/${id}/invites`)).body.code);
    for (let i = 0; i < 3; i++) {
      const g = await registered(`Membro${i}`);
      expect((await g.client.post("/api/invites/accept", { code: codes[i % 2] })).status).toBe(200);
    }
    const fifth = await registered("Quinto");
    const r = await fifth.client.post("/api/invites/accept", { code: codes[1] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("campanha_cheia");
    expect((await owner.client.post(`/api/campaigns/${id}/invites`)).status).toBe(409);
    expect(Number((await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM campaign_members WHERE campaign_id = ?", id))!.n)).toBe(4);
  });
});

describe("Ficha e início", () => {
  it("valida pontos no servidor e impede segundo personagem", async () => {
    const { owner, id } = await coop();
    const bad = await owner.client.post(`/api/campaigns/${id}/character`, { ...VALID_SHEET, attributes: { ...VALID_SHEET.attributes, forca: 6 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/24 pontos/);
    expect((await owner.client.post(`/api/campaigns/${id}/character`, VALID_SHEET)).status).toBe(200);
    expect((await owner.client.post(`/api/campaigns/${id}/character`, VALID_SHEET)).status).toBe(409);
  });
  it("não inicia enquanto alguém não criou a ficha", async () => {
    const { owner, id } = await coop();
    const inv = await owner.client.post(`/api/campaigns/${id}/invites`);
    const g = await registered("Lento");
    await g.client.post("/api/invites/accept", { code: inv.body.code });
    await owner.client.post(`/api/campaigns/${id}/character`, VALID_SHEET);
    const r = await owner.client.post(`/api/campaigns/${id}/start`);
    expect(r.status).toBe(409);
    await g.client.post(`/api/campaigns/${id}/character`, { ...VALID_SHEET, name: "Beto Lima" });
    expect((await owner.client.post(`/api/campaigns/${id}/start`)).status).toBe(200);
    // após iniciar, convites não funcionam mais
    expect((await owner.client.post(`/api/campaigns/${id}/invites`)).status).toBe(409);
  });
});

describe("Rodadas cooperativas", () => {
  async function startedCoop() {
    const { owner, id } = await coop();
    const inv = await owner.client.post(`/api/campaigns/${id}/invites`);
    const g = await registered("Parceiro");
    await g.client.post("/api/invites/accept", { code: inv.body.code });
    await owner.client.post(`/api/campaigns/${id}/character`, VALID_SHEET);
    await g.client.post(`/api/campaigns/${id}/character`, { ...VALID_SHEET, name: "Beto Lima" });
    await owner.client.post(`/api/campaigns/${id}/start`);
    return { owner, guest: g, id };
  }

  it("a rodada só avança quando todos confirmam", async () => {
    const { owner, guest, id } = await startedCoop();
    const s0 = await owner.client.get(`/api/campaigns/${id}/state`);
    expect(s0.body.event.participants).toHaveLength(2);
    const r1 = await act(owner.client, id, "escolha_evento", { choiceId: "vs_despertar.gritar" });
    expect(r1.status).toBe(200);
    expect(r1.body.state.campaign.round).toBe(1);
    expect(r1.body.state.pending.waitingFor).toEqual(["Beto Lima"]);
    const r2 = await act(guest.client, id, "escolha_evento", { choiceId: "vs_despertar.gritar" });
    expect(r2.body.state.campaign.round).toBe(2);
    expect(r2.body.state.event?.title).not.toBe("Silêncio depois do impacto");
  });

  it("quem não responde no prazo recebe ação segura automática", async () => {
    const { owner, id } = await startedCoop();
    await act(owner.client, id, "escolha_evento", { choiceId: "vs_despertar.examinar" });
    (await getDb().run("UPDATE campaigns SET round_deadline_at = '2000-01-01T00:00:00.000Z', last_heartbeat_at = ? WHERE id = ?", new Date().toISOString(), id));
    const s = await owner.client.post(`/api/campaigns/${id}/sync`);
    expect(s.body.campaign.round).toBe(2);
    const auto = (await getDb().get<{ type: string; params: string }>("SELECT type, params FROM player_actions WHERE campaign_id = ? AND auto = 1", id))!;
    expect(auto.type).toBe("escolha_evento");
    expect(JSON.parse(auto.params).choiceId).toBe("vs_despertar.gritar"); // a escolha marcada como segura
  });

  it("com todos offline a campanha pausa: o prazo é estendido, não consumido", async () => {
    const { owner, id } = await startedCoop();
    setConfig({ ...getConfig(), PAUSE_AFTER_SECONDS: 60, ROUND_TIMEOUT_SECONDS: 300 });
    await act(owner.client, id, "escolha_evento", { choiceId: "vs_despertar.examinar" });
    // Simula: último heartbeat há 1 hora e prazo que teria vencido há 30 min.
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const deadline = new Date(Date.now() - 1800_000).toISOString();
    (await getDb().run("UPDATE campaigns SET last_heartbeat_at = ?, round_deadline_at = ? WHERE id = ?", hourAgo, deadline, id));
    const before = (await getDb().get<{ game_minutes: number }>("SELECT game_minutes FROM campaigns WHERE id = ?", id))!.game_minutes;
    const s = await owner.client.post(`/api/campaigns/${id}/sync`);
    expect(s.body.campaign.round).toBe(1); // não resolveu à revelia
    const row = (await getDb().get<{ round_deadline_at: string; game_minutes: number }>("SELECT round_deadline_at, game_minutes FROM campaigns WHERE id = ?", id))!;
    expect(new Date(row.round_deadline_at).getTime()).toBeGreaterThan(Date.now());
    expect(row.game_minutes).toBe(before); // nenhum tempo de jogo passou offline
  });
});
