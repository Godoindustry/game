import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import { initCharacter, initWorld } from "@/server/engine/setup";
import { validateCharacterSheet } from "@/server/engine/character";
import { addItem } from "@/server/engine/inventory";
import { resolveAction, validateAction } from "@/server/engine/actions";
import { currentObjective } from "@/server/engine/objective";
import { constantRng } from "@/server/engine/rng";
import type { ActiveEvent, CharacterState, WorldState } from "@/server/engine/types";
import { VALID_SHEET } from "./helpers";

function setup(): { char: CharacterState; world: WorldState } {
  const v = validateCharacterSheet(VALID_SHEET);
  if (!v.ok) throw new Error(v.error);
  const world = initWorld(content, "camp-mp", "seed-mp");
  const char = initCharacter(content, randomUUID, { id: "char-1", userId: "user-1" }, v.sheet, v.finalAttributes);
  return { char, world };
}

const bleed = (char: CharacterState) =>
  char.wounds.push({ id: "w1", bodyPart: "braco_esq", type: "laceracao", severity: 1, bleedingRate: 2, bandaged: false, disinfected: false, splinted: false, createdAtMinute: 0, healed: false });

describe("Tratamento explícito por material", () => {
  it("antisséptico escolhido não gasta atadura nem para o sangue", () => {
    const { char, world } = setup();
    bleed(char);
    addItem(char, content, randomUUID, "antisseptico", 1);
    const bandages = char.inventory.filter((i) => i.itemId === "atadura").length;
    expect(validateAction({ char, world, content, activeEvent: null }, { type: "tratar_ferimento", params: { woundId: "w1", material: "antisseptico" } }).ok).toBe(true);
    resolveAction(char, { type: "tratar_ferimento", params: { woundId: "w1", material: "antisseptico" } }, 15, "light", {
      world, content, rng: constantRng(0), genId: randomUUID, minute: world.minute, lines: [], applied: [], extraMinutes: 0,
    });
    const w = char.wounds.find((x) => x.id === "w1")!;
    expect(w.disinfected).toBe(true);
    expect(w.bleedingRate).toBeGreaterThan(0);
    expect(char.inventory.filter((i) => i.itemId === "atadura").length).toBe(bandages);
  });

  it("sem atadura, pedir atadura explica o que falta", () => {
    const { char, world } = setup();
    bleed(char);
    char.inventory = char.inventory.filter((i) => i.itemId !== "atadura");
    const v = validateAction({ char, world, content, activeEvent: null }, { type: "tratar_ferimento", params: { woundId: "w1", material: "atadura" } });
    expect(v).toMatchObject({ ok: false, error: "Você não tem atadura." });
  });

  it("dá para estancar o sangue no meio de um evento, mas não fazer outras ações", () => {
    const { char, world } = setup();
    bleed(char);
    const activeEvent: ActiveEvent = { instanceId: "i1", eventId: "vs_despertar", participants: [char.id] };
    expect(validateAction({ char, world, content, activeEvent }, { type: "tratar_ferimento", params: { woundId: "w1" } }).ok).toBe(true);
    expect(validateAction({ char, world, content, activeEvent }, { type: "procurar", params: {} }).ok).toBe(false);
  });
});

describe("Encontro do grupo", () => {
  it("depois do Ato II a bússola leva todos ao ponto de encontro", () => {
    const { char, world } = setup();
    world.flags.ato2 = true;
    const obj = currentObjective(char, world, content);
    expect(obj?.routeId).toBe("encontro");
    expect(obj?.targetLocationId).toBe(content.meetingLocation);
    world.flags.encontro_feito = true;
    expect(currentObjective(char, world, content)?.routeId).not.toBe("encontro");
  });

  it("quem não pegou a bateria não fica preso nesse passo depois que o bagageiro foi aberto", () => {
    const { char, world } = setup();
    world.flags.bagageiro_aberto = true;
    const obj = currentObjective(char, world, content);
    expect(obj?.label).not.toMatch(/bateria/i);
  });
});

describe("História sem becos sem saída", () => {
  it("toda saída do 'Motor na ponte' dá a pista que chama Tavares", () => {
    const ev = content.events.find((e) => e.id === "vs_donos_carga")!;
    for (const ch of ev.choices) {
      const o = ch.outcome;
      const branches = o.check ? [o.success, o.failure] : [o];
      for (const b of branches) expect(JSON.stringify(b?.effects ?? []), `${ch.id}`).toContain('"donos_carga"');
    }
  });

  it("a caixa do rochedo volta até ser aberta; o bagageiro ganha saída garantida após tentar", () => {
    const rochedo = content.events.find((e) => e.id === "vs_rochedo")!;
    expect(rochedo.repeatable).toBe(true);
    expect(rochedo.trigger.flagsNone).toContain("caixa_rochedo_aberta");
    const bag = content.events.find((e) => e.id === "vs_bagageiro")!;
    const calma = bag.choices.find((c) => c.id === "vs_bagageiro.calma")!;
    expect(calma.outcome.check).toBeUndefined();
    expect(calma.requirements?.flagsAll).toContain("bagageiro_forcado");
  });

  it("'Céu aberto' só aparece quando o resgate é possível", () => {
    const ev = content.events.find((e) => e.id === "vs_resgate")!;
    expect(ev.trigger.flagsAll).toEqual(expect.arrayContaining(["tavares_resolvido", "sinal_final_alinhado"]));
  });

  it("ferida leve para de sangrar sozinha em poucas horas", async () => {
    const { passTime } = await import("@/server/engine/physiology");
    const { char, world } = setup();
    bleed(char);
    passTime(char, world, content, world.minute, 180, "rest");
    expect(char.wounds[0].bleedingRate).toBe(0);
  });
});
