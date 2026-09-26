/**
 * Testes de atributo e aplicação de efeitos declarativos (vindos do conteúdo).
 * Este é o ÚNICO caminho pelo qual eventos alteram estado: a IA não chega aqui.
 */
import type {
  CharacterState,
  CheckDef,
  ChoiceRequirements,
  Effect,
  GameContent,
  WorldState,
} from "./types";
import type { Rng } from "./rng";
import { hasExperience } from "./character";
import { addItem, countItem, hasItem, itemDef, removeItem } from "./inventory";
import { clamp, clothingWaterResistance, initialBleeding, isSheltered, kill, passTime } from "./physiology";
import { applyBite } from "./vampire";

export interface EffectContext {
  world: WorldState;
  content: GameContent;
  rng: Rng;
  genId: () => string;
  /** Minuto (relógio da campanha) em que o efeito acontece. */
  minute: number;
  lines: string[];
  applied: string[];
  extraMinutes: number;
}

// ---------- Testes ----------
export function checkChance(char: CharacterState, check: CheckDef, worldMinute: number): number {
  const attr = char.attrs[check.attr];
  let chance = check.base + (attr - 3) * 9;
  if (check.experience && hasExperience(char, check.experience)) chance += 15;
  for (const [item, bonus] of Object.entries(check.itemBonus ?? {})) {
    if (hasItem(char, item)) chance += bonus;
  }
  chance -= char.status.pain / 5;
  chance -= Math.max(0, char.status.stress - 60) / 2;
  if (char.status.energy < 20) chance -= 10;
  if (char.status.fatigue > 85) chance -= 8;
  void worldMinute;
  return Math.round(clamp(chance, 5, 95));
}

export function rollCheck(char: CharacterState, check: CheckDef, rng: Rng, worldMinute: number) {
  const chance = checkChance(char, check, worldMinute);
  const roll = Math.floor(rng() * 100);
  return { success: roll < chance, chance, roll };
}

// ---------- Requisitos ----------
export function meetsRequirements(
  char: CharacterState,
  world: WorldState,
  content: GameContent,
  req: ChoiceRequirements | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!req) return { ok: true };
  for (const it of req.hasItem ?? []) {
    if (!hasItem(char, it)) return { ok: false, reason: `Requer: ${content.items[it]?.name ?? it}` };
  }
  if (req.hasAnyItem && !req.hasAnyItem.some((it) => hasItem(char, it))) {
    return { ok: false, reason: `Requer um destes: ${req.hasAnyItem.map((i) => content.items[i]?.name ?? i).join(", ")}` };
  }
  if (req.hasAnyCategory && !char.inventory.some((i) => req.hasAnyCategory!.includes(itemDef(content, i.itemId).category))) {
    return { ok: false, reason: "Você não tem o item necessário." };
  }
  for (const f of req.flagsAll ?? []) if (!world.flags[f]) return { ok: false, reason: "Ainda não é possível." };
  for (const f of req.flagsNone ?? []) if (world.flags[f]) return { ok: false, reason: "Não é mais possível." };
  if (req.cluesAny && !req.cluesAny.some((c) => world.clues.includes(c))) {
    return { ok: false, reason: "Você não sabe o suficiente para isso." };
  }
  if (req.atShelter && !isSheltered(world, content, char.status.locationId)) {
    return { ok: false, reason: "Você não está sob abrigo." };
  }
  return { ok: true };
}

// ---------- Efeitos ----------
export function linkKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function revealLocation(world: WorldState, locationId: string): boolean {
  const loc = world.locations[locationId];
  if (!loc || loc.discovered) return false;
  loc.discovered = true;
  return true;
}

export function applyEffects(char: CharacterState, effects: Effect[] | undefined, ctx: EffectContext): void {
  for (const e of effects ?? []) {
    if (!char.alive && e.op !== "flag" && e.op !== "clue") continue;
    applyEffect(char, e, ctx);
  }
}

