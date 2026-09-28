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
import { defaultActionFor, resolveRound, type RoundAction } from "../engine/round";
import { eventById } from "../engine/events";
import { checkPreview, meetsRequirements } from "../engine/effects";
import { computeScore } from "../engine/setup";
import { inventorySummary, itemDef, loadRatio } from "../engine/inventory";
import { clockLabel, dayNumber, fireActive, isNight, isSheltered, locationTemp } from "../engine/physiology";
import { aiClassifyIntent, aiCreatureAttitude, aiNarrative, aiNpcReply } from "../ai/service";
import { bodyCondition, conditionLine, conditionWords } from "../engine/condition";
import { currentObjective, urgentNeed } from "../engine/objective";
import { stripVoiceTags, toVoiceText } from "@/shared/voiceTags";
import { CREATURE_ATTITUDES, encounterBlocked, fallbackAttitude, nightEncounter, type CreatureAttitude } from "../engine/vampire";
import { clientDice, rngFor } from "../engine/rng";
import { LINEAGES, lineageOf, lineageProgress } from "../engine/lineage";
import { difficultyOf, rulesFor } from "../engine/difficulty";
import { powerView } from "../engine/powers";
import { CLASS_BY_ID } from "../engine/classes";
import { campaignStory } from "../engine/story";
import { broadcastStateChanged } from "./realtime";
import { mediaBase, mediaUrl } from "./media";

/** Ações que recebem uma linha de ambientação (IA ou o próprio desfecho escrito da história). */
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
  // Dado do aparelho só entra em escolha de evento e só no modo DICE_AUTHORITY=client.
  const dice = clientDice(data.params.d20);
  if (dice && data.type === "escolha_evento" && getConfig().DICE_AUTHORITY === "client") data.params.d20 = dice;
  else delete data.params.d20;
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
  // Se a rodada resolveu, o broadcast já saiu em tryResolveRound. Senão, avisamos o
  // grupo de que a ação entrou: o "aguardando você" aparece na hora, sem os 3 s de polling.
  if (!(await tryResolveRound(campaignId))) {
    const fresh = await getCampaignRow(campaignId);
    await broadcastStateChanged(campaignId, fresh.version);
  }
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
 * Pedido explícito de encontro (rota mantida por compatibilidade). No modo história quem
 * dispara os encontros é o próprio servidor, depois das rodadas noturnas (nightAmbushes).
 * A regra (engine/vampire.ts) decide se houve ataque: só à noite, longe do fogo, com intervalo.
 */
export async function encounter(user: SessionUser, campaignId: string, input: unknown) {
  const { kind } = encounterSchema.parse(input);
  const camp = await requireMember(user, campaignId);
  if (camp.status !== "active") throw conflict("A campanha não está em andamento.", "campanha_inativa");
  const charId = await myCharacterId(campaignId, user.id);
  const res = await runNightEncounter(campaignId, charId, user.id, kind);
  if (res.happened) {
    const fresh = await getCampaignRow(campaignId);
    await broadcastStateChanged(campaignId, fresh.version);
  }
  return res;
}

/** Chance de algo sair do escuro depois de uma ação noturna ao ar livre, por agressividade do modo. */
export const AMBUSH_BASE = 0.1;
export const AMBUSH_PER_AGGRESSION = 0.25;

/**
 * Modo história: sem boneco andando no escuro, o SERVIDOR decide se algo se aproxima de quem
 * acabou de agir à noite, fora de abrigo. Determinístico por semente/rodada; respeita fogo e intervalo.
 */
async function nightAmbushes(campaignId: string, charIds: string[], round: number): Promise<void> {
  if (!charIds.length) return;
  const camp = await getCampaignRow(campaignId);
  if (camp.status !== "active") return;
  const content = getScenario(camp.scenario_id);
  const world = await loadWorld(campaignId);
  const chars = await loadCampaignCharacters(campaignId);
  const rules = rulesFor(difficultyOf(world.flags));
  for (const id of [...new Set(charIds)]) {
    const char = chars.find((c) => c.id === id);
    if (!char?.alive || isSheltered(world, content, char.status.locationId) || encounterBlocked(char, world, content)) continue;
    const rng = rngFor(world.seed, round, id, "emboscada");
    if (rng() >= AMBUSH_BASE + AMBUSH_PER_AGGRESSION * rules.aggression) continue;
    await runNightEncounter(campaignId, id, char.userId, rng() < 0.6 ? "morcego" : "alma");
  }
}

