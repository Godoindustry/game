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
import { addItem, countItem, hasItem, itemDef, removeItem, loadRatio } from "./inventory";
import { clamp, clothingWaterResistance, initialBleeding, isSheltered, kill, passTime } from "./physiology";
import { applyBite, applyHaunt, applyLycanthropy, cureDisease } from "./vampire";
import { LINEAGES, lineageCheckModifier, lineageOf } from "./lineage";
import { rulesFor } from "./difficulty";
import { NIGHT_END, NIGHT_START } from "./constants";
import { addBuff, awaken, classCheckModifier, powerOf, setClass } from "./powers";

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
export function checkChance(char: CharacterState, check: CheckDef, worldMinute: number, content?: GameContent): number {
  const r = rollCheck(char, check, () => 0, worldMinute, content);
  return r.chance;
}

/** O que o aparelho precisa para resolver o D20 sozinho (mesmas regras de rollCheck). */
export function checkPreview(char: CharacterState, check: CheckDef, worldMinute: number, content?: GameContent) {
  const r = rollCheck(char, check, () => 0, worldMinute, content);
  return {
    chance: r.chance,
    target: r.target,
    modifier: r.modifier,
    disadvantage: r.disadvantage,
    critFailMax: rulesFor(char.rules?.difficulty).critFailMax,
  };
}

export type Crit = "critical_success" | "critical_failure" | null;

export function rollCheck(char: CharacterState, check: CheckDef, rng: Rng, worldMinute: number, content?: GameContent) {
  const attr = char.attrs[check.attr];
  let modifier = attr - 3;
  const advantage = false;
  let disadvantage = false;

  if (check.experience && hasExperience(char, check.experience)) modifier += 3;

  for (const [item, bonus] of Object.entries(check.itemBonus ?? {})) {
    if (hasItem(char, item)) modifier += Math.round(bonus / 5);
  }

  modifier -= Math.floor(char.status.pain / 25);
  modifier -= Math.floor(Math.max(0, char.status.stress - 60) / 10);

  if (char.status.energy < 20) modifier -= 2;
  if (char.status.fatigue > 85) { modifier -= 2; disadvantage = true; }
  if (char.status.bodyTemp >= 38.5) { modifier -= 5; disadvantage = true; }
  else if (char.status.bodyTemp >= 37.5) { modifier -= 2; }

  if (content) {
    // loadRatio is expensive, we only calculate it if content is passed
    // If not passed, we skip load penalty
    const ratio = loadRatio(char, content);
    if (ratio > 0.25) modifier -= 4;
    else if (ratio > 0.10) modifier -= 2;
  }

  const night = char.rules ? isNightAt(char.rules.startMinuteOfDay, worldMinute) : undefined;
  modifier += Math.round(lineageCheckModifier(char, check.attr, night) / 5);
  modifier += Math.round(classCheckModifier(char, check.attr, worldMinute) / 5);

  const difficultyMod = rulesFor(char.rules?.difficulty).dcShift;
  const target = 21 - Math.ceil(check.base / 5) + difficultyMod;

  const roll1 = 20 - Math.floor(rng() * 20);
  const roll2 = 20 - Math.floor(rng() * 20);
  let roll = roll1;
  const rolls = advantage || disadvantage ? [roll1, roll2] : [roll1];

  if (advantage && !disadvantage) roll = Math.max(roll1, roll2);
  else if (disadvantage && !advantage) roll = Math.min(roll1, roll2);

  const finalTotal = roll + modifier;
  const critFailMax = rulesFor(char.rules?.difficulty).critFailMax;
  const crit: Crit = roll === 20 ? "critical_success" : roll <= critFailMax ? "critical_failure" : null;
  const success = crit === "critical_success" || (crit !== "critical_failure" && finalTotal >= target);

  const chance = Math.round(clamp((21 - target + modifier) * 5, 5, 95));

  return { success, chance, roll, target, crit, modifier, rolls, finalTotal, advantage, disadvantage };
}

