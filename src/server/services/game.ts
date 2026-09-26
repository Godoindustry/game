/**
 * Serviço de jogo: ações, rodadas, pausa, autosave e visão do estado para o cliente.
 *
 * Fluxo de uma ação:
 *  1. POST ação → validada no servidor → gravada como "pending" com completes_at (espera real).
 *  2. Quando todos os vivos enviaram (ou o prazo da rodada venceu) e as esperas acabaram,
 *     qualquer sync resolve a rodada: motor determinístico → IA só para texto → transação única.
 *  3. Nada é consumido enquanto ninguém age: tempo de jogo só passa quando rodadas são resolvidas.
 */
import { z } from "zod";
import { getDb, json, nowIso } from "../db/database";
import { getConfig } from "../config";
import { newId } from "./ids";
import { badRequest, conflict, notFound } from "./errors";
import type { SessionUser } from "./auth";
import { getCampaignRow, requireMember, type CampaignRow } from "./campaigns";
import { addLog, loadActiveEvent, loadCampaignCharacters, loadWorld, saveCharacter, saveWorld } from "./stateRepo";
import { unlockAchievement } from "./achievements";
import { getScenario } from "../content/valeSilente";
import { ACTION_TYPES, type ActionInput, type ActionReport, type CharacterState, type GameContent, type WorldState } from "../engine/types";
import { validateAction, neighbors, travelMinutes } from "../engine/actions";
import { resolveRound, type RoundAction } from "../engine/round";
import { eventById } from "../engine/events";
import { meetsRequirements } from "../engine/effects";
import { computeScore } from "../engine/setup";
import { inventorySummary, itemDef, loadRatio } from "../engine/inventory";
import { clockLabel, dayNumber, fireActive, isNight, isSheltered, locationTemp } from "../engine/physiology";
import { aiClassifyIntent, aiNarrative, aiNpcReply } from "../ai/service";
import { bodyCondition, conditionLine, conditionWords } from "../engine/condition";
import { currentObjective, urgentNeed } from "../engine/objective";
import { stripVoiceTags, toVoiceText } from "@/shared/voiceTags";
import { nightEncounter } from "../engine/vampire";
import { rngFor } from "../engine/rng";

/** Ações que recebem uma linha de ambientação (IA ou texto de reserva sobre o corpo). */
const NARRATED: ActionInput["type"][] = ["mover", "examinar", "procurar", "escolha_evento", "dormir", "descansar", "coletar_lenha", "montar_abrigo"];