async function runNightEncounter(campaignId: string, charId: string, userId: string, kind: "morcego" | "alma") {
  const db = getDb();
  const camp = await getCampaignRow(campaignId);
  const content = getScenario(camp.scenario_id);

  // 1) Fora da transação: se vai haver encontro, a IA decide a ATITUDE (lista fechada) e escreve a cena.
  const world0 = await loadWorld(campaignId);
  const chars0 = await loadCampaignCharacters(campaignId);
  const char0 = chars0.find((c) => c.id === charId);
  if (!char0) throw notFound("Personagem não encontrado.");
  const blocked = encounterBlocked(char0, world0, content);
  if (blocked) return { happened: false, reason: blocked, bitten: false, level: 0, attitude: null, turned: null };
  const rng = rngFor(world0.seed, world0.minute, charId, "noite");
  const rules = rulesFor(difficultyOf(world0.flags));
  const fallback = fallbackAttitude(kind, world0, rng);
  const ai = await aiCreatureAttitude(
    { userId, campaignId },
    {
      creature: kind === "morcego" ? "morcego-vampiro" : "alma na névoa",
      allowedAttitudes: [...CREATURE_ATTITUDES[kind]],
      difficulty: rules.label,
      aggression: rules.aggression,
      isNight: true,
      locationName: content.locations[char0.status.locationId]?.name ?? "",
      playerLineage: LINEAGES[lineageOf(char0)].label,
      playerCondition: char0.alive ? conditionWords(bodyCondition(char0)).slice(0, 4) : [],
      groupSize: chars0.filter((c) => c.alive && c.status.locationId === char0.status.locationId).length,
    },
    fallback,
  );

  // 2) Na transação: a regra aplica a mecânica da atitude escolhida.
  let result: ReturnType<typeof nightEncounter> | null = null;
  await db.tx(async () => {
    await db.lock(`campaign:${campaignId}`);
    const world = await loadWorld(campaignId);
    const chars = await loadCampaignCharacters(campaignId);
    const char = chars.find((c) => c.id === charId);
    if (!char) throw notFound("Personagem não encontrado.");
    result = nightEncounter(char, world, content, kind, rngFor(world.seed, world.minute, charId, "noite-ataque"), newId, ai.attitude as CreatureAttitude);
    if (!result.happened) return;
    await saveCharacter(char);
    await saveWorld(world);
    if (ai.line) {
      await addLog(
        campaignId,
        charId,
        world.minute,
        "narrative",
        ai.line,
        ai.speech ? { ...ai.speech, speakerKey: `creature:${kind}` } : null,
      );
    }
    for (const line of result.lines) await addLog(campaignId, charId, world.minute, "narrative", line);
    if (result.turned) {
      await addLog(campaignId, null, world.minute, "party", `🩸 ${char.name} despertou a linhagem ${LINEAGES[result.turned].label}.`);
    }
  });
  const r = result as ReturnType<typeof nightEncounter> | null;
  return {
    happened: !!r?.happened, reason: r?.reason ?? null, bitten: !!r?.bitten, level: r?.level ?? 0,
    attitude: r?.attitude ?? null, turned: r?.turned ?? null,
  };
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
  // Regra de mesa: a história só anda quando TODOS os vivos jogaram a sua vez (no solo, o
  // próprio jogador). Com o grupo separado, quem está fora da cena joga a própria ação.
  if (!pending.length) return false;
  if (pending.some((a) => a.completes_at > now.toISOString())) return false;

  const world = await loadWorld(campaignId);
  const activeEvent = await loadActiveEvent(campaignId);
  const byId = new Map(chars.map((c) => [c.id, c]));
  const reports: Record<string, ActionReport> = {};
  const actions: RoundAction[] = [];
  const autoRows: { id: string; charId: string; type: string; params: Record<string, unknown>; minutes: number }[] = [];

  const missing = alive.filter((c) => !pending.some((a) => a.character_id === c.id));
  if (missing.length) {
    // Quem sumiu da mesa não trava o grupo para sempre: passado o prazo da rodada
    // (ROUND_TIMEOUT_SECONDS desde a primeira jogada), recebe a ação segura.
    if (!camp.round_deadline_at || camp.round_deadline_at > now.toISOString()) return false;
    for (const char of missing) {
      const auto = defaultActionFor(char, activeEvent, content);
      autoRows.push({ id: newId(), charId: char.id, type: auto.type, params: auto.params, minutes: auto.minutes });
    }
  }

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
  for (const r of autoRows) {
    const char = byId.get(r.charId)!;
    const auto = defaultActionFor(char, activeEvent, content);
    actions.push({ ...auto, id: r.id, characterId: char.id, isOwner: char.userId === camp.owner_user_id });
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
  const narratives: Record<string, {
    text: string;
    speech: Awaited<ReturnType<typeof aiNarrative>>["speech"];
    speakerKey: string;
  }> = {};
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
          narratives[actionId] = { text: r.text, speech: r.speech, speakerKey: `npc:${npc.id}` };
        }
      } else if (rep.minutes > 0 && NARRATED.includes(rep.actionType)) {
        const cond = char.alive ? bodyCondition(char) : [];
        const condition = conditionLine(cond, world.minute);
        const storyFallback = [...rep.lines.filter((line) => line.trim()), condition]
          .filter(Boolean)
          .join(" ")
          .slice(0, 1_600);
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
          storyFallback || rep.summary,
        );
        narratives[actionId] = { text: r.text, speech: r.speech, speakerKey: "narrator" };
      }
    }),
  );

  // Transação única: autosave de tudo ou nada. Trava + versão otimista impedem resolver duas vezes.
  const resolved = await db.tx(async () => {
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
        newId(), actionId, campaignId, char.id, rep.success === null ? null : +rep.success, rep.summary, narratives[actionId]?.text ?? "",
        JSON.stringify(rep.effects), "{}", JSON.stringify({ status: char.status, health: char.health }), world.minute, nowStr,
      );
      for (const e of rep.effects) if (e.startsWith("pista: ")) clueFinder[e.slice(7)] = char.id;
      const auto = autoRows.some((r) => r.id === actionId);
      await addLog(campaignId, char.id, world.minute, "result", `${auto ? "⏱ Tempo esgotado — ação automática. " : ""}${rep.lines.join("\n")}`);
      if (narratives[actionId]) {
        const line = narratives[actionId];
        await addLog(
          campaignId,
          char.id,
          world.minute,
          rep.actionType === "conversar" ? "npc" : "narrative",
          line.text,
          { ...line.speech, speakerKey: line.speakerKey },
        );
      }
      if (chars.length > 1) await addLog(campaignId, null, world.minute, "party", `${char.name}: ${rep.summary}`);
    }
    for (const n of result.notes) await addLog(campaignId, n.characterId, world.minute, "narrative", n.text);
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
  // Modo história: depois de uma rodada noturna, algo pode sair do escuro (fora da transação: usa IA).
  if (resolved) {
    if (!result.ended) {
      await nightAmbushes(campaignId, Object.values(reports).filter((r) => r.minutes > 0).map((r) => r.characterId), camp.current_round);
    }
    // O grupo é avisado por push em vez de esperar o polling. Vai depois da transação e
    // fora dela: a partida já está salva, então a rede nunca segura o autosave.
    const after = await getCampaignRow(campaignId);
    await broadcastStateChanged(campaignId, after.version);
  }
  return resolved;
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
    // Chefes (flags da campanha: o grupo vence junto). unlockAchievement ignora repetidas.
    if (c.alive) {
      if (world.flags.mae_caida) await unlockAchievement(c.userId, "mae_caida", campaignId);
      if (world.flags.ambar_caido || world.flags.ambar_aliado || world.flags.ambar_alfa) await unlockAchievement(c.userId, "lobo_ambar", campaignId);
      if (world.flags.tavares_resolvido) await unlockAchievement(c.userId, "tavares", campaignId);
      if (world.flags.iara_em_paz) await unlockAchievement(c.userId, "iara_paz", campaignId);
      if (world.flags.pacto_sangue && lineageOf(c) === "vampire") await unlockAchievement(c.userId, "pacto", campaignId);
    }
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
  const logRows = await db.all<{
    id: number;
    character_id: string | null;
    game_minute: number;
    kind: string;
    text: string;
    speaker_key: string | null;
    speech_tone: string | null;
    speech_voice: string | null;
    speech_say: string | null;
  }>(
    `SELECT id, character_id, game_minute, kind, text, speaker_key, speech_tone, speech_voice, speech_say FROM campaign_log
      WHERE campaign_id = ? AND (character_id IS NULL OR character_id = ?) ORDER BY id DESC LIMIT 60`,
    campaignId, me?.id ?? "",
  );
  const lastResolution = me
    ? await db.get<{ action_id: string; effects: string; success: number | null }>(
        "SELECT action_id, effects, success FROM action_resolutions WHERE campaign_id = ? AND character_id = ? ORDER BY created_at DESC LIMIT 1",
        campaignId, me.id,
      )
    : undefined;
  const rollEffect = [...json<string[]>(lastResolution?.effects, [])]
    .reverse()
    .find((effect) => /\[d20:\d+:\d+/.test(effect));
  const rollMatch = rollEffect?.match(/^teste ([^:]+): (sucesso|falha).*\[d20:(\d+):(\d+):(-?\d+):(-?\d+):(\d):(\d):(-?\d)\]/);
  const myPending = me ? actions.find((a) => a.character_id === me.id) : undefined;
  const loc = me ? me.status.locationId : content.startLocation;
  const story = campaignStory(world, content, activeEvent?.eventId ?? null);
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
    // Prefixo de CDN para o cliente montar os sons de efeito por conta própria (esses não
    // passam pelo servidor). Vazio sem Cloudinary: o `new Audio` continua com `/audio/...`.
    media: { audioBase: mediaBase() },
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
      difficulty: { key: difficultyOf(world.flags), label: rulesFor(difficultyOf(world.flags)).label },
      roundDeadlineAt: camp.round_deadline_at,
      paused: camp.status === "active" && isPaused(camp),
      savedAt: camp.updated_at,
      version: camp.version,
      serverTime: nowIso(),
    },
    me: me
      ? {
          ...characterView(me, content, world, inEvent, check),
          // Classe, disciplinas e recurso (Fome/Fúria/Eco/Obsessão), com as ações prontas para enviar.
          power: {
            ...powerView(me, world.minute),
            // Mostra a ficha inteira mesmo durante um evento; `check` mantém as
            // ações bloqueadas até a decisão narrativa ser resolvida.
            actions: [
              ...(me.power?.classId ? CLASS_BY_ID[me.power.classId].powers : []).map((pw) => ({
                type: "usar_poder", label: pw.name, params: { power: pw.id }, ...check({ type: "usar_poder", params: { power: pw.id } }),
              })),
              ...(["vampire", "werewolf"].includes(lineageOf(me)) && me.power?.classId
                ? [{ type: "alimentar_se", label: lineageOf(me) === "vampire" ? "Caçar e se alimentar" : "Caçar como a fera", params: {}, ...check({ type: "alimentar_se", params: {} }) }]
                : []),
            ],
          },
        }
      : null,
    // Ato I → todos com classe (`ato2`) → grupo reunido (`encontro_feito`) = Ato II.
    acts: { allAwakened: !!world.flags.ato2, reunited: !!world.flags.encontro_feito, meetingLocation: content.meetingLocation ?? null },
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
      image: mediaUrl("/assets/mapa-vale-silente.png"),
      regions: (content.regions ?? []).map((region) => ({
        id: region.id,
        title: region.title,
        subtitle: region.subtitle,
        art: mediaUrl("/art/vale-silente/phase-atlas.webp"),
        artPosition: region.artPosition,
        unlocked:
          region.unlockAct <= (story.phase?.index ?? 1)
          || region.locationIds.some((id) => world.locations[id]?.discovered || world.locations[id]?.visited),
        current: region.locationIds.includes(loc),
        locationIds: region.locationIds.filter((id) => world.locations[id]?.discovered),
      })),
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
          regionId: content.regions?.find((region) => region.locationIds.includes(l.id))?.id ?? null,
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
          // Destino da viagem narrativa durante a resolução da ação.
          target: myPending.type === "mover" ? String(json<Record<string, unknown>>(myPending.params, {}).to ?? "") || null : null,
          // Ninguém espera ninguém: a ação resolve sozinha (campo mantido por compatibilidade).
          waitingFor: [] as string[],
        }
      : null,
    event:
      ev && activeEvent
        ? {
            id: ev.id,
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
              return {
                id: ch.id,
                label: ch.label,
                durationMinutes: ch.durationMinutes,
                available: req.ok && canAct && inEvent,
                reason: req.ok ? null : req.reason,
                roll: ch.outcome.check && me
                  ? {
                      attribute: ch.outcome.check.attr,
                      ...checkPreview(me, ch.outcome.check, world.minute, content),
                      /** true = o aparelho rola e mostra na hora (DICE_AUTHORITY=client). */
                      client: getConfig().DICE_AUTHORITY === "client",
                    }
                  : null,
              };
            }),
          }
        : null,
    objective: me && me.alive && camp.status === "active" ? currentObjective(me, world, content) : null,
    story,
    urgent: me && camp.status === "active" ? urgentNeed(me) : null,
    lastRoll: lastResolution && rollMatch
      ? {
          id: lastResolution.action_id,
          attribute: rollMatch[1],
          value: Number(rollMatch[3]),
          target: Number(rollMatch[4]),
          success: rollMatch[2] === "sucesso",
          modifier: Number(rollMatch[5]),
          finalTotal: Number(rollMatch[6]),
          advantage: rollMatch[7] === "1",
          disadvantage: rollMatch[8] === "1",
          crit: rollMatch[9] === "1" ? "critical_success" : rollMatch[9] === "-1" ? "critical_failure" : null,
        }
      : null,
    clues: world.clues.map((k) => content.clues[k]).filter(Boolean),
    log: logRows
      .reverse()
      .map((l) => ({
        id: Number(l.id),
        kind: l.kind,
        characterId: l.character_id,
        speaker: l.speaker_key?.startsWith("npc:")
          ? content.npcs[l.speaker_key.slice(4)]?.name ?? null
          : l.character_id && l.kind !== "npc"
            ? chars.find((c) => c.id === l.character_id)?.name ?? null
            : null,
        speakerKey: l.speaker_key,
        clock: clockLabel(content, l.game_minute),
        day: dayNumber(content, l.game_minute),
        text: stripVoiceTags(l.text),
        voice: toVoiceText(l.speech_say ?? l.text),
        tone: l.speech_tone,
        voiceDirection: l.speech_voice,
      })),
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
  const lineageKey = lineageOf(c);
  const lineageInfo = LINEAGES[lineageKey];
  const awakening = lineageProgress(c);
  const lineage = {
    ...lineageInfo,
    label: lineageKey === "human" && awakening ? `Humano · ${awakening.toward === "vampire" ? "sangue marcado" : "vozes na névoa"}` : lineageInfo.label,
    description: lineageKey === "human" && awakening ? (awakening.toward === "vampire" ? "Algo frio cresce a cada mordida." : "As vozes ficam mais próximas a cada toque.") : lineageInfo.description,
    revealed: lineageKey !== "human",
    progress: awakening?.progress ?? (lineageKey === "human" ? 0 : 1),
    max: awakening?.max ?? 1,
  };
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
    lineage,
    attributes: c.attrs,
    status: c.status,
    health: {
      ...c.health,
      diseases: c.health.diseases.map((d) => ({
        key: d.key,
        label: d.key === "gastroenterite" ? "Gastroenterite" : d.key === "mordida" ? `Mordida (${d.level ?? 1}/${c.rules ? rulesFor(c.rules.difficulty).turnAt : 3}) · sede escura` : d.key === "licantropia" ? "Marca lunar · linhagem desperta" : d.key === "assombro" ? `Assombro (${d.level ?? 1}/3) · vozes na névoa` : d.key === "fe" ? "Marca da fé · caçador" : "Febre",
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
