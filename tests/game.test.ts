import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { freshApp, registered, soloCampaign, act, key, VALID_SHEET, type Client } from "./helpers";
import { getDb, openDb, setDb } from "@/server/db/database";
import { setConfig, getConfig } from "@/server/config";
import { resetApiForTests } from "@/server/http/api";

beforeEach(async () => {
  await freshApp();
});

/** Responde o evento inicial e qualquer evento seguinte com a escolha segura (a última disponível). */
async function answerStart(c: Client, id: string) {
  await act(c, id, "escolha_evento", { choiceId: "vs_despertar.gritar" });
  for (let i = 0; i < 5; i++) {
    const s = (await c.get(`/api/campaigns/${id}/state`)).body;
    if (!s.event?.participating) return;
    const avail = s.event.choices.filter((x: { available: boolean }) => x.available);
    await act(c, id, "escolha_evento", { choiceId: avail[avail.length - 1].id });
  }
}

describe("Ações: duplicação, espera e validação no servidor", () => {
  it("mesma chave de idempotência não duplica; segunda ação na rodada é recusada", async () => {
    setConfig({ ...getConfig(), ACTION_REAL_SECONDS_PER_GAME_MINUTE: 1, ACTION_MAX_REAL_SECONDS: 60 });
    const { client } = await registered("Duda");
    const id = await soloCampaign(client);
    const k = key();
    const body = { type: "escolha_evento", params: { choiceId: "vs_despertar.examinar" }, idempotencyKey: k };
    const a = await client.post(`/api/campaigns/${id}/actions`, body);
    const b = await client.post(`/api/campaigns/${id}/actions`, body);
    expect(a.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.actionId).toBe(a.body.actionId);
    const c = await act(client, id, "escolha_evento", { choiceId: "vs_despertar.gritar" });
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("acao_pendente");
    expect(Number((await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM player_actions WHERE campaign_id = ?", id))!.n)).toBe(1);
  });

  it("a ação só resolve depois da espera real; pode ser cancelada antes", async () => {
    setConfig({ ...getConfig(), ACTION_REAL_SECONDS_PER_GAME_MINUTE: 1, ACTION_MAX_REAL_SECONDS: 60 });
    const { client } = await registered("Enzo");
    const id = await soloCampaign(client);
    const r = await act(client, id, "escolha_evento", { choiceId: "vs_despertar.examinar" });
    expect(r.body.minutes).toBe(10);
    const p = r.body.state.pending;
    expect(new Date(p.completesAt).getTime() - new Date(p.submittedAt).getTime()).toBe(10_000);
    expect((await client.post(`/api/campaigns/${id}/sync`)).body.campaign.round).toBe(1);
    // cancelar e reenviar
    expect((await client.del(`/api/campaigns/${id}/actions/pending`)).status).toBe(200);
    await act(client, id, "escolha_evento", { choiceId: "vs_despertar.examinar" });
    (await getDb().run("UPDATE player_actions SET completes_at = '2000-01-01T00:00:00.000Z' WHERE campaign_id = ? AND status = 'pending'", id));
    const s = await client.post(`/api/campaigns/${id}/sync`);
    expect(s.body.campaign.round).toBe(2);
    expect(s.body.campaign.minute).toBeGreaterThanOrEqual(10);
  });

  it("recusa manipulação: destino não adjacente, item de outro jogador, tipo inventado, duração enviada", async () => {
    const a = await registered("Fred");
    const b = await registered("Gina");
    const idA = await soloCampaign(a.client);
    const idB = await soloCampaign(b.client);
    await answerStart(a.client, idA);
    await answerStart(b.client, idB);
    expect((await act(a.client, idA, "mover", { to: "estacao" })).status).toBe(400);
    const stateB = await b.client.get(`/api/campaigns/${idB}/state`);
    const itemB = stateB.body.me.inventory.find((i: { itemId: string }) => i.itemId === "barra_cereal").id;
    expect((await act(a.client, idA, "comer", { inventoryItemId: itemB })).status).toBe(400);
    expect((await act(a.client, idA, "teletransportar", {})).status).toBe(400);
    const before = (await a.client.get(`/api/campaigns/${idA}/state`)).body.campaign.minute;
    const r = await act(a.client, idA, "descansar", { minutes: 1, energy: 100 });
    expect(r.status).toBe(200);
    expect(r.body.state.campaign.minute - before).toBeGreaterThanOrEqual(30);
    expect(r.body.state.me.status.energy).toBeLessThanOrEqual(100);
  });
});

describe("Salvamento automático", () => {
  it("o estado sobrevive a um reinício do servidor (arquivo SQLite)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-"));
    const file = path.join(dir, "save.sqlite");
    await freshApp({}, file);
    const { client } = await registered("Hana");
    const id = await soloCampaign(client);
    await answerStart(client, id);
    await act(client, id, "examinar");
    const before = (await client.get(`/api/campaigns/${id}/state`)).body;
    await getDb().close();
    // "reinicia": nova conexão com o mesmo arquivo, novo roteador
    const db = await openDb({ file });
    setDb(db);
    resetApiForTests();
    const after = (await client.get(`/api/campaigns/${id}/state`)).body;
    expect(after.campaign.minute).toBe(before.campaign.minute);
    expect(after.campaign.round).toBe(before.campaign.round);
    expect(after.me.status).toEqual(before.me.status);
    expect(after.me.inventory.map((i: { id: string }) => i.id)).toEqual(before.me.inventory.map((i: { id: string }) => i.id));
    expect(after.log.length).toBe(before.log.length);
    await db.close();
  });
});

