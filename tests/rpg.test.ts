/**
 * Camada RPG: dificuldades, D20 com crítico, linhagens, IA das criaturas e narrador de voz.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import { initCharacter, initWorld } from "@/server/engine/setup";
import { validateCharacterSheet } from "@/server/engine/character";
import { checkChance, rollCheck } from "@/server/engine/effects";
import { passTime } from "@/server/engine/physiology";
import { constantRng } from "@/server/engine/rng";
import { nightEncounter, fallbackAttitude } from "@/server/engine/vampire";
import { lineageOf, lineageCheckModifier } from "@/server/engine/lineage";
import { DIFFICULTIES, type Difficulty } from "@/server/engine/difficulty";
import { extractVoiceTags, isVoiceTag } from "@/shared/voiceTags";
import { narrationText } from "@/server/services/tts";
import { getDb } from "@/server/db/database";
import { freshApp, registered, VALID_SHEET } from "./helpers";
import { AUDIO_SCRIPT } from "../scripts/generate-audio.js";

function setup(difficulty: Difficulty = "medio") {
  const v = validateCharacterSheet(VALID_SHEET);
  if (!v.ok) throw new Error(v.error);
  const world = initWorld(content, "camp-r", "seed-r");
  world.flags.dificuldade = difficulty;
  const char = initCharacter(content, randomUUID, { id: "char-r", userId: "user-r" }, v.sheet, v.finalAttributes);
  char.rules = { difficulty, startMinuteOfDay: content.startMinuteOfDay };
  return { char, world };
}

describe("Dificuldade", () => {
  it("cada modo aperta a CD do D20", () => {
    const chances = DIFFICULTIES.map((d) => checkChance(setup(d).char, { attr: "percepcao", base: 60 }, 0));
    for (let i = 1; i < chances.length; i++) expect(chances[i]).toBeLessThanOrEqual(chances[i - 1]);
    expect(chances[0]).toBeGreaterThan(chances[chances.length - 1]);
  });

  it("20 natural sempre passa; 1 natural sempre falha; no INSANO o 2 também falha", () => {
    const { char } = setup("insano");
    // rollCheck lê o dado invertido (rng baixo = rolagem alta): roll = 20 − ⌊rng·20⌋.
    const nat = (n: number) => constantRng((20 - n) / 20 + 0.001);
    expect(rollCheck(char, { attr: "percepcao", base: 5 }, nat(20), 0)).toMatchObject({ roll: 20, success: true, crit: "critical_success" });
    const easy = setup("facil").char;
    expect(rollCheck(easy, { attr: "percepcao", base: 200 }, nat(1), 0)).toMatchObject({ roll: 1, success: false, crit: "critical_failure" });
    expect(rollCheck(char, { attr: "percepcao", base: 200 }, nat(2), 0)).toMatchObject({ roll: 2, success: false, crit: "critical_failure" });
    expect(rollCheck(setup("medio").char, { attr: "percepcao", base: 200 }, nat(2), 0).success).toBe(true);
  });

  it("fome, sede e dano pesam mais nos modos duros", () => {
    const easy = setup("facil"), hard = setup("insano");
    passTime(easy.char, easy.world, content, 0, 240, "walk");
    passTime(hard.char, hard.world, content, 0, 240, "walk");
    expect(hard.char.status.hunger).toBeGreaterThan(easy.char.status.hunger);
    expect(hard.char.status.thirst).toBeGreaterThan(easy.char.status.thirst);
  });

  it("no INSANO duas mordidas bastam para virar vampiro", () => {
    const { char, world } = setup("insano");
    const bite = constantRng(0.99);
    nightEncounter(char, world, content, "morcego", bite, randomUUID, "atacar");
    world.minute += 60;
    const r = nightEncounter(char, world, content, "morcego", bite, randomUUID, "atacar");
    expect(r.turned).toBe("vampire");
    expect(lineageOf(char)).toBe("vampire");
  });

  it("a agressividade decide a atitude sem IA", () => {
    const { world } = setup("insano");
    expect(fallbackAttitude("morcego", world, constantRng(0.5))).toBe("atacar");
    const calm = setup("facil").world;
    expect(fallbackAttitude("morcego", calm, constantRng(0.5))).not.toBe("atacar");
  });
});

describe("Linhagens", () => {
  it("vampiro fica mais forte à noite e mais fraco de dia", () => {
    const { char } = setup();
    char.health.diseases.push({ key: "mordida", startedAt: 0, until: Number.MAX_SAFE_INTEGER, level: 3 });
    expect(lineageCheckModifier(char, "forca", true)).toBeGreaterThan(0);
    expect(lineageCheckModifier(char, "forca", false)).toBeLessThan(0);
  });

  it("três toques das almas despertam o Assombrado; depois elas não roubam calor", () => {
    const { char, world } = setup();
    let turned = null;
    for (let i = 0; i < 3; i++) {
      turned = nightEncounter(char, world, content, "alma", constantRng(0.5), randomUUID, "tocar").turned ?? turned;
      world.minute += 30;
    }
    expect(turned).toBe("haunted");
    expect(lineageOf(char)).toBe("haunted");
    const temp = char.status.bodyTemp;
    nightEncounter(char, world, content, "alma", constantRng(0.5), randomUUID, "tocar");
    expect(char.status.bodyTemp).toBe(temp);
  });

  it("dormir junto ao fogo não desfaz a linhagem Vampiro", () => {
    const { char, world } = setup();
    char.health.diseases.push({ key: "mordida", startedAt: 0, until: Number.MAX_SAFE_INTEGER, level: 3 });
    world.locations[char.status.locationId].fireUntilMinute = 10_000;
    passTime(char, world, content, 0, 480, "sleep");
    expect(lineageOf(char)).toBe("vampire");
  });

  it("criatura que foge ou ronda não morde", () => {
    for (const attitude of ["fugir", "rondar", "espreitar"] as const) {
      const { char, world } = setup();
      const r = nightEncounter(char, world, content, "morcego", constantRng(0.99), randomUUID, attitude);
      expect(r.happened).toBe(true);
      expect(r.bitten).toBe(false);
    }
  });
});

describe("Salas e IA das criaturas (API)", () => {
  beforeEach(async () => {
    await freshApp();
  });

  it("a dificuldade escolhida sobrevive ao início da campanha", async () => {
    const a = await registered("Ana");
    const c = await a.client.post("/api/campaigns", { name: "Noite Insana", mode: "solo", difficulty: "insano" });
    expect(c.status).toBe(200);
    await a.client.post(`/api/campaigns/${c.body.id}/character`, VALID_SHEET);
    expect((await a.client.post(`/api/campaigns/${c.body.id}/start`)).status).toBe(200);
    const st = await a.client.get(`/api/campaigns/${c.body.id}/state`);
    expect(st.body.campaign.difficulty.key).toBe("insano");
    const list = await a.client.get("/api/campaigns");
    expect(list.body[0].difficulty.label).toBe("INSANO");
    expect((await a.client.post("/api/campaigns", { name: "Errada", mode: "solo", difficulty: "impossivel" })).status).toBe(400);
  });

  it("o encontro usa a atitude da IA e registra no diário", async () => {
    const a = await registered("Bia");
    const c = await a.client.post("/api/campaigns", { name: "Caçada", mode: "solo", difficulty: "insano" });
    const id = c.body.id;
    await a.client.post(`/api/campaigns/${id}/character`, VALID_SHEET);
    await a.client.post(`/api/campaigns/${id}/start`);
    const r = await a.client.post(`/api/campaigns/${id}/encounter`, { kind: "morcego" });
    expect(r.status).toBe(200);
    expect(r.body.happened).toBe(true);
    expect(r.body.attitude).toBe("atacar"); // mock: agressividade alta → primeira atitude
    const logged = await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_requests WHERE purpose = 'creature'");
    expect(Number(logged?.n)).toBe(1);
    // Logo depois: intervalo — nem chama a IA de novo
    const again = await a.client.post(`/api/campaigns/${id}/encounter`, { kind: "morcego" });
    expect(again.body.reason).toBe("espera");
    expect(Number((await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_requests WHERE purpose = 'creature'"))?.n)).toBe(1);
  });

  it("narrador: sem chave → 503; linha de outra campanha → 404", async () => {
    const a = await registered("Caio");
    const c = await a.client.post("/api/campaigns", { name: "Voz", mode: "solo" });
    await a.client.post(`/api/campaigns/${c.body.id}/character`, VALID_SHEET);
    await a.client.post(`/api/campaigns/${c.body.id}/start`);
    const logId = (await getDb().get<{ id: number }>("SELECT id FROM campaign_log WHERE campaign_id = ? LIMIT 1", c.body.id))!.id;
    expect((await a.client.get(`/api/campaigns/${c.body.id}/log/${logId}/voice`)).status).toBe(503);
    await freshApp({ ELEVENLABS_API_KEY: "sk_test" });
    const b = await registered("Duda");
    const other = await b.client.post("/api/campaigns", { name: "Outra", mode: "solo" });
    expect((await b.client.get(`/api/campaigns/${other.body.id}/log/999999/voice`)).status).toBe(404);
  });
});

describe("Tags de voz", () => {
  it("todos os áudios fixos têm tags, e só tags permitidas", () => {
    for (const item of AUDIO_SCRIPT as { id: string; text: string }[]) {
      expect(extractVoiceTags(item.text).length, item.id).toBeGreaterThan(0);
      for (const m of item.text.matchAll(/\[([a-z][a-z ]{1,24})\]/g)) expect(isVoiceTag(m[1]), `${item.id}: [${m[1]}]`).toBe(true);
    }
  });

  it("o texto do narrador mantém as tags e tira os marcadores do diário", () => {
    expect(narrationText("【A noite】 [sighs] O frio chega. 🗺️ [inventada] Fim.")).toBe("A noite [sighs] O frio chega. Fim.");
  });
});
