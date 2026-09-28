/**
 * Atos, despertar, classes (clãs/tribos/ordens/credos), disciplinas e compulsões.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import { initCharacter, initWorld } from "@/server/engine/setup";
import { validateCharacterSheet } from "@/server/engine/character";
import { applyEffects, checkChance, meetsRequirements, type EffectContext } from "@/server/engine/effects";
import { applyChoiceOutcome, choiceById, eventById, findTriggeredEvent } from "@/server/engine/events";
import { resolveRound } from "@/server/engine/round";
import { validateAction } from "@/server/engine/actions";
import { constantRng } from "@/server/engine/rng";
import { lineageOf } from "@/server/engine/lineage";
import { CLASSES, classesFor } from "@/server/engine/classes";
import { checkActTwo, powerOf, tickPowers } from "@/server/engine/powers";
import { nightEncounter } from "@/server/engine/vampire";
import type { CharacterState, WorldState } from "@/server/engine/types";
import { loadCampaignCharacters, saveCharacter } from "@/server/services/stateRepo";
import { freshApp, registered, soloCampaign, VALID_SHEET } from "./helpers";

function setup(id = "char-a") {
  const v = validateCharacterSheet(VALID_SHEET);
  if (!v.ok) throw new Error(v.error);
  const world = initWorld(content, "camp-a", "seed-a");
  const char = initCharacter(content, randomUUID, { id, userId: `user-${id}` }, v.sheet, v.finalAttributes);
  char.rules = { difficulty: "medio", startMinuteOfDay: content.startMinuteOfDay };
  for (const ev of content.events) if (!ev.id.startsWith("ch_")) world.eventHistory[ev.id] = 0;
  return { char, world };
}
const ctx = (world: WorldState): EffectContext => ({ world, content, rng: constantRng(0), genId: randomUUID, minute: world.minute, lines: [], applied: [], extraMinutes: 0 });
const next = (world: WorldState, chars: CharacterState[]) => findTriggeredEvent(world, chars, content, () => constantRng(0))?.event.id;
const choose = (char: CharacterState, world: WorldState, eventId: string, choice: string) =>
  applyChoiceOutcome(char, choiceById(eventById(content, eventId)!, `${eventId}.${choice}`)!, ctx(world));

describe("Ato I — despertar e classes", () => {
  it("todo humano passa pelo Despertar na primeira noite — e cada escolha dá uma linhagem", () => {
    for (const [choice, lineage] of [["asas", "vampire"], ["uivo", "werewolf"], ["nevoa", "haunted"], ["resistir", "hunter"]] as const) {
      const { char, world } = setup();
      world.minute = 160;
      expect(next(world, [char])).toBe("ch_despertar");
      choose(char, world, "ch_despertar", choice);
      expect(lineageOf(char)).toBe(lineage);
      world.eventHistory.ch_despertar = world.minute;
      expect(next(world, [char])).toBe(`ch_classe_${lineage}`);
    }
  });

  it("cada linhagem só vê as próprias classes, e a classe é escolhida uma vez", () => {
    expect(classesFor("vampire")).toHaveLength(4);
    expect(classesFor("werewolf")).toHaveLength(3);
    expect(classesFor("haunted")).toHaveLength(3);
    expect(classesFor("hunter")).toHaveLength(3);
    const { char, world } = setup();
    applyEffects(char, [{ op: "awaken", lineage: "werewolf" }], ctx(world));
    applyEffects(char, [{ op: "setClass", classId: "filhos_do_poco" }], ctx(world)); // é de vampiro: recusa
    expect(char.power?.classId ?? null).toBeNull();
    applyEffects(char, [{ op: "setClass", classId: "uivo_da_crista" }, { op: "setClass", classId: "dentes_de_ferro" }], ctx(world));
    expect(char.power?.classId).toBe("uivo_da_crista");
    expect(next(world, [char])).toBeUndefined();
  });

  it("toda classe tem 3 disciplinas, perdição e compulsão", () => {
    for (const k of CLASSES) {
      expect(k.powers).toHaveLength(2);
      expect(Object.keys(k.passive.bonus).length).toBeGreaterThan(0);
      expect(Object.values(k.bane.penalty).every((v) => (v ?? 0) < 0)).toBe(true);
      expect(k.compulsion.effects.length).toBeGreaterThan(0);
    }
  });

  it("disciplina passiva e perdição mexem nos testes de D20", () => {
    const { char, world } = setup();
    const base = { percepcao: checkChance(char, { attr: "percepcao", base: 50 }, 600), comunicacao: checkChance(char, { attr: "comunicacao", base: 50 }, 600) };
    applyEffects(char, [{ op: "awaken", lineage: "vampire" }, { op: "setClass", classId: "rasgados" }], ctx(world));
    // 600 = dia (sem bônus noturno de vampiro nesses atributos): sobra só a classe.
    expect(checkChance(char, { attr: "percepcao", base: 50 }, 600)).toBe(base.percepcao + 15);
    expect(checkChance(char, { attr: "comunicacao", base: 50 }, 600)).toBe(base.comunicacao - 20);
  });
});

describe("Disciplinas ativas, recurso e compulsão", () => {
  function vampireAt(world: WorldState, char: CharacterState, classId: string) {
    applyEffects(char, [{ op: "awaken", lineage: "vampire" }, { op: "setClass", classId }], ctx(world));
  }

  it("usar um poder gasta o recurso e aplica o efeito (rodada completa)", () => {
    const { char, world } = setup();
    vampireAt(world, char, "filhos_do_poco");
    char.wounds.push({ id: "w", bodyPart: "torso", type: "laceracao", severity: 2, bleedingRate: 5, bandaged: false, disinfected: false, splinted: false, createdAtMinute: 0, healed: false });
    const input = { type: "usar_poder" as const, params: { power: "sangue_que_fecha" } };
    const v = validateAction({ char, world, content, activeEvent: null }, input);
    expect(v.ok).toBe(true);
    const before = powerOf(char).resource;
    resolveRound({ world, chars: [char], content, actions: [{ ...input, id: "a1", characterId: char.id, minutes: 10, activity: "light", isOwner: true }], activeEvent: null, genId: randomUUID });
    expect(char.wounds[0].bleedingRate).toBe(0);
    expect(powerOf(char).resource).toBe(before + 2);
  });

  it("poder de outra classe ou só-noturno de dia é recusado", () => {
    const { char, world } = setup();
    vampireAt(world, char, "corte_da_crista");
    expect(validateAction({ char, world, content, activeEvent: null }, { type: "usar_poder", params: { power: "sumir" } }).ok).toBe(false);
    world.minute = 600; // dia
    expect(validateAction({ char, world, content, activeEvent: null }, { type: "usar_poder", params: { power: "presenca_fria" } }).ok).toBe(false);
  });

  it("a Fome do vampiro sobe com o tempo; no máximo, a compulsão acontece e alivia", () => {
    const { char, world } = setup();
    vampireAt(world, char, "febris");
    powerOf(char).resource = 4;
    const t = tickPowers(char, 400, 360, "idle");
    expect(t.compulsion?.name).toBe("Delírio");
    expect(powerOf(char).resource).toBe(3);
  });

  it("descansar alivia a Fúria/Eco/Obsessão (não a Fome)", () => {
    const { char, world } = setup();
    applyEffects(char, [{ op: "awaken", lineage: "hunter" }, { op: "setClass", classId: "vigias" }], ctx(world));
    powerOf(char).resource = 3;
    tickPowers(char, 400, 360, "sleep");
    expect(powerOf(char).resource).toBe(1);
  });

  it("proteção (ward) mantém as criaturas longe", () => {
    const { char, world } = setup();
    applyEffects(char, [{ op: "ward", minutes: 180 }], ctx(world));
    expect(nightEncounter(char, world, content, "morcego", constantRng(0.99), randomUUID, "atacar").reason).toBe("protegido");
  });
});

describe("Virada para o Ato II", () => {
  it("só liga quando TODOS os vivos têm classe; o Encontro exige o grupo reunido", () => {
    const a = setup("a"), b = setup("b");
    const world = a.world;
    const chars = [a.char, b.char];
    applyEffects(a.char, [{ op: "awaken", lineage: "vampire" }, { op: "setClass", classId: "filhos_do_poco" }], ctx(world));
    expect(checkActTwo(world, chars, content)).toBe(false);
    applyEffects(b.char, [{ op: "awaken", lineage: "hunter" }, { op: "setClass", classId: "remendeiros" }], ctx(world));
    expect(checkActTwo(world, chars, content)).toBe(true);
    expect(world.locations.abrigo.discovered).toBe(true);
    world.minute = 600;
    a.char.status.locationId = "abrigo";
    b.char.status.locationId = "mata";
    expect(next(world, chars)).not.toBe("ch_encontro");
    b.char.status.locationId = "abrigo";
    expect(next(world, chars)).toBe("ch_encontro");
  });

  it("Tavares (e o resto do Ato II) só depois do Encontro", () => {
    const { char, world } = setup();
    const ev = eventById(content, "ch_tavares")!;
    expect(ev.trigger.flagsAll).toContain("encontro_feito");
    expect(meetsRequirements(char, world, content, undefined).ok).toBe(true);
  });
});

describe("Pontos de partida e persistência (API)", () => {
  beforeEach(async () => {
    await freshApp();
  });

  it("a classe e o recurso sobrevivem ao salvar e carregar", async () => {
    const a = await registered("Iris");
    const id = await soloCampaign(a.client);
    const [char] = await loadCampaignCharacters(id);
    const world = initWorld(content, id, "s");
    applyEffects(char, [{ op: "awaken", lineage: "haunted" }, { op: "setClass", classId: "radio_escutas" }, { op: "buff", attr: "percepcao", bonus: 20, minutes: 60 }], ctx(world));
    powerOf(char).resource = 4;
    await saveCharacter(char);
    const [again] = await loadCampaignCharacters(id);
    expect(again.power?.classId).toBe("radio_escutas");
    expect(again.power?.resource).toBe(4);
    expect(again.power?.buffs[0].attr).toBe("percepcao");
    expect(lineageOf(again)).toBe("haunted");
    const st = await a.client.get(`/api/campaigns/${id}/state`);
    expect(st.body.me.power.className).toBe("Rádio-Escutas");
    expect(st.body.me.power.actions.map((x: { label: string }) => x.label)).toEqual(["Sintonizar", "Eco do Passado"]);
  });
});