export function applyRollLog(ctx: EffectContext, attr: string, r: ReturnType<typeof rollCheck>) {
  const c = r.crit === "critical_success" ? 1 : r.crit === "critical_failure" ? -1 : 0;
  ctx.applied.push(`teste ${attr}: ${r.success ? "sucesso" : "falha"} (${r.chance}%) [d20:${r.roll}:${r.target}:${r.modifier}:${r.finalTotal}:${r.advantage?1:0}:${r.disadvantage?1:0}:${c}]`);
}

function isNightAt(startMinuteOfDay: number, worldMinute: number): boolean {
  const m = (startMinuteOfDay + worldMinute) % 1440;
  return m >= NIGHT_START || m < NIGHT_END;
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
  if (req.flagsAny && !req.flagsAny.some((f) => world.flags[f])) {
    return { ok: false, reason: "A história ainda não chegou a este ponto." };
  }
  for (const f of req.flagsNone ?? []) if (world.flags[f]) return { ok: false, reason: "Não é mais possível." };
  if (req.cluesAny && !req.cluesAny.some((c) => world.clues.includes(c))) {
    return { ok: false, reason: "Você não sabe o suficiente para isso." };
  }
  if (req.atShelter && !isSheltered(world, content, char.status.locationId)) {
    return { ok: false, reason: "Você não está sob abrigo." };
  }
  if (req.lineage && !req.lineage.includes(lineageOf(char))) {
    // Aparece trancada de propósito: o jogador descobre que existe um caminho para quem "é outra coisa".
    return { ok: false, reason: `Só um ${req.lineage.map((l) => LINEAGES[l].label).join(" ou ")} poderia fazer isso.` };
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
      if (e.chanceAttr) catches = !rollCheck(char, { attr: e.chanceAttr, base: e.base ?? 50 }, ctx.rng, ctx.minute, content).success;
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
    case "haunt": {
      const h = applyHaunt(char, ctx.minute);
      ctx.lines.push(...h.lines);
      ctx.applied.push(h.turned ? "linhagem: assombrado" : "assombro +1");
      break;
    }
    case "cure":
      if (cureDisease(char, e.key)) ctx.applied.push(`curado: ${e.key}`);
      break;
    case "awaken": {
      const before = lineageOf(char);
      ctx.lines.push(...awaken(char, e.lineage, ctx.minute));
      if (before !== lineageOf(char)) ctx.applied.push(`linhagem: ${e.lineage}`);
      break;
    }
    case "setClass": {
      const r = setClass(char, e.classId);
      if (r.line) ctx.lines.push(r.line);
      if (r.ok) ctx.applied.push(`classe: ${e.classId}`);
      break;
    }
    case "buff":
      addBuff(char, e.attr, e.bonus, ctx.minute + e.minutes);
      ctx.applied.push(`${e.attr} +${e.bonus}% por ${e.minutes} min`);
      break;
    case "ward": {
      const p = powerOf(char);
      p.wardUntil = Math.max(p.wardUntil, ctx.minute + e.minutes);
      ctx.applied.push(`proteção ${e.minutes} min`);
      break;
    }
    case "healWounds": {
      let n = 0;
      for (const w of char.wounds) {
        if (!w.healed && w.bleedingRate > 0) {
          w.bleedingRate = 0;
          n++;
        }
      }
      if (n) ctx.applied.push(`sangramento estancado (${n})`);
      break;
    }
    case "resource": {
      const p = powerOf(char);
      p.resource = clamp(p.resource + e.delta, 0, 5);
      break;
    }
    case "painkiller":
      char.health.painkillerUntil = ctx.minute + e.minutes;
      break;
    case "lycanthropy": {
      const l = applyLycanthropy(char, ctx.minute);
      ctx.lines.push(...l.lines);
      ctx.applied.push("linhagem: lobisomem");
      break;
    }
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
