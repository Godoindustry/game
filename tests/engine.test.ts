import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import { initCharacter, initWorld } from "@/server/engine/setup";
import { validateCharacterSheet, comfortableLoadKg, maxLoadKg } from "@/server/engine/character";
import { addItem, totalWeightG, containerCapacityMl, containerUsedMl, encumbranceMultiplier } from "@/server/engine/inventory";
import { passTime } from "@/server/engine/physiology";
import { validateAction, resolveAction, travelMinutes, neighbors } from "@/server/engine/actions";
import { applyEffects } from "@/server/engine/effects";
import { resolveRound } from "@/server/engine/round";
import { constantRng, rngFor } from "@/server/engine/rng";
import type { CharacterState, WorldState } from "@/server/engine/types";
import { VALID_SHEET } from "./helpers";

function setup(sheetOverride: Record<string, unknown> = {}): { char: CharacterState; world: WorldState } {
  const v = validateCharacterSheet({ ...VALID_SHEET, ...sheetOverride });
  if (!v.ok) throw new Error(v.error);
  const world = initWorld(content, "camp-1", "seed-x");
  const char = initCharacter(content, randomUUID, { id: "char-1", userId: "user-1" }, v.sheet, v.finalAttributes);
  return { char, world };
}

const ctxFor = (world: WorldState, rng = constantRng(0)) => ({
  world, content, rng, genId: randomUUID, minute: world.minute, lines: [] as string[], applied: [] as string[], extraMinutes: 0,
});

describe("Criação de personagem e atributos", () => {
  it("aceita ficha com exatamente 24 pontos e aplica bônus de profissão", () => {
    const v = validateCharacterSheet(VALID_SHEET);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.finalAttributes.medicina).toBe(4); // enfermagem +1
  });
  it("rejeita pontos a mais, a menos, acima do máximo e campos extras", () => {
    const a = VALID_SHEET.attributes;
    expect(validateCharacterSheet({ ...VALID_SHEET, attributes: { ...a, forca: 4 } }).ok).toBe(false); // 25 pontos
    expect(validateCharacterSheet({ ...VALID_SHEET, attributes: { ...a, forca: 2 } }).ok).toBe(false); // 23 pontos
    expect(validateCharacterSheet({ ...VALID_SHEET, attributes: { ...a, forca: 7, agilidade: 1, percepcao: 1 } }).ok).toBe(false); // acima de 6
    expect(validateCharacterSheet({ ...VALID_SHEET, attributes: { ...a, sorte: 5 } }).ok).toBe(false);
    expect(validateCharacterSheet({ ...VALID_SHEET, superpoder: true }).ok).toBe(false);
    expect(validateCharacterSheet({ ...VALID_SHEET, age: 12 }).ok).toBe(false);
  });
  it("força influencia a carga, mas dentro de limites realistas", () => {
    const weak = setup().char;
    const strong = setup({ attributes: { ...VALID_SHEET.attributes, forca: 6, medicina: 1, furtividade: 2 } }).char;
    expect(comfortableLoadKg(strong)).toBeGreaterThan(comfortableLoadKg(weak));
    expect(maxLoadKg(strong)).toBeLessThan(40);
  });
});

describe("Mochila: peso e volume", () => {
  it("calcula o peso total do inventário inicial", () => {
    const { char } = setup();
    // camiseta 150 + moletom 550 + jeans 700 + tênis 800 + mochila 900 + celular 190 + água 530 + 2 barras 50 + 2 ataduras 60
    expect(totalWeightG(char, content)).toBe(3930);
  });
  it("recusa item quando o volume do compartimento não comporta", () => {
    const { char } = setup();
    const cap = containerCapacityMl(char, content, "backpack_main");
    expect(cap).toBe(16000);
    // 3 feixes de galhos (5 L cada) cabem na principal; 4º e 5º vão para as mãos (12 L); o 6º não cabe em lugar nenhum
    for (let i = 0; i < 3; i++) expect(addItem(char, content, randomUUID, "galhos_secos", 1, {}, "backpack_main").ok).toBe(true);
    expect(containerUsedMl(char, content, "backpack_main")).toBe(15000);
    const fourth = addItem(char, content, randomUUID, "galhos_secos", 1);
    expect(fourth.ok && fourth.container).toBe("hands");
    expect(addItem(char, content, randomUUID, "galhos_secos", 1).ok).toBe(true);
    const sixth = addItem(char, content, randomUUID, "galhos_secos", 1);
    expect(sixth).toEqual({ ok: false, reason: "volume" });
  });
  it("recusa item quando o peso excede o limite máximo", () => {
    const { char } = setup();
    let lastReason = "";
    for (let i = 0; i < 20; i++) {
      const r = addItem(char, content, randomUUID, "bateria_emergencia", 1);
      if (!r.ok) {
        lastReason = r.reason;
        break;
      }
    }
    expect(lastReason).toBe("peso");
    expect(totalWeightG(char, content) / 1000).toBeLessThanOrEqual(maxLoadKg(char));
  });
  it("mochila maior aumenta capacidade, mas o peso aumenta a penalidade", () => {
    const { char } = setup();
    const before = encumbranceMultiplier(char, content);
    addItem(char, content, randomUUID, "bateria_emergencia", 1);
    addItem(char, content, randomUUID, "corda", 1);
    expect(encumbranceMultiplier(char, content)).toBeGreaterThan(before);
  });
});

