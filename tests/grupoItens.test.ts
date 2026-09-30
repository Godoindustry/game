import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import { initCharacter, initWorld } from "@/server/engine/setup";
import { validateCharacterSheet } from "@/server/engine/character";
import { countItem } from "@/server/engine/inventory";
import { resolveAction, validateAction, type ResolveContext } from "@/server/engine/actions";
import { locationResources, urgentNeed } from "@/server/engine/objective";
import { constantRng } from "@/server/engine/rng";
import type { CharacterState, WorldState } from "@/server/engine/types";
import { VALID_SHEET } from "./helpers";

function duo(): { a: CharacterState; b: CharacterState; world: WorldState } {
  const v = validateCharacterSheet(VALID_SHEET);
  if (!v.ok) throw new Error(v.error);
  const world = initWorld(content, "camp-grupo", "seed-grupo");
  const a = initCharacter(content, randomUUID, { id: "a", userId: "ua" }, v.sheet, v.finalAttributes);
  const b = initCharacter(content, randomUUID, { id: "b", userId: "ub" }, { ...v.sheet, name: "Bruno" }, v.finalAttributes);
  a.name = "Ana";
  b.name = "Bruno";
  return { a, b, world };
}

const run = (char: CharacterState, world: WorldState, party: CharacterState[], type: string, params: Record<string, unknown>) => {
  const notes: { id: string; text: string }[] = [];
  const v = validateAction({ char, world, content, activeEvent: null, party }, { type: type as never, params });
  if (!v.ok) throw new Error(v.error);
  const ctx: ResolveContext = {
    world, content, rng: constantRng(0), genId: randomUUID, minute: world.minute, lines: [], applied: [], extraMinutes: 0,
    party, notify: (id, text) => notes.push({ id, text }),
  };
  const rep = resolveAction(char, { type: type as never, params }, v.minutes, v.activity, ctx);
  return { rep, notes };
};

describe("Passar item e usar em um amigo", () => {
  it("passa 1 barra para o amigo ao lado, e ele é avisado", () => {
    const { a, b, world } = duo();
    const bar = a.inventory.find((i) => i.itemId === "barra_cereal")!;
    const before = countItem(b, "barra_cereal");
    const { notes } = run(a, world, [a, b], "dar_item", { inventoryItemId: bar.id, targetCharacterId: "b" });
    expect(countItem(b, "barra_cereal")).toBe(before + 1);
    expect(countItem(a, "barra_cereal")).toBe(1);
    expect(notes).toEqual([{ id: "b", text: "Ana passou para você: Barra de cereal." }]);
  });

  it("recusa quando o amigo está longe", () => {
    const { a, b, world } = duo();
    b.status.locationId = "ponte";
    const bar = a.inventory.find((i) => i.itemId === "barra_cereal")!;
    const v = validateAction({ char: a, world, content, activeEvent: null, party: [a, b] }, { type: "dar_item", params: { inventoryItemId: bar.id, targetCharacterId: "b" } });
    expect(v).toMatchObject({ ok: false });
    expect(!v.ok && v.error).toMatch(/longe/);
  });

  it("dar de comer mata a fome do amigo, não a sua", () => {
    const { a, b, world } = duo();
    a.status.hunger = 60;
    b.status.hunger = 60;
    const bar = a.inventory.find((i) => i.itemId === "barra_cereal")!;
    run(a, world, [a, b], "usar_em_amigo", { inventoryItemId: bar.id, targetCharacterId: "b" });
    expect(b.status.hunger).toBeLessThan(60);
    expect(a.status.hunger).toBeGreaterThanOrEqual(60);
  });

  it("enfaixar o amigo usa a atadura de quem enfaixa e estanca o sangue dele", () => {
    const { a, b, world } = duo();
    b.wounds.push({ id: "wb", bodyPart: "torso", type: "laceracao", severity: 2, bleedingRate: 3, bandaged: false, disinfected: false, splinted: false, createdAtMinute: 0, healed: false });
    const bandage = a.inventory.find((i) => i.itemId === "atadura")!;
    const mine = countItem(a, "atadura");
    const { rep, notes } = run(a, world, [a, b], "usar_em_amigo", { inventoryItemId: bandage.id, targetCharacterId: "b" });
    expect(countItem(a, "atadura")).toBe(mine - 1);
    expect(rep.effects.join(" ")).toMatch(/teste medicina/i); // o teste é de quem enfaixa
    const w = b.wounds.find((x) => x.id === "wb")!;
    expect(w.bleedingRate).toBeLessThan(3);
    expect(notes[0].id).toBe("b");
  });

  it("item sem uso em outra pessoa não aparece como opção válida", () => {
    const { a, b, world } = duo();
    const phone = a.inventory.find((i) => i.itemId === "celular")!;
    const v = validateAction({ char: a, world, content, activeEvent: null, party: [a, b] }, { type: "usar_em_amigo", params: { inventoryItemId: phone.id, targetCharacterId: "b" } });
    expect(v).toMatchObject({ ok: false, error: "Esse item não tem uso em outra pessoa." });
  });
});

describe("Recursos para sobreviver", () => {
  it("bebe direto do córrego (sem garrafa) e do tambor de chuva do acampamento", () => {
    const { a, world } = duo();
    a.status.thirst = 80;
    a.status.locationId = "ponte";
    run(a, world, [a], "beber_fonte", {});
    expect(a.status.thirst).toBeLessThan(50);
    a.status.locationId = "abrigo";
    a.status.thirst = 80;
    const { rep } = run(a, world, [a], "beber_fonte", {});
    expect(rep.lines.join(" ")).toMatch(/chuva/);
    expect(a.health.diseases.some((d) => d.key === "gastroenterite")).toBe(false);
  });

  it("a mata tem frutos que não acabam", () => {
    const { a, world } = duo();
    a.status.locationId = "mata";
    world.locations.mata.loot = world.locations.mata.loot.map(() => 0);
    let found = 0;
    for (let i = 0; i < 6; i++) {
      const ctx: ResolveContext = { world, content, rng: constantRng(0), genId: randomUUID, minute: world.minute, lines: [], applied: [], extraMinutes: 0 };
      resolveAction(a, { type: "procurar", params: {} }, 10, "light", ctx);
      found = countItem(a, "frutos_silvestres");
    }
    expect(found).toBeGreaterThan(0);
  });

  it("o aviso de sede aponta a água mais perto", () => {
    const { a, world } = duo();
    world.locations.abrigo.discovered = true;
    a.inventory = a.inventory.filter((i) => i.itemId !== "garrafa_agua");
    a.status.thirst = 80;
    const u = urgentNeed(a, world, content)!;
    expect(u.hint).toMatch(/Acampamento/);
    expect(locationResources(world, content, "abrigo").map((r) => r.key)).toContain("agua_limpa");
  });
});