function applyEffect(char: CharacterState, e: Effect, ctx: EffectContext): void {
  const { world, content } = ctx;
  const s = char.status;
  switch (e.op) {
    case "status": {
      if (e.field === "bodyTemp") s.bodyTemp = Math.round((s.bodyTemp + e.delta) * 100) / 100;
      else s[e.field] = clamp(s[e.field] + e.delta, 0, 100);
      ctx.applied.push(`${e.field} ${e.delta > 0 ? "+" : ""}${e.delta}`);
      break;
    }
    case "health":
      char.health.health = clamp(char.health.health + e.delta, 0, 100);
      ctx.applied.push(`saúde ${e.delta > 0 ? "+" : ""}${e.delta}`);
      if (char.health.health <= 0) kill(char, "Ferimentos graves", ctx.minute);
      break;
    case "infection":
      char.health.infection = clamp(char.health.infection + e.delta, 0, 100);
      break;
    case "wet": {
      const gain = e.amount * (1 - clothingWaterResistance(char, content) / 100);
      s.wetness = clamp(s.wetness + gain, 0, 100);
      ctx.applied.push(`umidade +${Math.round(gain)}`);
      break;
    }
    case "wound": {
      char.wounds.push({
        id: ctx.genId(),
        bodyPart: e.part,
        type: e.type,
        severity: e.severity,
        bleedingRate: initialBleeding(e.type, e.severity),
        bandaged: false,
        disinfected: false,
        splinted: false,
        createdAtMinute: ctx.minute,
        healed: false,
      });
      ctx.applied.push(`ferimento: ${e.type} (${e.part}, gravidade ${e.severity})`);
      break;
    }
    case "addItem": {
      const qty = e.qty ?? 1;
      const res = addItem(char, content, ctx.genId, e.item, qty, e.state ?? {});
      const name = content.items[e.item]?.name ?? e.item;
      if (res.ok) ctx.applied.push(`+${qty} ${name}`);
      else {
        world.ground.push({ id: ctx.genId(), locationId: s.locationId, itemId: e.item, quantity: qty, state: e.state ?? {} });
        ctx.lines.push(`Sem ${res.reason === "peso" ? "força para carregar" : "espaço"} para ${name}: ficou no chão.`);
      }
      break;
    }
    case "removeItem":
      if (removeItem(char, e.item, e.qty ?? 1)) ctx.applied.push(`-${e.qty ?? 1} ${content.items[e.item]?.name ?? e.item}`);
      break;
    case "consumeAny": {
      const target = char.inventory.find((i) => e.categories.includes(itemDef(content, i.itemId).category));
      if (target) {
        const def = itemDef(content, target.itemId);
        removeItem(char, target.itemId, 1);
        if (def.properties.emptiesTo) addItem(char, content, ctx.genId, def.properties.emptiesTo, 1);
        ctx.applied.push(`-1 ${def.name}`);
      }
      break;
    }
    case "itemDurability": {
      const it = char.inventory.find((i) => i.itemId === e.item && i.durability !== null);
      if (it && it.durability !== null) {
        it.durability = Math.max(0, it.durability + e.delta);
        if (it.durability === 0) {
          char.inventory = char.inventory.filter((i) => i !== it);
          ctx.lines.push(`${content.items[e.item].name} ficou inutilizável.`);
        }
      }
      break;
    }
    case "useCharge": {
      const it = char.inventory.find((i) => i.itemId === e.item);
      if (it) {
        if (it.usesLeft !== null) {
          it.usesLeft -= 1;
          if (it.usesLeft <= 0) removeItem(char, e.item, 1);
        } else removeItem(char, e.item, 1);
      }
      break;
    }
    case "flag":
      world.flags[e.key] = e.value ?? true;
      break;
    case "flagAdd":
      world.flags[e.key] = Number(world.flags[e.key] ?? 0) + e.delta;
      break;
    case "clue":
      if (!world.clues.includes(e.key)) {
        world.clues.push(e.key);
        ctx.lines.push(`🔎 Nova pista: ${content.clues[e.key]?.title ?? e.key}`);
        ctx.applied.push(`pista: ${e.key}`);
      }
      break;
    case "reveal":
      if (revealLocation(world, e.location)) ctx.lines.push(`🗺️ Novo local no mapa: ${content.locations[e.location]?.name}`);
      break;
    case "revealLink": {
      const k = linkKey(e.from, e.to);
      if (!world.revealedLinks.includes(k)) {
        world.revealedLinks.push(k);
        revealLocation(world, e.from);
        revealLocation(world, e.to);
        ctx.lines.push(`🗺️ Novo caminho: ${content.locations[e.from]?.name} ↔ ${content.locations[e.to]?.name}`);
      }
      break;
    }
    case "time": {
      const rep = passTime(char, world, content, ctx.minute, e.minutes, "light");
      ctx.minute += e.minutes;
      ctx.extraMinutes += e.minutes;
      ctx.lines.push(...rep.notes);
      break;
    }
    case "disease": {
      if (char.health.diseases.some((d) => d.key === e.key)) break;
      let catches = true;
      if (e.chanceAttr) catches = !rollCheck(char, { attr: e.chanceAttr, base: e.base ?? 50 }, ctx.rng, ctx.minute).success;
      if (catches) {
        char.health.diseases.push({ key: e.key, startedAt: ctx.minute, until: ctx.minute + 24 * 60 });
        ctx.lines.push(e.key === "gastroenterite" ? "Horas depois, cólicas fortes: a água não estava boa." : "Você está com febre.");
        ctx.applied.push(`doença: ${e.key}`);
      }
      break;
    }
    case "bite": {
      const b = applyBite(char, ctx.minute, ctx.genId);
      ctx.lines.push(...b.lines);
      ctx.applied.push(`mordida ${b.level}/3`);
      break;
    }
    case "painkiller":
      char.health.painkillerUntil = ctx.minute + e.minutes;
      break;
    case "fire": {
      const loc = world.locations[s.locationId];
      if (loc) loc.fireUntilMinute = Math.max(loc.fireUntilMinute, ctx.minute) + e.minutes;
      break;
    }
    case "kill":
      kill(char, e.cause, ctx.minute);
      ctx.applied.push(`morte: ${e.cause}`);
      break;
    case "end": {
      const ending = content.endings[e.ending];
      if (ending && !world.ending) world.ending = { key: ending.key, type: ending.type };
      break;
    }
  }
}

export function countOf(char: CharacterState, itemId: string): number {
  return countItem(char, itemId);
}