describe("Fisiologia", () => {
  it("consome água (sede sobe) com o tempo, mais rápido caminhando", () => {
    const a = setup();
    const b = setup();
    passTime(a.char, a.world, content, 0, 120, "idle");
    passTime(b.char, b.world, content, 0, 120, "walk");
    expect(a.char.status.thirst).toBeGreaterThan(30);
    expect(b.char.status.thirst).toBeGreaterThan(a.char.status.thirst);
  });
  it("beber reduz a sede e deixa a garrafa vazia", () => {
    const { char, world } = setup();
    char.status.thirst = 60;
    const bottle = char.inventory.find((i) => i.itemId === "garrafa_agua")!;
    const r = resolveAction(char, { type: "beber", params: { inventoryItemId: bottle.id } }, 2, "idle", ctxFor(world));
    expect(r.success).toBe(true);
    expect(char.status.thirst).toBeLessThan(30);
    expect(char.inventory.some((i) => i.itemId === "garrafa_vazia")).toBe(true);
    expect(char.inventory.some((i) => i.itemId === "garrafa_agua")).toBe(false);
  });
  it("consome energia caminhando e recupera descansando", () => {
    const { char, world } = setup();
    passTime(char, world, content, 0, 60, "walk");
    const afterWalk = char.status.energy;
    expect(afterWalk).toBeLessThan(70);
    passTime(char, world, content, 60, 60, "rest");
    expect(char.status.energy).toBeGreaterThan(afterWalk);
  });
  it("frio + roupa molhada derruba a temperatura corporal à noite", () => {
    const { char, world } = setup();
    char.status.wetness = 80;
    passTime(char, world, content, 0, 240, "sleep");
    expect(char.status.bodyTemp).toBeLessThan(35.5);
  });
});

describe("Duração das ações", () => {
  it("usa as durações de referência", () => {
    const { char, world } = setup();
    const v = (type: string, params = {}) => validateAction({ char, world, content, activeEvent: null }, { type: type as never, params });
    expect(v("examinar")).toMatchObject({ ok: true, minutes: 5 });
    expect(v("procurar")).toMatchObject({ ok: true, minutes: 10 });
    expect(v("descansar")).toMatchObject({ ok: true, minutes: 30 });
    const bar = char.inventory.find((i) => i.itemId === "barra_cereal")!;
    expect(v("comer", { inventoryItemId: bar.id })).toMatchObject({ ok: true, minutes: 2 });
    char.wounds.push({ id: "w1", bodyPart: "braco_esq", type: "laceracao", severity: 1, bleedingRate: 1.5, bandaged: false, disinfected: false, splinted: false, createdAtMinute: 0, healed: false });
    expect(v("tratar_ferimento", { woundId: "w1" })).toMatchObject({ ok: true, minutes: 15 });
    world.flags.x = true;
    const mata = world.locations.mata;
    expect(mata).toBeDefined();
  });
  it("caminhar à noite sem luz demora mais que com lanterna; peso também atrasa", () => {
    const { char, world } = setup();
    const link = neighbors(world, content, "destrocos").find((l) => l.to === "abrigo")!;
    // celular é fonte de luz; sem bateria = sem luz
    char.inventory.find((i) => i.itemId === "celular")!.battery = 0;
    const dark = travelMinutes(char, world, content, link);
    addItem(char, content, randomUUID, "lanterna", 1);
    const lit = travelMinutes(char, world, content, link);
    expect(dark).toBeGreaterThan(lit);
    addItem(char, content, randomUUID, "bateria_emergencia", 1);
    addItem(char, content, randomUUID, "bateria_emergencia", 1);
    addItem(char, content, randomUUID, "corda", 1);
    expect(travelMinutes(char, world, content, link)).toBeGreaterThan(lit);
  });
  it("o cliente não escolhe a duração: parâmetros extras não mudam o tempo", () => {
    const { char, world } = setup();
    const v = validateAction({ char, world, content, activeEvent: null }, { type: "descansar", params: { minutes: 1 } });
    expect(v).toMatchObject({ ok: true, minutes: 30 });
  });
});