const submitSchema = z.strictObject({
  type: z.enum(ACTION_TYPES),
  params: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

interface ActionRow {
  id: string;
  campaign_id: string;
  character_id: string;
  round: number;
  type: string;
  params: string;
  idempotency_key: string;
  duration_minutes: number;
  status: string;
  auto: number;
  submitted_at: string;
  completes_at: string;
}

async function myCharacterId(campaignId: string, userId: string): Promise<string> {
  const row = await getDb().get<{ id: string }>("SELECT id FROM characters WHERE campaign_id = ? AND user_id = ?", campaignId, userId);
  if (!row) throw notFound("Você não tem personagem nesta campanha.");
  return row.id;
}

function realWaitMs(minutes: number): number {
  const c = getConfig();
  return Math.round(Math.min(minutes * c.ACTION_REAL_SECONDS_PER_GAME_MINUTE, c.ACTION_MAX_REAL_SECONDS) * 1000);
}

const isUniqueViolation = (err: unknown) =>
  err instanceof Error && (/UNIQUE/i.test(err.message) || (err as { code?: string }).code === "23505");

// ---------- Enviar / cancelar ----------
export async function submitAction(user: SessionUser, campaignId: string, input: unknown) {
  const data = submitSchema.parse(input);
  if (JSON.stringify(data.params).length > 1000) throw badRequest("Parâmetros grandes demais.");
  const camp = await requireMember(user, campaignId);
  if (camp.status !== "active") throw conflict("A campanha não está em andamento.", "campanha_inativa");
  const charId = await myCharacterId(campaignId, user.id);
  const db = getDb();

  // Idempotência: repetir a mesma requisição devolve a mesma ação.
  const dup = await db.get<ActionRow>("SELECT * FROM player_actions WHERE character_id = ? AND idempotency_key = ?", charId, data.idempotencyKey);
  if (dup) return { actionId: dup.id, duplicate: true };

  const pending = await db.get<ActionRow>(
    "SELECT * FROM player_actions WHERE character_id = ? AND round = ? AND status <> 'cancelled'",
    charId, camp.current_round,
  );
  if (pending) throw conflict("Você já tem uma ação nesta rodada. Aguarde a resolução.", "acao_pendente");

  const content = getScenario(camp.scenario_id);
  const world = await loadWorld(campaignId);
  const chars = await loadCampaignCharacters(campaignId);
  const char = chars.find((c) => c.id === charId)!;
  const activeEvent = await loadActiveEvent(campaignId);
  const v = validateAction({ char, world, content, activeEvent }, { type: data.type, params: data.params });
  if (!v.ok) throw badRequest(v.error, "acao_invalida");

  const now = new Date();
  const id = newId();
  try {
    await db.tx(async () => {
      await db.lock(`campaign:${campaignId}`);
      // A rodada pode ter avançado entre a leitura e a gravação.
      const fresh = await getCampaignRow(campaignId);
      if (fresh.current_round !== camp.current_round || fresh.status !== "active") throw conflict("A rodada mudou. Tente de novo.", "rodada_mudou");
      await db.run(
        `INSERT INTO player_actions(id,campaign_id,character_id,round,type,params,idempotency_key,duration_minutes,status,auto,submitted_at,completes_at)
         VALUES(?,?,?,?,?,?,?,?,'pending',0,?,?)`,
        id, campaignId, charId, camp.current_round, data.type, JSON.stringify(data.params), data.idempotencyKey, v.minutes,
        now.toISOString(), new Date(now.getTime() + realWaitMs(v.minutes)).toISOString(),
      );
      if (camp.mode === "coop" && !fresh.round_deadline_at) {
        await db.run(
          "UPDATE campaigns SET round_deadline_at = ? WHERE id = ?",
          new Date(now.getTime() + getConfig().ROUND_TIMEOUT_SECONDS * 1000).toISOString(), campaignId,
        );
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ação duplicada.", "acao_duplicada");
    throw err;
  }
  await tryResolveRound(campaignId);
  return { actionId: id, duplicate: false, minutes: v.minutes };
}

export async function cancelAction(user: SessionUser, campaignId: string): Promise<void> {
  const camp = await requireMember(user, campaignId);
  const charId = await myCharacterId(campaignId, user.id);
  const db = getDb();
  const a = await db.get<ActionRow>("SELECT * FROM player_actions WHERE character_id = ? AND round = ? AND status = 'pending'", charId, camp.current_round);
  if (!a) throw notFound("Nenhuma ação pendente.");
  if (a.completes_at <= nowIso()) throw conflict("A ação já terminou e está sendo resolvida.");
  await db.run("UPDATE player_actions SET status = 'cancelled' WHERE id = ? AND status = 'pending'", a.id);
}

// ---------- Criaturas da noite ----------
const encounterSchema = z.strictObject({ kind: z.enum(["morcego", "alma"]) });

/**
 * O mundo andável avisa que uma criatura alcançou o jogador no escuro.
 * A regra (engine/vampire.ts) decide se houve ataque: só à noite, longe do fogo,
 * no máximo a cada 30 min de jogo. Não gasta a vez da rodada.
 */
export async function encounter(user: SessionUser, campaignId: string, input: unknown) {
  const { kind } = encounterSchema.parse(input);
  const camp = await requireMember(user, campaignId);
  if (camp.status !== "active") throw conflict("A campanha não está em andamento.", "campanha_inativa");
  const charId = await myCharacterId(campaignId, user.id);
  const db = getDb();
  const content = getScenario(camp.scenario_id);
  let result: ReturnType<typeof nightEncounter> | null = null;
  await db.tx(async () => {
    await db.lock(`campaign:${campaignId}`);
    const world = await loadWorld(campaignId);
    const chars = await loadCampaignCharacters(campaignId);
    const char = chars.find((c) => c.id === charId);
    if (!char) throw notFound("Personagem não encontrado.");
    result = nightEncounter(char, world, content, kind, rngFor(world.seed, world.minute, charId, "noite"), newId);
    if (!result.happened) return;
    await saveCharacter(char);
    await saveWorld(world);
    for (const line of result.lines) await addLog(campaignId, charId, world.minute, "narrative", line);
    if (result.died) await addLog(campaignId, charId, world.minute, "death", `${char.name} não é mais humano.`);
  });
  const r = result as ReturnType<typeof nightEncounter> | null;
  return { happened: !!r?.happened, reason: r?.reason ?? null, bitten: !!r?.bitten, level: r?.level ?? 0 };
}

// ---------- Sincronização / pausa ----------
export async function sync(user: SessionUser, campaignId: string) {
  const camp = await requireMember(user, campaignId);
  const now = new Date();
  await getDb().run("UPDATE campaign_members SET last_seen_at = ? WHERE campaign_id = ? AND user_id = ?", now.toISOString(), campaignId, user.id);
  if (camp.status === "active") {
    await applyPause(camp, now);
    await tryResolveRound(campaignId, now);
  }
  return getState(user, campaignId);
}

/**
 * Se ninguém sincronizou por PAUSE_AFTER_SECONDS, a campanha estava pausada:
 * o prazo da rodada é empurrado pelo tempo de pausa (ninguém perde a vez offline).
 */
export async function applyPause(camp: CampaignRow, now: Date): Promise<void> {
  const db = getDb();
  const last = camp.last_heartbeat_at ? new Date(camp.last_heartbeat_at) : now;
  const gapMs = now.getTime() - last.getTime();
  if (camp.round_deadline_at && gapMs > getConfig().PAUSE_AFTER_SECONDS * 1000) {
    const newDeadline = new Date(new Date(camp.round_deadline_at).getTime() + gapMs).toISOString();
    await db.run("UPDATE campaigns SET round_deadline_at = ? WHERE id = ?", newDeadline, camp.id);
  }
  await db.run("UPDATE campaigns SET last_heartbeat_at = ? WHERE id = ?", now.toISOString(), camp.id);
}

export function isPaused(camp: CampaignRow, now = new Date()): boolean {
  if (!camp.last_heartbeat_at) return true;
  return now.getTime() - new Date(camp.last_heartbeat_at).getTime() > getConfig().PAUSE_AFTER_SECONDS * 1000;
}

// ---------- Resolução ----------
export async function tryResolveRound(campaignId: string, now = new Date()): Promise<boolean> {
  const db = getDb();
  const camp = await getCampaignRow(campaignId);
  if (camp.status !== "active") return false;
  const content = getScenario(camp.scenario_id);
  const chars = await loadCampaignCharacters(campaignId);
  const alive = chars.filter((c) => c.alive);
  const pending = await db.all<ActionRow>("SELECT * FROM player_actions WHERE campaign_id = ? AND round = ? AND status = 'pending'", campaignId, camp.current_round);
  if (!alive.length) return false;
  // Sem espera pelos amigos: quem agiu resolve na hora. Quem não agiu só vê o tempo passar
  // (fica parado no mesmo lugar). Num evento em grupo, decide quem responder primeiro.
  if (!pending.length) return false;
  if (pending.some((a) => a.completes_at > now.toISOString())) return false;

  const world = await loadWorld(campaignId);
  const activeEvent = await loadActiveEvent(campaignId);
  const byId = new Map(chars.map((c) => [c.id, c]));
  const reports: Record<string, ActionReport> = {};
  const actions: RoundAction[] = [];
  const autoRows: { id: string; charId: string; type: string; params: Record<string, unknown>; minutes: number }[] = [];

  for (const a of pending) {
    const char = byId.get(a.character_id);
    if (!char?.alive) continue;
    const input: ActionInput = { type: a.type as ActionInput["type"], params: json(a.params, {}) };
    // Revalida: outra ação da mesma rodada pode ter mudado o mundo (ex.: item já pego).
    const v = validateAction({ char, world, content, activeEvent }, input);
    if (!v.ok) {
      reports[a.id] = { characterId: char.id, actionType: input.type, success: false, summary: `Não foi possível: ${v.error}`, lines: [v.error], effects: [], minutes: 0, tags: [] };
      continue;
    }
    actions.push({ ...input, id: a.id, characterId: char.id, minutes: v.minutes, activity: v.activity, isOwner: char.userId === camp.owner_user_id });
  }

  // IA (fora da transação): classifica intenções de conversa com NPC.
  const npcIntents: Record<string, string> = {};
  for (const a of actions.filter((x) => x.type === "conversar")) {
    const char = byId.get(a.characterId)!;
    const npc = Object.values(content.npcs).find((n) => n.locationId === char.status.locationId);
    if (!npc) continue;
    const r = await aiClassifyIntent({ userId: char.userId, campaignId }, { npcName: npc.name, message: String(a.params.message ?? ""), allowedIntents: npc.intents });
    npcIntents[a.id] = r.intent;
  }

  const result = resolveRound({ world, chars, content, actions, activeEvent, genId: newId, npcIntents });
  Object.assign(reports, result.reports);

  // IA (fora da transação): texto de ambientação e fala do NPC. Fatos vêm do motor.
  const narratives: Record<string, string> = {};
  await Promise.all(
    Object.entries(reports).map(async ([actionId, rep]) => {
      const char = byId.get(rep.characterId)!;
      const loc = content.locations[char.status.locationId];
      const ctx = { userId: char.userId, campaignId };
      if (rep.actionType === "conversar") {
        const npc = Object.values(content.npcs).find((n) => n.locationId === char.status.locationId);
        const action = actions.find((a) => a.id === actionId);
        if (npc && action) {
          const r = await aiNpcReply(
            ctx,
            { npcName: npc.name, persona: npc.persona, playerMessage: String(action.params.message ?? ""), intent: npcIntents[actionId] ?? "outro", outcomeFacts: rep.lines.slice(1) },
            `${npc.name} responde em voz baixa, sem tirar os olhos da porta.`,
          );
          narratives[actionId] = r.text;
        }
      } else if (rep.minutes > 0 && NARRATED.includes(rep.actionType)) {
        const cond = char.alive ? bodyCondition(char) : [];
        const r = await aiNarrative(
          ctx,
          {
            locationName: loc?.name ?? "",
            timeLabel: clockLabel(content, world.minute),
            isNight: isNight(content, world.minute),
            temperatureC: Math.round(locationTemp(world, content, char.status.locationId, world.minute)),
            actionSummary: rep.summary,
            facts: rep.lines,
            characterAlive: char.alive,
            ...(cond.length ? { condition: conditionWords(cond) } : {}),
          },
          conditionLine(cond, world.minute),
        );
        narratives[actionId] = r.text;
      }
    }),
  );

  // Transação única: autosave de tudo ou nada. Trava + versão otimista impedem resolver duas vezes.
  return db.tx(async () => {
    await db.lock(`campaign:${campaignId}`);
    const fresh = await getCampaignRow(campaignId);
    if (fresh.version !== camp.version || fresh.current_round !== camp.current_round || fresh.status !== "active") return false;
    // Uma ação cancelada/enviada no meio do caminho invalida esta resolução.
    const stillPending = await db.all<{ id: string }>("SELECT id FROM player_actions WHERE campaign_id = ? AND round = ? AND status = 'pending'", campaignId, camp.current_round);
    if (stillPending.length !== pending.length || stillPending.some((p) => !pending.some((q) => q.id === p.id))) return false;

    const nowStr = nowIso();
    for (const r of autoRows) {
      await db.run(
        `INSERT INTO player_actions(id,campaign_id,character_id,round,type,params,idempotency_key,duration_minutes,status,auto,submitted_at,completes_at)
         VALUES(?,?,?,?,?,?,?,?,'pending',1,?,?)`,
        r.id, campaignId, r.charId, camp.current_round, r.type, JSON.stringify(r.params), `auto-${r.id}`, r.minutes, nowStr, nowStr,
      );
    }
    const clueFinder: Record<string, string | null> = {};
    for (const [actionId, rep] of Object.entries(reports)) {
      const char = byId.get(rep.characterId)!;
      await db.run("UPDATE player_actions SET status = 'resolved' WHERE id = ?", actionId);
      await db.run(
        `INSERT INTO action_resolutions(id,action_id,campaign_id,character_id,success,summary,narrative,effects,status_before,status_after,resolved_at_minute,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId(), actionId, campaignId, char.id, rep.success === null ? null : +rep.success, rep.summary, narratives[actionId] ?? "",
        JSON.stringify(rep.effects), "{}", JSON.stringify({ status: char.status, health: char.health }), world.minute, nowStr,
      );
      for (const e of rep.effects) if (e.startsWith("pista: ")) clueFinder[e.slice(7)] = char.id;
      const auto = autoRows.some((r) => r.id === actionId);
      await addLog(campaignId, char.id, world.minute, "result", `${auto ? "⏱ Tempo esgotado — ação automática. " : ""}${rep.lines.join("\n")}`);
      if (narratives[actionId]) await addLog(campaignId, char.id, world.minute, rep.actionType === "conversar" ? "npc" : "narrative", narratives[actionId]);
      if (chars.length > 1) await addLog(campaignId, null, world.minute, "party", `${char.name}: ${rep.summary}`);
    }
    for (const c of chars) await saveCharacter(c);
    await saveWorld(world, clueFinder);
    if (result.resolvedEvent) {
      await db.run(
        "UPDATE campaign_events SET status='resolved', chosen_choice_id=?, resolved_at_minute=? WHERE id=?",
        result.resolvedEvent.choiceId, world.minute, result.resolvedEvent.instanceId,
      );
    } else if (activeEvent && !chars.some((c) => c.alive && activeEvent.participants.includes(c.id))) {
      await db.run("UPDATE campaign_events SET status='resolved', resolved_at_minute=? WHERE id=?", world.minute, activeEvent.instanceId);
    }
    for (const d of result.deaths) {
      const c = byId.get(d.characterId)!;
      await addLog(campaignId, null, world.minute, "death", `💀 ${c.name} morreu. Causa: ${d.cause}.`);
    }
    if (result.newEvent) {
      await db.run(
        "INSERT INTO campaign_events(id,campaign_id,event_id,status,participants,round_triggered,triggered_at_minute,created_at) VALUES(?,?,?,'active',?,?,?,?)",
        newId(), campaignId, result.newEvent.event.id, JSON.stringify(result.newEvent.participants), world.round, world.minute, nowIso(),
      );
      for (const p of result.newEvent.participants) {
        await addLog(campaignId, p, world.minute, "event", `【${result.newEvent.event.title}】 ${result.newEvent.event.body}`);
      }
    }
    await db.run("UPDATE campaigns SET round_deadline_at = NULL WHERE id = ?", campaignId);
    await grantRoundAchievements(chars, world, reports, campaignId);
    if (result.ended) await finalizeCampaign(campaignId, world, chars, content);
    return true;
  });
}

async function grantRoundAchievements(chars: CharacterState[], world: WorldState, reports: Record<string, ActionReport>, campaignId: string) {
  for (const rep of Object.values(reports)) {
    const char = chars.find((c) => c.id === rep.characterId)!;
    if (rep.tags.includes("fire")) await unlockAchievement(char.userId, "fogo", campaignId);
    if (rep.tags.includes("treated")) await unlockAchievement(char.userId, "medico_de_campo", campaignId);
    if (rep.tags.includes("shelter")) await unlockAchievement(char.userId, "abrigo", campaignId);
    if (rep.tags.some((t) => t.startsWith("npc:piloto:")) && !world.flags.piloto_fugiu) await unlockAchievement(char.userId, "confianca", campaignId);
  }
  for (const c of chars) {
    if (c.alive && world.minute >= 380) await unlockAchievement(c.userId, "primeira_noite", campaignId);
    if (world.clues.length >= 5) await unlockAchievement(c.userId, "investigador", campaignId);
    if (world.clues.length >= 10) await unlockAchievement(c.userId, "verdade", campaignId);
    if (!c.alive && c.deathCause && /ravina/i.test(c.deathCause)) await unlockAchievement(c.userId, "queda", campaignId);
  }
}

/** Fim de campanha: status, ranking e conquistas finais (dentro da transação da rodada). */
export async function finalizeCampaign(campaignId: string, world: WorldState, chars: CharacterState[], content: GameContent): Promise<void> {
  const db = getDb();
  const camp = await getCampaignRow(campaignId);
  const ending = world.ending!;
  const now = nowIso();
  await db.run("UPDATE campaigns SET status='finished', ending=?, ending_type=?, ended_at=?, updated_at=? WHERE id=?", ending.key, ending.type, now, now, campaignId);
  await db.run("UPDATE player_actions SET status='cancelled' WHERE campaign_id=? AND status='pending'", campaignId);
  for (const c of chars) {
    await db.run(
      `INSERT INTO ranking_scores(id,user_id,campaign_id,character_id,character_name,score,survived_minutes,clues_found,ending,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,character_id) DO NOTHING`,
      newId(), c.userId, campaignId, c.id, c.name, computeScore(c, world), c.alive ? world.minute : (c.diedAtMinute ?? world.minute),
      world.clues.length, ending.key, now,
    );
    if (ending.type === "victory" && c.alive) {
      await unlockAchievement(c.userId, "resgatado", campaignId);
      if (camp.mode === "coop") await unlockAchievement(c.userId, "equipe", campaignId);
      if (ending.key === "a_verdade") await unlockAchievement(c.userId, "justica", campaignId);
    }
  }
  const def = content.endings[ending.key];
  await addLog(campaignId, null, world.minute, "ending", `${ending.type === "victory" ? "🚁" : "🌫️"} ${def?.title ?? ending.key}. ${def?.text ?? ""}`);
}

// ---------- Visão do estado ----------
const CANDIDATES: { type: ActionInput["type"]; label: string; params?: Record<string, unknown> }[] = [
  { type: "examinar", label: "Examinar a área" },
  { type: "procurar", label: "Procurar recursos" },
  { type: "coletar_lenha", label: "Coletar lenha" },
  { type: "acender_fogueira", label: "Acender fogueira" },
  { type: "montar_abrigo", label: "Montar abrigo" },
  { type: "descansar", label: "Descansar" },
  { type: "dormir", label: "Dormir 2h", params: { hours: 2 } },
  { type: "dormir", label: "Dormir 4h", params: { hours: 4 } },
  { type: "dormir", label: "Dormir 8h", params: { hours: 8 } },
  { type: "tomar_analgesico", label: "Tomar analgésico" },
  { type: "esperar", label: "Esperar 15 min" },
];

export async function getState(user: SessionUser, campaignId: string) {
  const camp = await requireMember(user, campaignId, { allowMaster: true });
  const db = getDb();
  const content = getScenario(camp.scenario_id);
  const world = await loadWorld(campaignId);
  const chars = await loadCampaignCharacters(campaignId);
  const me = chars.find((c) => c.userId === user.id) ?? null;
  const activeEvent = camp.status === "active" ? await loadActiveEvent(campaignId) : null;
  const actions = await db.all<ActionRow>("SELECT * FROM player_actions WHERE campaign_id = ? AND round = ? AND status = 'pending'", campaignId, camp.current_round);
  const profileRows = await db.all<{ user_id: string; display_name: string; last_seen_at: string | null }>(
    "SELECT m.user_id, p.display_name, m.last_seen_at FROM campaign_members m JOIN profiles p ON p.user_id = m.user_id WHERE m.campaign_id = ?",
    campaignId,
  );
  const profiles = new Map(profileRows.map((r) => [r.user_id, r]));
  const logRows = await db.all<{ id: number; character_id: string | null; game_minute: number; kind: string; text: string }>(
    `SELECT id, character_id, game_minute, kind, text FROM campaign_log
      WHERE campaign_id = ? AND (character_id IS NULL OR character_id = ?) ORDER BY id DESC LIMIT 60`,
    campaignId, me?.id ?? "",
  );
  const myPending = me ? actions.find((a) => a.character_id === me.id) : undefined;
  const loc = me ? me.status.locationId : content.startLocation;
  const canAct = !!me && me.alive && camp.status === "active" && !myPending;
  const vctx = me ? { char: me, world, content, activeEvent } : null;
  const check = (input: ActionInput) => {
    if (!vctx || !canAct) return { available: false, reason: myPending ? "Aguarde a ação atual." : "Indisponível.", minutes: 0 };
    const v = validateAction(vctx, input);
    return v.ok ? { available: true, reason: null, minutes: v.minutes } : { available: false, reason: v.error, minutes: 0 };
  };
  const inEvent = !!(me && activeEvent?.participants.includes(me.id));

  const ev = activeEvent ? eventById(content, activeEvent.eventId) : undefined;
  const myVote = activeEvent && me ? actions.find((a) => a.character_id === me.id && a.type === "escolha_evento") : undefined;

  return {
    campaign: {
      id: camp.id,
      name: camp.name,
      mode: camp.mode,
      status: camp.status,
      isOwner: camp.owner_user_id === user.id,
      round: camp.current_round,
      minute: world.minute,
      clock: clockLabel(content, world.minute),
      day: dayNumber(content, world.minute),
      night: isNight(content, world.minute),
      temperature: Math.round(locationTemp(world, content, loc, world.minute)),
      weather: world.flags.chovendo ? ("chuva" as const) : ("seco" as const),
      roundDeadlineAt: camp.round_deadline_at,
      paused: camp.status === "active" && isPaused(camp),
      savedAt: camp.updated_at,
      version: camp.version,
      serverTime: nowIso(),
    },
    me: me ? characterView(me, content, world, inEvent, check) : null,
    party: chars.map((c) => ({
      characterId: c.id,
      name: c.name,
      player: profiles.get(c.userId)?.display_name ?? "?",
      isMe: c.userId === user.id,
      alive: c.alive,
      deathCause: c.deathCause,
      locationId: c.status.locationId,
      health: Math.round(c.health.health),
      acted: actions.some((a) => a.character_id === c.id),
      online: !!profiles.get(c.userId)?.last_seen_at && Date.now() - new Date(profiles.get(c.userId)!.last_seen_at!).getTime() < 30_000,
    })),
    map: {
      image: "/assets/mapa-vale-silente.png",
      locations: Object.values(content.locations)
        .filter((l) => world.locations[l.id]?.discovered)
        .map((l) => ({
          id: l.id,
          name: l.name,
          description: world.locations[l.id].visited ? l.description : "Ainda não explorado.",
          x: l.x,
          y: l.y,
          terrain: l.terrain,
          visited: world.locations[l.id].visited,
          fire: fireActive(world, l.id),
          shelter: world.locations[l.id].shelterBuilt || !!l.properties.naturalShelter || !!l.properties.indoor,
          danger: l.dangerLevel,
        })),
      links: content.links
        .filter((k) => world.locations[k.from]?.discovered && world.locations[k.to]?.discovered)
        .filter((k) => !k.hidden || world.revealedLinks.includes([k.from, k.to].sort().join("|")))
        .map((k) => ({ from: k.from, to: k.to, minutes: k.minutes })),
      travel: me
        ? neighbors(world, content, me.status.locationId).map((n) => ({
            to: n.to,
            name: content.locations[n.to].name,
            estimatedMinutes: travelMinutes(me, world, content, n),
            ...check({ type: "mover", params: { to: n.to } }),
          }))
        : [],
    },
    here: {
      locationId: loc,
      name: content.locations[loc].name,
      description: content.locations[loc].description,
      water: content.locations[loc].properties.water ?? null,
      fire: fireActive(world, loc),
      sheltered: isSheltered(world, content, loc),
      indoor: !!content.locations[loc].properties.indoor,
      ground: world.ground
        .filter((g) => g.locationId === loc)
        .map((g) => ({
          id: g.id,
          itemId: g.itemId,
          name: content.items[g.itemId].name,
          quantity: g.quantity,
          weightG: content.items[g.itemId].weightG,
          volumeMl: content.items[g.itemId].volumeMl,
          ...check({ type: "pegar_item", params: { groundItemId: g.id } }),
        })),
      actions: inEvent ? [] : CANDIDATES.map((c) => ({ type: c.type, label: c.label, params: c.params ?? {}, ...check({ type: c.type, params: c.params ?? {} }) })),
      npc: (() => {
        const npc = Object.values(content.npcs).find((n) => n.locationId === loc && world.flags[n.presentFlag] && !world.flags[n.goneFlag]);
        return npc ? { id: npc.id, name: npc.name, trust: Number(world.flags.confianca_piloto ?? 0) } : null;
      })(),
    },
    pending: myPending
      ? {
          actionId: myPending.id,
          type: myPending.type,
          durationMinutes: myPending.duration_minutes,
          submittedAt: myPending.submitted_at,
          completesAt: myPending.completes_at,
          // Destino da caminhada: o mapa anima o marcador pela trilha durante a espera.
          target: myPending.type === "mover" ? String(json<Record<string, unknown>>(myPending.params, {}).to ?? "") || null : null,
          // Ninguém espera ninguém: a ação resolve sozinha (campo mantido por compatibilidade).
          waitingFor: [] as string[],
        }
      : null,
    event:
      ev && activeEvent
        ? {
            instanceId: activeEvent.instanceId,
            title: ev.title,
            locationId: ev.locationId ?? loc,
            // Tela sem tags; `voice` mantém as tags de expressão para o modelo de voz.
            body: stripVoiceTags(ev.body),
            voice: toVoiceText(ev.body),
            participating: inEvent,
            participants: activeEvent.participants.map((id) => chars.find((c) => c.id === id)?.name ?? "?"),
            myChoiceId: myVote ? String(json<Record<string, unknown>>(myVote.params, {}).choiceId) : null,
            choices: ev.choices.map((ch) => {
              const req = me ? meetsRequirements(me, world, content, ch.requirements) : { ok: false as const, reason: "" };
              return { id: ch.id, label: ch.label, durationMinutes: ch.durationMinutes, available: req.ok && canAct && inEvent, reason: req.ok ? null : req.reason };
            }),
          }
        : null,
    objective: me && me.alive && camp.status === "active" ? currentObjective(me, world, content) : null,
    urgent: me && camp.status === "active" ? urgentNeed(me) : null,
    clues: world.clues.map((k) => content.clues[k]).filter(Boolean),
    log: logRows
      .reverse()
      .map((l) => ({ id: Number(l.id), kind: l.kind, clock: clockLabel(content, l.game_minute), day: dayNumber(content, l.game_minute), text: stripVoiceTags(l.text), voice: toVoiceText(l.text) })),
    ending:
      camp.status === "finished"
        ? {
            key: camp.ending,
            type: camp.ending_type,
            title: content.endings[camp.ending ?? ""]?.title ?? (camp.ending === "abandonada" ? "Campanha encerrada" : camp.ending),
            text: stripVoiceTags(content.endings[camp.ending ?? ""]?.text ?? ""),
            voice: toVoiceText(content.endings[camp.ending ?? ""]?.text ?? ""),
            score: me ? computeScore(me, world) : 0,
            survivedMinutes: me ? (me.alive ? world.minute : (me.diedAtMinute ?? world.minute)) : 0,
            cluesFound: world.clues.length,
            totalClues: Object.keys(content.clues).length,
          }
        : null,
  };
}

function characterView(
  c: CharacterState,
  content: GameContent,
  world: WorldState,
  inEvent: boolean,
  check: (i: ActionInput) => { available: boolean; reason: string | null; minutes: number },
) {
  const itemActions = (invId: string) => {
    if (inEvent) return [];
    const out: { type: string; label: string; params: Record<string, unknown>; available: boolean; reason: string | null; minutes: number }[] = [];
    const inv = c.inventory.find((i) => i.id === invId)!;
    const def = itemDef(content, inv.itemId);
    const push = (type: ActionInput["type"], label: string, params: Record<string, unknown>) => {
      const r = check({ type, params });
      if (r.available || ["comer", "beber", "equipar", "desequipar"].includes(type)) out.push({ type, label, params, ...r });
    };
    if (def.properties.food) push("comer", "Comer", { inventoryItemId: invId });
    if (def.properties.water) push("beber", inv.contaminated ? "Beber (não tratada!)" : "Beber", { inventoryItemId: invId });
    if (def.properties.fillsTo) push("coletar_agua", "Encher com água daqui", { inventoryItemId: invId });
    if (def.properties.water && inv.contaminated) {
      push("purificar_agua", "Purificar com pastilha", { inventoryItemId: invId });
      push("ferver_agua", "Ferver na fogueira", { inventoryItemId: invId });
    }
    if (def.clothing) {
      if (inv.container === "equipped") push("desequipar", "Tirar", { inventoryItemId: invId });
      else push("equipar", def.clothing.slot === "costas" ? "Usar esta mochila" : "Vestir", { inventoryItemId: invId });
    }
    if (inv.container !== "equipped") {
      for (const target of ["pockets", "backpack_side", "backpack_main", "hands"] as const) {
        if (target !== inv.container) push("mover_item", `Mover para ${CONTAINER_LABEL[target]}`, { inventoryItemId: invId, container: target });
      }
      push("largar_item", "Largar aqui", { inventoryItemId: invId });
    }
    return out;
  };
  return {
    id: c.id,
    name: c.name,
    alive: c.alive,
    deathCause: c.deathCause,
    profile: c.profile,
    attributes: c.attrs,
    status: c.status,
    health: {
      ...c.health,
      diseases: c.health.diseases.map((d) => ({
        key: d.key,
        label: d.key === "gastroenterite" ? "Gastroenterite" : d.key === "mordida" ? `Mordida (${d.level ?? 1}/3) · sede escura` : "Febre",
      })),
      painkillerActive: c.health.painkillerUntil > world.minute,
    },
    wounds: c.wounds
      .filter((w) => !w.healed)
      .map((w) => ({ ...w, treat: check({ type: "tratar_ferimento", params: { woundId: w.id } }) })),
    inventory: c.inventory.map((i) => {
      const def = itemDef(content, i.itemId);
      return {
        ...i,
        name: def.name,
        description: def.description,
        category: def.category,
        weightG: def.weightG,
        volumeMl: def.volumeMl,
        maxDurability: def.maxDurability,
        batteryCapacity: def.batteryCapacity,
        clothing: def.clothing ?? null,
        readable: def.properties.readable ?? null,
        essential: !!def.properties.essential,
        actions: itemActions(i.id),
      };
    }),
    load: { ...inventorySummary(c, content), ratio: Math.round(loadRatio(c, content) * 100) / 100 },
  };
}

const CONTAINER_LABEL = {
  pockets: "bolsos",
  backpack_side: "bolso lateral da mochila",
  backpack_main: "compartimento principal",
  hands: "mãos",
} as const;