describe("Morte e finalização", () => {
  it("morte encerra a campanha solo com derrota, gera ranking e bloqueia novas ações", async () => {
    const { client } = await registered("Iago");
    const id = await soloCampaign(client);
    await answerStart(client, id);
    const charId = (await getDb().get<{ id: string }>("SELECT id FROM characters WHERE campaign_id = ?", id))!.id;
    (await getDb().run("UPDATE character_status SET thirst = 100 WHERE character_id = ?", charId));
    (await getDb().run("UPDATE health_states SET health = 1 WHERE character_id = ?", charId));
    const r = await act(client, id, "descansar");
    expect(r.status).toBe(200);
    const s = r.body.state;
    expect(s.me.alive).toBe(false);
    expect(s.me.deathCause).toBe("Desidratação");
    expect(s.campaign.status).toBe("finished");
    expect(s.ending.type).toBe("defeat");
    expect((await getDb().get("SELECT 1 FROM ranking_scores WHERE campaign_id = ?", id))).toBeDefined();
    expect((await act(client, id, "examinar")).status).toBe(409);
  });

  it("dono pode encerrar (abandonar) a campanha", async () => {
    const { client } = await registered("Juli");
    const id = await soloCampaign(client);
    expect((await client.post(`/api/campaigns/${id}/end`)).status).toBe(200);
    const s = await client.get(`/api/campaigns/${id}/state`);
    expect(s.body.campaign.status).toBe("finished");
    expect(s.body.ending.key).toBe("abandonada");
  });
});

