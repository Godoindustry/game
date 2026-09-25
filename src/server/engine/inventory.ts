/**
 * Inventário: peso, volume, compartimentos e acessibilidade.
 *
 * Compartimentos:
 *  - equipped: roupas e mochila vestidas (contam no peso, não no volume)
 *  - pockets: bolsos das roupas (volume pequeno, acesso rápido)
 *  - backpack_side: bolsos laterais da mochila (acesso rápido)
 *  - backpack_main: compartimento principal (+2 min para acessar)
 *  - hands: carregar nas mãos (1 volume grande)
 */
import type { CharacterState, Container, GameContent, InvItem, ItemDef } from "./types";
import { comfortableLoadKg, maxLoadKg } from "./character";
import { BACKPACK_MAIN_ACCESS_MINUTES, HANDS_MAX_ML, POCKETS_BASE_ML } from "./constants";

export function itemDef(content: GameContent, itemId: string): ItemDef {
  const def = content.items[itemId];
  if (!def) throw new Error(`Item desconhecido: ${itemId}`);
  return def;
}

export function equippedBackpack(char: CharacterState, content: GameContent): InvItem | undefined {
  return char.inventory.find(
    (i) => i.container === "equipped" && itemDef(content, i.itemId).clothing?.slot === "costas",
  );
}

export function containerCapacityMl(char: CharacterState, content: GameContent, container: Container): number {
  switch (container) {
    case "equipped":
      return Infinity;
    case "hands":
      return HANDS_MAX_ML;
    case "pockets": {
      const extra = char.inventory
        .filter((i) => i.container === "equipped")
        .reduce((s, i) => s + (itemDef(content, i.itemId).properties.pocketsMl ?? 0), 0);
      return POCKETS_BASE_ML + extra;
    }
    case "backpack_main":
    case "backpack_side": {
      const bag = equippedBackpack(char, content);
      if (!bag) return 0;
      const p = itemDef(content, bag.itemId).properties;
      return (container === "backpack_main" ? p.capacityMl : p.sideMl) ?? 0;
    }
  }
}

export function containerUsedMl(char: CharacterState, content: GameContent, container: Container): number {
  if (container === "equipped") return 0;
  return char.inventory
    .filter((i) => i.container === container)
    .reduce((s, i) => s + itemDef(content, i.itemId).volumeMl * i.quantity, 0);
}

export function totalWeightG(char: CharacterState, content: GameContent): number {
  return char.inventory.reduce((s, i) => s + itemDef(content, i.itemId).weightG * i.quantity, 0);
}

export function loadRatio(char: CharacterState, content: GameContent): number {
  return totalWeightG(char, content) / 1000 / comfortableLoadKg(char);
}

/** Multiplicador de tempo/energia pela carga. ≤50% da carga confortável = sem penalidade. */
export function encumbranceMultiplier(char: CharacterState, content: GameContent): number {
  const r = loadRatio(char, content);
  if (r <= 0.5) return 1;
  if (r <= 1) return 1 + (r - 0.5) * 0.4;
  return 1.2 + (r - 1) * 1.5;
}

export function canCarryExtra(char: CharacterState, content: GameContent, extraG: number): boolean {
  return (totalWeightG(char, content) + extraG) / 1000 <= maxLoadKg(char);
}

export function fitsIn(
  char: CharacterState,
  content: GameContent,
  container: Container,
  itemId: string,
  qty: number,
): boolean {
  const def = itemDef(content, itemId);
  if (container === "equipped") return false;
  if (container === "hands" && char.inventory.some((i) => i.container === "hands" && i.itemId !== itemId)) return false;
  return containerUsedMl(char, content, container) + def.volumeMl * qty <= containerCapacityMl(char, content, container);
}

const QUICK_CATEGORIES = new Set(["comida", "agua", "medico", "luz"]);

/** Escolhe o melhor compartimento livre; itens de uso rápido preferem bolsos laterais. */
export function pickContainer(
  char: CharacterState,
  content: GameContent,
  itemId: string,
  qty: number,
): Container | null {
  const def = itemDef(content, itemId);
  const order: Container[] = QUICK_CATEGORIES.has(def.category)
    ? ["backpack_side", "pockets", "backpack_main", "hands"]
    : ["backpack_main", "backpack_side", "pockets", "hands"];
  return order.find((c) => fitsIn(char, content, c, itemId, qty)) ?? null;
}

