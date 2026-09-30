/**
 * Disparo e resolução de eventos narrativos.
 * Em grupo: a escolha vencedora é a mais votada (empate → voto do dono da campanha,
 * depois ordem da escolha). Os TESTES são individuais: a mesma decisão coletiva
 * pode ferir um personagem e poupar outro.
 */
import type { CharacterState, ChoiceDef, EventDef, GameContent, WorldState } from "./types";
import { diceRng, type Rng } from "./rng";
import { hasItem } from "./inventory";
import { isNight, isSheltered } from "./physiology";
import { applyEffects, applyRollLog, meetsRequirements, rollCheck, type EffectContext } from "./effects";
import { lineageOf } from "./lineage";

function eventEligibleFor(
  ev: EventDef,
  char: CharacterState,
  world: WorldState,
  content: GameContent,
  rng: Rng,
  alive: CharacterState[] = [char],
): boolean {
  const t = ev.trigger;
  if (t.start) return false;
  const last = world.eventHistory[ev.id];
  if (last !== undefined) {
    if (!ev.repeatable) return false;
    if (world.minute - last < (t.cooldownMinutes ?? 60)) return false;
  }
  if (ev.locationId && char.status.locationId !== ev.locationId) return false;
  if (t.minMinute !== undefined && world.minute < t.minMinute) return false;
  if (t.night && !isNight(content, world.minute)) return false;
  if (t.day && isNight(content, world.minute)) return false;
  for (const f of t.flagsAll ?? []) if (!world.flags[f]) return false;
  if (t.flagsAny && !t.flagsAny.some((f) => world.flags[f])) return false;
  for (const f of t.flagsNone ?? []) if (world.flags[f]) return false;
  if (t.afterEvent && world.eventHistory[t.afterEvent] === undefined) return false;
  if (t.hasItem && !hasItem(char, t.hasItem)) return false;
  if (t.notSheltered && isSheltered(world, content, char.status.locationId)) return false;
  if (t.openSky && !content.locations[char.status.locationId]?.properties.openSky) return false;
  for (const [k, v] of Object.entries(t.statusGte ?? {})) {
    const val = k === "infection" ? char.health.infection : char.status[k as "thirst"];
    if (val < (v as number)) return false;
  }
  for (const [k, v] of Object.entries(t.statusLte ?? {})) {
    const val = k === "health" ? char.health.health : char.status[k as "bodyTemp"];
    if (val > (v as number)) return false;
  }
  if (t.cluesAny && !t.cluesAny.some((c) => world.clues.includes(c))) return false;
  if (t.diseaseAny && !char.health.diseases.some((d) => t.diseaseAny!.includes(d.key))) return false;
  if (t.lineageAny && !t.lineageAny.includes(lineageOf(char))) return false;
  if (t.classNone && (lineageOf(char) === "human" || char.power?.classId)) return false;
  if (t.partyTogether && alive.some((c) => c.status.locationId !== char.status.locationId)) return false;
  if (t.chance !== undefined && rng() >= t.chance) return false;
  return true;
}

/** Procura o próximo evento a disparar (no máximo um ativo por campanha). */
export function findTriggeredEvent(
  world: WorldState,
  chars: CharacterState[],
  content: GameContent,
  rngForChar: (charId: string) => Rng,
): { event: EventDef; participants: string[] } | null {
  const alive = chars.filter((c) => c.alive).sort((a, b) => a.id.localeCompare(b.id));
  const events = [...content.events].sort((a, b) => b.priority - a.priority);
  // Um evento por vez para o grupo: vence o de maior prioridade entre TODOS os personagens.
  // Empate gira a cada rodada. Antes o primeiro id levava tudo e os outros perdiam a noite
  // do Despertar (com 3-4 jogadores, alguém só despertava no dia seguinte).
  const offset = alive.length ? world.round % alive.length : 0;
  const order = [...alive.slice(offset), ...alive.slice(0, offset)];
  let best: { event: EventDef; char: CharacterState } | null = null;
  for (const char of order) {
    const rng = rngForChar(char.id);
    const ev = events.find((e) => eventEligibleFor(e, char, world, content, rng, alive));
    if (ev && (!best || ev.priority > best.event.priority)) best = { event: ev, char };
  }
  if (!best) return null;
  const participants = best.event.locationId
    ? alive.filter((c) => c.status.locationId === best.char.status.locationId).map((c) => c.id)
    : [best.char.id];
  return { event: best.event, participants };
}

export function startEvent(content: GameContent): EventDef | undefined {
  return content.events.find((e) => e.trigger.start);
}

export function eventById(content: GameContent, id: string): EventDef | undefined {
  return content.events.find((e) => e.id === id);
}

export function choiceById(ev: EventDef, choiceId: unknown): ChoiceDef | undefined {
  return ev.choices.find((c) => c.id === choiceId);
}

export function safeChoice(ev: EventDef): ChoiceDef {
  return ev.choices.find((c) => c.safe) ?? ev.choices[ev.choices.length - 1];
}

/** Voto majoritário; empate decidido pelo voto do dono, depois pela ordem das escolhas. */
export function tallyChoice(ev: EventDef, votes: { characterId: string; choiceId: string; isOwner: boolean }[]): ChoiceDef {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v.choiceId, (counts.get(v.choiceId) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  const tied = [...counts.entries()].filter(([, n]) => n === max).map(([id]) => id);
  if (tied.length === 1) return choiceById(ev, tied[0]) ?? safeChoice(ev);
  const ownerVote = votes.find((v) => v.isOwner && tied.includes(v.choiceId));
  if (ownerVote) return choiceById(ev, ownerVote.choiceId)!;
  return ev.choices.find((c) => tied.includes(c.id)) ?? safeChoice(ev);
}

/** Aplica o resultado de uma escolha a UM participante (teste individual). */
export function applyChoiceOutcome(
  char: CharacterState,
  choice: ChoiceDef,
  ctx: EffectContext,
  /** Faces do D20 rolado no aparelho (modo DICE_AUTHORITY=client); ausente = servidor rola. */
  dice?: number[] | null,
): { success: boolean | null } {
  const req = meetsRequirements(char, ctx.world, ctx.content, choice.requirements);
  if (!req.ok) {
    ctx.lines.push("Você acompanha o grupo, mas não tem como participar diretamente disso.");
    return { success: null };
  }
  const o = choice.outcome;
  if (o.text) ctx.lines.push(o.text);
  applyEffects(char, o.effects, ctx);
  if (!o.check) return { success: null };
  const roll = rollCheck(char, o.check, dice ? diceRng(dice, ctx.rng) : ctx.rng, ctx.minute, ctx.content);
  const branch = roll.success ? o.success : o.failure;
  applyRollLog(ctx, o.check.attr, roll);
  if (branch) {
    ctx.lines.push(branch.text);
    applyEffects(char, branch.effects, ctx);
  }
  return { success: roll.success };
}