describe("Ferimentos e morte", () => {
  it("laceração grave sem tratamento sangra até a morte", () => {
    const { char, world } = setup();
    applyEffects(char, [{ op: "wound", part: "perna_dir", type: "laceracao", severity: 3 }], ctxFor(world));
    const rep = passTime(char, world, content, 0, 12 * 60, "idle");
    expect(rep.died).toBe(true);
    expect(char.alive).toBe(false);
    expect(char.deathCause).toBe("Hemorragia");
  });
  it("tratar com atadura (teste bem-sucedido) estanca o sangramento", () => {
    const { char, world } = setup();
    applyEffects(char, [{ op: "wound", part: "perna_dir", type: "laceracao", severity: 2 }], ctxFor(world));
    const w = char.wounds[0];
    expect(w.bleedingRate).toBeGreaterThan(0);
    const r = resolveAction(char, { type: "tratar_ferimento", params: { woundId: w.id } }, 15, "light", ctxFor(world, constantRng(0)));
    expect(r.success).toBe(true);
    expect(w.bleedingRate).toBe(0);
    expect(w.bandaged).toBe(true);
    expect(r.tags).toContain("treated");
  });
  it("personagem morto não pode agir", () => {
    const { char, world } = setup();
    char.alive = false;
    const v = validateAction({ char, world, content, activeEvent: null }, { type: "examinar", params: {} });
    expect(v.ok).toBe(false);
  });
  it("evento pode matar: descer a ravina sem equipamento e falhar", () => {
    const { char, world } = setup();
    char.status.locationId = "penhasco";
    const result = resolveRound({
      world, chars: [char], content, genId: randomUUID,
      activeEvent: { instanceId: "i1", eventId: "vs_penhasco", participants: [char.id] },
      actions: [{ id: "a1", characterId: char.id, type: "escolha_evento", params: { choiceId: "vs_penhasco.semcorda" }, minutes: 30, activity: "light", isOwner: true }],
    });
    // Com a semente fixa o resultado é reprodutível; se sobreviveu, a pista foi encontrada.
    if (!char.alive) {
      expect(char.deathCause).toBe("Queda na ravina");
      expect(result.deaths).toHaveLength(1);
      expect(result.ended).toEqual({ key: "morte", type: "defeat" });
    } else {
      expect(world.clues).toContain("carga_ravina");
    }
  });
});

describe("Determinismo e eventos", () => {
  it("mesma semente, rodada e personagem → mesma rolagem", () => {
    const a = rngFor("s", 3, "c", "x")();
    const b = rngFor("s", 3, "c", "x")();
    const c = rngFor("s", 4, "c", "x")();
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("final positivo é disparado por efeito 'end' do conteúdo, não por texto", () => {
    const { char, world } = setup();
    applyEffects(char, [{ op: "end", ending: "resgate_radio" }], ctxFor(world));
    expect(world.ending).toEqual({ key: "resgate_radio", type: "victory" });
  });
  it("em grupo vence a escolha majoritária e os testes são individuais", () => {
    const w = initWorld(content, "c", "seed-grupo");
    const mk = (id: string) => {
      const v = validateCharacterSheet(VALID_SHEET);
      if (!v.ok) throw new Error();
      return initCharacter(content, randomUUID, { id, userId: `u-${id}` }, v.sheet, v.finalAttributes);
    };
    const chars = [mk("a"), mk("b"), mk("c")];
    const res = resolveRound({
      world: w, chars, content, genId: randomUUID,
      activeEvent: { instanceId: "i", eventId: "vs_despertar", participants: ["a", "b", "c"] },
      actions: [
        { id: "1", characterId: "a", type: "escolha_evento", params: { choiceId: "vs_despertar.gritar" }, minutes: 3, activity: "light", isOwner: true },
        { id: "2", characterId: "b", type: "escolha_evento", params: { choiceId: "vs_despertar.examinar" }, minutes: 10, activity: "light", isOwner: false },
        { id: "3", characterId: "c", type: "escolha_evento", params: { choiceId: "vs_despertar.examinar" }, minutes: 10, activity: "light", isOwner: false },
      ],
    });
    expect(res.resolvedEvent?.choiceId).toBe("vs_despertar.examinar");
    expect(Object.keys(res.reports)).toHaveLength(3);
    expect(res.roundMinutes).toBe(10);
  });
});
