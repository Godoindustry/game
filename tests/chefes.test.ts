import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import { initCharacter, initWorld } from "@/server/engine/setup";
import { validateCharacterSheet } from "@/server/engine/character";
import { applyEffects, meetsRequirements, type EffectContext } from "@/server/engine/effects";
import { applyChoiceOutcome, choiceById, eventById, findTriggeredEvent } from "@/server/engine/events";
import { constantRng } from "@/server/engine/rng";
import { lineageOf } from "@/server/engine/lineage";
import type { CharacterState, WorldState } from "@/server/engine/types";
import { VALID_SHEET } from "./helpers";

function setup() {
  const v = validateCharacterSheet(VALID_SHEET);
  if (!v.ok) throw new Error(v.error);
  const world = initWorld(content, "camp-b", "seed-b");
  const char = initCharacter(content, randomUUID, { id: "char-b", userId: "user-b" }, v.sheet, v.finalAttributes);
  // Só os eventos de chefe interessam aqui: marca todos os outros como já vistos.
  for (const ev of content.events) if (!ev.id.startsWith("ch_")) world.eventHistory[ev.id] = 0;
  return { char, world };
}

const ctx = (world: WorldState, rng = constantRng(0)): EffectContext => ({
  world, content, rng, genId: randomUUID, minute: world.minute, lines: [], applied: [], extraMinutes: 0,
});
const next = (world: WorldState, char: CharacterState) => findTriggeredEvent(world, [char], content, () => constantRng(0))?.event.id;
const vampire = (char: CharacterState) => char.health.diseases.push({ key: "mordida", startedAt: 0, until: Number.MAX_SAFE_INTEGER, level: 3 });

describe("Chefes", () => {
  it("o chamado da Mãe das Asas só vem para quem foi mordido", () => {
    const { char, world } = setup();
    world.minute = 120; // noite
    expect(next(world, char)).not.toBe("ch_ninho");
    char.health.diseases.push({ key: "mordida", startedAt: 0, until: 5000, level: 1 });
    expect(next(world, char)).toBe("ch_ninho");
  });

  it("a Mãe das Asas aparece no poço, à noite, depois do chamado", () => {
    const { char, world } = setup();
    world.minute = 120;
    char.status.locationId = "lago";
    world.flags.mae_conhecida = true;
    world.eventHistory.ch_ninho = 60;
    expect(next(world, char)).toBe("ch_mae");
  });

  it("escolhas de linhagem ficam trancadas (com dica) para humanos", () => {
    const { char, world } = setup();
    const ajoelhar = choiceById(eventById(content, "ch_mae")!, "ch_mae.ajoelhar")!;
    const r = meetsRequirements(char, world, content, ajoelhar.requirements);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/Vampiro/);
    vampire(char);
    expect(meetsRequirements(char, world, content, ajoelhar.requirements).ok).toBe(true);
  });

  it("vencer a fúria da Mãe cura a mordida — mas não desfaz um vampiro", () => {
    const { char, world } = setup();
    char.health.diseases.push({ key: "mordida", startedAt: 0, until: 5000, level: 2 });
    const golpe = choiceById(eventById(content, "ch_mae_furia")!, "ch_mae_furia.golpe")!;
    const r = applyChoiceOutcome(char, golpe, ctx(world)); // rng 0 → d20 natural 20
    expect(r.success).toBe(true);
    expect(world.flags.mae_caida).toBe(true);
    expect(char.health.diseases.some((d) => d.key === "mordida")).toBe(false);

    const b = setup();
    vampire(b.char);
    applyEffects(b.char, [{ op: "cure", key: "mordida" }], ctx(b.world));
    expect(lineageOf(b.char)).toBe("vampire");
  });

  it("três toques de alma (efeito haunt) despertam o Assombrado", () => {
    const { char, world } = setup();
    applyEffects(char, [{ op: "haunt" }, { op: "haunt" }, { op: "haunt" }], ctx(world));
    expect(lineageOf(char)).toBe("haunted");
  });

  it("Iara só chama quem já descobriu algo sobre ela", () => {
    const { char, world } = setup();
    world.minute = 1440;
    // Ato II: já desperto, com classe, e Tavares fora do caminho.
    applyEffects(char, [{ op: "awaken", lineage: "hunter" }, { op: "setClass", classId: "vigias" }], ctx(world));
    world.flags.tavares_resolvido = true;
    world.flags.tavares_resolvido = true;
    // O Despertar é repetível enquanto o personagem continuar humano; este teste
    // isola especificamente o chamado de Iara.
    world.eventHistory.ch_despertar = world.minute;
    expect(next(world, char)).not.toBe("ch_iara_sinal");
    world.clues.push("diario_iara");
    expect(next(world, char)).toBe("ch_iara_sinal");
  });

  it("dar paz a Iara exige saber a verdade e libera a conversa com ela", () => {
    const { char, world } = setup();
    const prometer = choiceById(eventById(content, "ch_iara")!, "ch_iara.prometer")!;
    expect(meetsRequirements(char, world, content, prometer.requirements).ok).toBe(false);
    world.clues.push("rumo_074");
    applyChoiceOutcome(char, prometer, ctx(world));
    expect(world.flags.iara_em_paz).toBe(true);
    expect(content.npcs.iara.presentFlag).toBe("iara_em_paz");
  });

  it("os finais dos chefes existem e são vitórias", () => {
    for (const key of ["senhor_da_noite", "rei_da_mata"]) expect(content.endings[key]?.type).toBe("victory");
  });
});
