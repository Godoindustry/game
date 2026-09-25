/**
 * Resolução de uma rodada. Solo = rodada de 1 personagem; cooperativo = até 4.
 *
 * 1. Se há evento ativo: apura o voto dos participantes e aplica o resultado
 *    individualmente (testes por personagem).
 * 2. Demais ações são resolvidas em ordem determinística (id do personagem).
 * 3. A rodada dura o tempo da ação mais longa; quem terminou antes "espera" (idle).
 * 4. Relógio da campanha avança; mortes e finais são verificados.
 * 5. Procura o próximo evento narrativo.
 */
import type { ActionInput, ActionReport, ActiveEvent, CharacterState, EventDef, GameContent, WorldState } from "./types";
import { rngFor } from "./rng";
import { passTime, type Activity } from "./physiology";
import { resolveAction } from "./actions";
import { applyChoiceOutcome, choiceById, eventById, findTriggeredEvent, tallyChoice } from "./events";
import type { EffectContext } from "./effects";

export interface RoundAction extends ActionInput {
  id: string;
  characterId: string;
  minutes: number;
  activity: Activity;
  isOwner: boolean;
}

export interface RoundInput {
  world: WorldState;
  chars: CharacterState[];
  content: GameContent;
  actions: RoundAction[];
  activeEvent: ActiveEvent | null;
  genId: () => string;
  npcIntents?: Record<string, string>; // actionId -> intenção já classificada e validada
}

export interface RoundResult {
  reports: Record<string, ActionReport>; // por actionId
  roundMinutes: number;
  resolvedEvent: { instanceId: string; choiceId: string } | null;
  newEvent: { event: EventDef; participants: string[] } | null;
  deaths: { characterId: string; cause: string }[];
  ended: { key: string; type: "victory" | "defeat" } | null;
}

export function resolveRound(input: RoundInput): RoundResult {
  const { world, chars, content, actions, activeEvent, genId } = input;
  const startMinute = world.minute;
  const round = world.round;
  const byChar = new Map(chars.map((c) => [c.id, c]));
  const aliveBefore = new Set(chars.filter((c) => c.alive).map((c) => c.id));
  const reports: Record<string, ActionReport> = {};
  const spent = new Map<string, number>();
  let resolvedEvent: RoundResult["resolvedEvent"] = null;

  const makeCtx = (charId: string, salt: string): EffectContext => ({
    world,
    content,
    rng: rngFor(world.seed, round, charId, salt),
    genId,
    minute: startMinute,
    lines: [],
    applied: [],
    extraMinutes: 0,
  });

  // 1. Evento ativo
  if (activeEvent) {
    const ev = eventById(content, activeEvent.eventId);
    const votes = actions
      .filter((a) => a.type === "escolha_evento" && activeEvent.participants.includes(a.characterId))
      .map((a) => ({ characterId: a.characterId, choiceId: String(a.params.choiceId), isOwner: a.isOwner, action: a }));
    if (ev && votes.length) {
      const choice = tallyChoice(ev, votes);
      resolvedEvent = { instanceId: activeEvent.instanceId, choiceId: choice.id };
      for (const v of [...votes].sort((a, b) => a.characterId.localeCompare(b.characterId))) {
        const char = byChar.get(v.characterId);
        if (!char) continue;
        const ctx = makeCtx(char.id, `event:${ev.id}`);
        if (votes.length > 1 && v.choiceId !== choice.id) {
          ctx.lines.push(`O grupo decidiu: “${choice.label}”.`);
        }
        const res = applyChoiceOutcome(char, choice, ctx);
        const rep = passTime(char, world, content, ctx.minute, choice.durationMinutes, "light");
        ctx.lines.push(...rep.notes);
        const total = choice.durationMinutes + ctx.extraMinutes;
        spent.set(char.id, total);
        reports[v.action.id] = {
          characterId: char.id,
          actionType: "escolha_evento",
          success: res.success,
          summary: `${ev.title}: ${choice.label}`,
          lines: ctx.lines,
          effects: ctx.applied,
          minutes: total,
          tags: [`event:${ev.id}:${choice.id}`],
        };
      }
    }
  }

  // 2. Demais ações
  for (const a of [...actions].sort((x, y) => x.characterId.localeCompare(y.characterId))) {
    if (a.type === "escolha_evento") continue;
    const char = byChar.get(a.characterId);
    if (!char || !char.alive) continue;
    const ctx = { ...makeCtx(char.id, `action:${a.type}`), npcIntent: input.npcIntents?.[a.id] };
    const rep = resolveAction(char, a, a.minutes, a.activity, ctx);
    rep.minutes = a.minutes + ctx.extraMinutes;
    spent.set(char.id, rep.minutes);
    reports[a.id] = rep;
  }

  // 3. Duração da rodada e espera de quem terminou antes
  const roundMinutes = Math.max(0, ...spent.values());
  for (const c of chars) {
    if (!c.alive) continue;
    const idle = roundMinutes - (spent.get(c.id) ?? 0);
    if (idle > 0) passTime(c, world, content, startMinute + (spent.get(c.id) ?? 0), idle, "idle");
  }

  // 4. Relógio, mortes e finais
  world.minute = startMinute + roundMinutes;
  world.round = round + 1;
  const deaths = chars
    .filter((c) => aliveBefore.has(c.id) && !c.alive)
    .map((c) => ({ characterId: c.id, cause: c.deathCause ?? "Desconhecida" }));

  let ended = world.ending;
  if (!ended && chars.every((c) => !c.alive)) {
    world.ending = { key: "morte", type: "defeat" };
    ended = world.ending;
  }

  // 5. Próximo evento
  let newEvent: RoundResult["newEvent"] = null;
  if (!ended) {
    newEvent = findTriggeredEvent(world, chars, content, (id) => rngFor(world.seed, world.round, id, "trigger"));
    if (newEvent) world.eventHistory[newEvent.event.id] = world.minute;
  }

  return { reports, roundMinutes, resolvedEvent, newEvent, deaths, ended };
}

/** Ação automática/segura para quem não respondeu no prazo (multiplayer). */
export function defaultActionFor(
  char: CharacterState,
  activeEvent: ActiveEvent | null,
  content: GameContent,
): ActionInput & { minutes: number; activity: Activity } {
  if (activeEvent?.participants.includes(char.id)) {
    const ev = eventById(content, activeEvent.eventId)!;
    const safe = ev.choices.find((c) => c.safe) ?? ev.choices[ev.choices.length - 1];
    return { type: "escolha_evento", params: { choiceId: safe.id }, minutes: safe.durationMinutes, activity: "light" };
  }
  return { type: "descansar", params: {}, minutes: 30, activity: "rest" };
}

export { choiceById };
