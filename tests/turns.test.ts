import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/database";
import { act, freshApp, registered, soloCampaign, VALID_SHEET, type Client } from "./helpers";

/** Mesa cooperativa com dois jogadores, já começada. */
async function coopTable() {
  const owner = await registered("Mestra da Mesa");
  const guest = await registered("Convidado");
  const camp = await owner.client.post("/api/campaigns", { name: "Mesa de Turnos", mode: "coop" });
  const id = camp.body.id as string;
  const invite = await owner.client.post(`/api/campaigns/${id}/invites`);
  await guest.client.post("/api/invites/accept", { code: invite.body.code });
  await owner.client.post(`/api/campaigns/${id}/character`, VALID_SHEET);
  await guest.client.post(`/api/campaigns/${id}/character`, { ...VALID_SHEET, name: "Convidado" });
  expect((await owner.client.post(`/api/campaigns/${id}/start`)).status).toBe(200);
  return { id, owner: owner.client, guest: guest.client };
}

/** A jogada que o estado pede agora: responder o evento (se estiver nele) ou esperar. */
async function play(c: Client, id: string) {
  const s = (await c.get(`/api/campaigns/${id}/state`)).body;
  const choice = s.event?.participating ? s.event.choices.find((x: { available: boolean; roll: unknown }) => x.available && !x.roll) ?? s.event.choices.find((x: { available: boolean }) => x.available) : null;
  return choice ? act(c, id, "escolha_evento", { choiceId: choice.id }) : act(c, id, "esperar");
}

const round = async (c: Client, id: string) => (await c.post(`/api/campaigns/${id}/sync`)).body.campaign.round as number;

describe("A história só anda quando todos jogaram", () => {
  beforeEach(async () => {
    await freshApp();
  });

  it("solo: anda na hora em que o jogador escolhe", async () => {
    const a = await registered("Solo");
    const id = await soloCampaign(a.client);
    const before = await round(a.client, id);
    expect((await play(a.client, id)).status).toBe(200);
    expect(await round(a.client, id)).toBeGreaterThan(before);
  });

  it("coop: a jogada de um só não avança; quando o outro joga, avança", async () => {
    const { id, owner, guest } = await coopTable();
    const before = await round(owner, id);
    expect((await play(owner, id)).status).toBe(200);
    expect(await round(guest, id), "espera o parceiro").toBe(before);
    // Quem já jogou vê de quem a mesa depende (e o cliente sai do sync de 400 ms).
    const waiting = (await owner.post(`/api/campaigns/${id}/sync`)).body.pending;
    expect(waiting.waitingFor).toEqual(["Convidado"]);
    expect((await play(guest, id)).status).toBe(200);
    expect(await round(owner, id)).toBeGreaterThan(before);
  });

  it("coop: se o parceiro sai no meio da rodada, quem ficou segue jogando", async () => {
    const { id, owner, guest } = await coopTable();
    const before = await round(owner, id);
    expect((await play(owner, id)).status).toBe(200);
    expect((await guest.post(`/api/campaigns/${id}/leave`)).status).toBe(200);
    expect(await round(owner, id)).toBeGreaterThan(before);
    expect((await guest.get(`/api/campaigns/${id}/lobby`)).status).toBe(404);
  });

  it("coop: quem some recebe a ação segura depois do prazo, e a mesa não trava", async () => {
    const { id, owner } = await coopTable();
    const before = await round(owner, id);
    expect((await play(owner, id)).status).toBe(200);
    expect(await round(owner, id)).toBe(before);
    await getDb().run("UPDATE campaigns SET round_deadline_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), id);
    expect(await round(owner, id)).toBeGreaterThan(before);
    const auto = await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM player_actions WHERE campaign_id = ? AND auto = 1", id);
    expect(auto!.n).toBe(1);
  });
});