describe("Fluxo solo completo", () => {
  const PREF: Record<string, string[]> = {
    vs_despertar: ["examinar"],
    vs_bagageiro: ["forcar", "alavanca"],
    vs_estacao_portao: ["rodear", "pular"],
    vs_estacao_interior: ["mapa", "diario"],
    vs_radio: ["ligar"],
    vs_piloto: ["oferecer", "conversar"],
    vs_chuva: ["abrigar"],
    vs_ponte: ["seguir"],
    vs_vozes: ["ignorar"],
  };
  const ROUTE = ["destrocos", "abrigo", "ponte", "estacao"];

  it("do acidente ao resgate pelo rádio, passando por eventos, inventário e deslocamento", async () => {
    const { client } = await registered("Kai");
    const sheet = {
      ...VALID_SHEET,
      name: "Kai Tavares",
      profession: "mecanico",
      experiences: ["tecnologia"],
      attributes: {
        forca: 6, percepcao: 6, conhecimento_tecnico: 6, agilidade: 5, improviso: 4, resistencia: 2, controle_emocional: 2,
        inteligencia: 1, medicina: 1, orientacao: 1, comunicacao: 1, furtividade: 1,
      },
    };
    const id = await soloCampaign(client, sheet);
    const seenEvents = new Set<string>();
    let state = (await client.post(`/api/campaigns/${id}/sync`)).body;
    for (let i = 0; i < 120 && state.campaign.status === "active"; i++) {
      let res;
      if (state.event?.participating) {
        const evId = state.event.choices[0].id.split(".")[0];
        seenEvents.add(evId);
        const avail = state.event.choices.filter((c: { available: boolean }) => c.available);
        const pick =
          (PREF[evId] ?? []).map((p) => avail.find((c: { id: string }) => c.id === `${evId}.${p}`)).find(Boolean) ??
          avail[avail.length - 1];
        res = await act(client, id, "escolha_evento", { choiceId: pick.id });
      } else {
        const me = state.me;
        const bleeding = me.wounds.find((w: { bleedingRate: number; treat: { available: boolean } }) => w.bleedingRate > 0 && w.treat.available);
        const water = me.inventory.find((it: { itemId: string; contaminated: boolean }) => it.itemId === "garrafa_agua" && !it.contaminated);
        const food = me.inventory.find((it: { category: string }) => it.category === "comida");
        const hasBattery = me.inventory.some((it: { itemId: string }) => it.itemId === "bateria_emergencia");
        const here = me.status.locationId;
        if (bleeding) res = await act(client, id, "tratar_ferimento", { woundId: bleeding.id });
        else if (me.status.thirst > 65 && water) res = await act(client, id, "beber", { inventoryItemId: water.id });
        else if (me.status.hunger > 65 && food) res = await act(client, id, "comer", { inventoryItemId: food.id });
        else if (me.status.energy < 20) res = await act(client, id, "descansar");
        else if (!hasBattery) res = await act(client, id, here === "destrocos" ? "esperar" : "mover", { to: "destrocos" });
        else if (here !== "estacao") res = await act(client, id, "mover", { to: ROUTE[ROUTE.indexOf(here) + 1] });
        else res = await act(client, id, "esperar");
      }
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      state = res.body.state;
    }
    expect(state.campaign.status).toBe("finished");
    expect(state.ending.type).toBe("victory");
    expect(state.ending.key).toBe("resgate_radio");
    expect(state.me.alive).toBe(true);
    expect(seenEvents.size).toBeGreaterThanOrEqual(4);
    expect(state.clues.length).toBeGreaterThanOrEqual(1);
    const rank = await client.get("/api/ranking");
    expect(rank.body[0].ending).toBe("resgate_radio");
    const ach = await client.get("/api/achievements");
    expect(ach.body.find((a: { id: string }) => a.id === "resgatado").unlockedAt).toBeTruthy();
    // o log conta a história em mensagens
    expect(state.log.some((l: { kind: string }) => l.kind === "ending")).toBe(true);
  });
});

describe("Estado para o HUD: objetivo, clima e narrador", () => {
  it("expõe bússola, clima e abrigo; o narrador de reserva reage ao corpo", async () => {
    const { client } = await registered("Iris");
    const id = await soloCampaign(client);
    const s = (await client.get(`/api/campaigns/${id}/state`)).body;
    expect(s.campaign.weather).toBe("seco");
    expect(typeof s.here.sheltered).toBe("boolean");
    expect(s.objective.routeId).toBe("radio");
    expect(s.objective.targetLocationId).toBe("destrocos");
    expect(s.urgent).toBeNull();

    // Sem IA: a linha de ambientação vem do texto de reserva sobre a condição do corpo.
    setConfig({ ...getConfig(), AI_PROVIDER: "none" });
    const { setProvider } = await import("@/server/ai/service");
    setProvider(null);
    await getDb().run("UPDATE character_status SET hunger = 90 WHERE character_id IN (SELECT id FROM characters WHERE campaign_id = ?)", id);
    await act(client, id, "escolha_evento", { choiceId: "vs_despertar.gritar" });
    await getDb().run("UPDATE player_actions SET completes_at = '2000-01-01T00:00:00.000Z' WHERE campaign_id = ? AND status = 'pending'", id);
    const after = (await client.post(`/api/campaigns/${id}/sync`)).body;
    const narrative = after.log.filter((l: { kind: string }) => l.kind === "narrative").map((l: { text: string }) => l.text);
    expect(narrative.some((t: string) => /fome|estômago/i.test(t))).toBe(true);
    expect(after.urgent.label).toMatch(/Coma/);
  });
});
