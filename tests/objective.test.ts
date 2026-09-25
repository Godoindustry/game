import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import { initCharacter, initWorld } from "@/server/engine/setup";
import { validateCharacterSheet } from "@/server/engine/character";
import { addItem } from "@/server/engine/inventory";
import { currentObjective, urgentNeed } from "@/server/engine/objective";
import { bodyCondition, conditionLine, conditionWords } from "@/server/engine/condition";
import type { CharacterState, WorldState } from "@/server/engine/types";
import { VALID_SHEET } from "./helpers";

function setup(): { char: CharacterState; world: WorldState } {
  const v = validateCharacterSheet(VALID_SHEET);
  if (!v.ok) throw new Error(v.error);
  const world = initWorld(content, "camp-1", "seed-x");
  const char = initCharacter(content, randomUUID, { id: "char-1", userId: "user-1" }, v.sheet, v.finalAttributes);
  return { char, world };
}

describe("Bússola de objetivo", () => {
  it("começa pela rota do rádio, apontando para a bateria nos destroços", () => {
    const { char, world } = setup();
    const o = currentObjective(char, world, content)!;
    expect(o.routeId).toBe("radio");
    expect(o.stepIndex).toBe(0);
    expect(o.targetLocationId).toBe("destrocos");
    expect(o.bearing).toBeNull(); // já está lá
    expect(o.others).toHaveLength(1);
  });

  it("avança de etapa ao pegar a bateria e ao abrir a estação", () => {
    const { char, world } = setup();
    addItem(char, content, randomUUID, "bateria_emergencia", 1, {}, "hands");
    const toStation = currentObjective(char, world, content)!;
    expect(toStation.label).toMatch(/estação/);
    expect(toStation.targetLocationId).toBe("estacao"); // visível desde o início, mesmo sem visitar
    expect(toStation.targetOnMap).toBe(false);
    expect(toStation.bearing!.to.x).toBeGreaterThan(toStation.bearing!.from.x); // a leste
    world.flags.estacao_aberta = true;
    const o = currentObjective(char, world, content)!;
    expect(o.stepIndex).toBe(2);
    expect(o.label).toMatch(/rádio/);
  });

  it("troca para a rota do sinal quando ela está mais adiantada", () => {
    const { char, world } = setup();
    world.flags.busca_ativa = true;
    const o = currentObjective(char, world, content)!;
    expect(o.routeId).toBe("sinal");
    expect(o.stepIndex).toBe(1);
  });

  it("não aponta para um local ainda escondido", () => {
    const { char, world } = setup();
    world.flags.busca_ativa = true;
    addItem(char, content, randomUUID, "sinalizador", 1);
    const o = currentObjective(char, world, content)!;
    expect(o.stepIndex).toBe(2);
    expect(world.locations.rochedo.discovered).toBe(false);
    expect(o.targetLocationId).toBe("penhasco");
    world.locations.rochedo.discovered = true;
    expect(currentObjective(char, world, content)!.targetLocationId).toBe("rochedo");
  });

  it("sangramento tem prioridade sobre sede", () => {
    const { char } = setup();
    expect(urgentNeed(char)).toBeNull();
    char.status.thirst = 80;
    expect(urgentNeed(char)!.label).toMatch(/Beba/);
    char.wounds.push({ id: "w1", bodyPart: "braco_esq", type: "corte", severity: 1, bleedingRate: 2, bandaged: false, disinfected: false, splinted: false, createdAtMinute: 0, healed: false });
    expect(urgentNeed(char)!.label).toMatch(/sangramento/);
  });

  it("o kit inicial tem atadura para o tutorial de sangramento", () => {
    const { char } = setup();
    expect(char.inventory.some((i) => i.itemId === "atadura" && i.container === "pockets")).toBe(true);
  });
});

describe("Condição do corpo para o narrador", () => {
  it("descreve o corpo em palavras, sem números, do mais grave ao menos grave", () => {
    const { char } = setup();
    expect(bodyCondition(char)).toEqual([]);
    expect(conditionLine([], 3)).toBe("");
    char.status.hunger = 80;
    char.status.bodyTemp = 34.5;
    const keys = bodyCondition(char);
    expect(keys[0]).toBe("hipotermia");
    expect(conditionWords(keys).join(" ")).not.toMatch(/\d/);
    expect(conditionLine(keys, 7)).toMatch(/\S/);
  });
});