export function accessMinutes(item: InvItem): number {
  return item.container === "backpack_main" ? BACKPACK_MAIN_ACCESS_MINUTES : 0;
}

export function findItem(char: CharacterState, invItemId: unknown): InvItem | undefined {
  if (typeof invItemId !== "string") return undefined;
  return char.inventory.find((i) => i.id === invItemId);
}

export function countItem(char: CharacterState, itemId: string): number {
  return char.inventory.filter((i) => i.itemId === itemId).reduce((s, i) => s + i.quantity, 0);
}

export function hasItem(char: CharacterState, itemId: string): boolean {
  return countItem(char, itemId) > 0;
}

type NewItemState = Partial<Pick<InvItem, "battery" | "durability" | "usesLeft" | "contaminated" | "wetness">>;

export function newInvItem(
  content: GameContent,
  genId: () => string,
  itemId: string,
  container: Container,
  qty: number,
  state: NewItemState = {},
): InvItem {
  const def = itemDef(content, itemId);
  return {
    id: genId(),
    itemId,
    container,
    quantity: qty,
    durability: state.durability ?? def.maxDurability,
    battery: state.battery ?? def.batteryCapacity,
    usesLeft: state.usesLeft ?? def.defaultUses ?? null,
    wetness: state.wetness ?? 0,
    contaminated: state.contaminated ?? false,
  };
}

function sameState(a: InvItem, b: NewItemState): boolean {
  return (
    (b.contaminated ?? false) === a.contaminated &&
    (b.wetness ?? 0) === a.wetness &&
    b.usesLeft === undefined &&
    b.durability === undefined &&
    b.battery === undefined
  );
}

export type AddResult = { ok: true; container: Container } | { ok: false; reason: "peso" | "volume" };

/** Adiciona respeitando peso máximo e volume. Empilha quando possível. */
export function addItem(
  char: CharacterState,
  content: GameContent,
  genId: () => string,
  itemId: string,
  qty: number,
  state: NewItemState = {},
  preferred?: Container,
): AddResult {
  const def = itemDef(content, itemId);
  if (!canCarryExtra(char, content, def.weightG * qty)) return { ok: false, reason: "peso" };
  const container =
    preferred && fitsIn(char, content, preferred, itemId, qty) ? preferred : pickContainer(char, content, itemId, qty);
  if (!container) return { ok: false, reason: "volume" };
  if (def.stackable) {
    const stack = char.inventory.find(
      (i) => i.itemId === itemId && i.container === container && sameState(i, state) && i.quantity + qty <= def.maxStack,
    );
    if (stack) {
      stack.quantity += qty;
      return { ok: true, container };
    }
  }
  char.inventory.push(newInvItem(content, genId, itemId, container, qty, state));
  return { ok: true, container };
}

/** Remove `qty` unidades de um item (de qualquer pilha, priorizando acesso rápido). */
export function removeItem(char: CharacterState, itemId: string, qty = 1): boolean {
  if (countItem(char, itemId) < qty) return false;
  let left = qty;
  const stacks = char.inventory
    .filter((i) => i.itemId === itemId)
    .sort((a, b) => Number(a.container === "backpack_main") - Number(b.container === "backpack_main"));
  for (const s of stacks) {
    const take = Math.min(left, s.quantity);
    s.quantity -= take;
    left -= take;
    if (left === 0) break;
  }
  char.inventory = char.inventory.filter((i) => i.quantity > 0);
  return true;
}

export function removeInvItem(char: CharacterState, invItemId: string, qty: number): InvItem | null {
  const item = char.inventory.find((i) => i.id === invItemId);
  if (!item || qty < 1 || qty > item.quantity) return null;
  const taken: InvItem = { ...item, quantity: qty };
  item.quantity -= qty;
  if (item.quantity === 0) char.inventory = char.inventory.filter((i) => i !== item);
  return taken;
}

/** Resumo para a interface (peso/volume por compartimento). */
export function inventorySummary(char: CharacterState, content: GameContent) {
  const containers = (["pockets", "backpack_side", "backpack_main", "hands"] as Container[]).map((c) => ({
    container: c,
    usedMl: containerUsedMl(char, content, c),
    capacityMl: containerCapacityMl(char, content, c),
  }));
  return {
    weightKg: Math.round(totalWeightG(char, content) / 100) / 10,
    comfortableKg: comfortableLoadKg(char),
    maxKg: maxLoadKg(char),
    encumbrance: Math.round(encumbranceMultiplier(char, content) * 100) / 100,
    containers,
  };
}
