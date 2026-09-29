/**
 * Campanhas, membros, convites e ficha de personagem.
 * Autorização por recurso: toda função recebe o usuário da sessão e verifica o vínculo.
 */
import { z } from "zod";
import { getDb, json, nowIso } from "../db/database";
import { DIFFICULTIES, DIFFICULTY_RULES, difficultyOf } from "../engine/difficulty";
import { getConfig } from "../config";
import { newId, newToken, sha256 } from "./ids";
import { badRequest, conflict, forbidden, notFound } from "./errors";
import type { SessionUser } from "./auth";
import { isPremium } from "./premium";
import { adminLog } from "./audit";
import { getScenario } from "../content/valeSilente";
import { validateCharacterSheet } from "../engine/character";
import { initCharacter, initWorld } from "../engine/setup";
import { startEvent } from "../engine/events";
import { revealLocation } from "../engine/effects";
import { neighbors } from "../engine/actions";
import { addLog, insertCharacter, saveWorld } from "./stateRepo";

export const MAX_PLAYERS = 4;
const INVITE_TTL_HOURS = 48;

export interface CampaignRow {
  id: string;
  name: string;
  owner_user_id: string;
  scenario_id: string;
  mode: "solo" | "coop";
  status: "lobby" | "active" | "finished";
  max_players: number;
  seed: string;
  game_minutes: number;
  current_round: number;
  round_deadline_at: string | null;
  last_heartbeat_at: string | null;
  flags: string;
  ending: string | null;
  ending_type: string | null;
  version: number;
  updated_at: string;
  created_at: string;
}

export const createCampaignSchema = z.strictObject({
  name: z
    .string()
    .max(60)
    .transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, "").trim())
    .pipe(z.string().min(3, "Nome muito curto.")),
  mode: z.enum(["solo", "coop"]),
  difficulty: z.enum(DIFFICULTIES).default("medio"),
});

function difficultyView(flags: string) {
  const key = difficultyOf(json(flags, {}));
  return { key, label: DIFFICULTY_RULES[key].label };
}

export async function getCampaignRow(id: string): Promise<CampaignRow> {
  const row = await getDb().get<CampaignRow>("SELECT * FROM campaigns WHERE id = ?", id);
  if (!row) throw notFound("Campanha não encontrada.");
  return { ...row, version: Number(row.version), current_round: Number(row.current_round), game_minutes: Number(row.game_minutes) };
}

export async function membership(campaignId: string, userId: string) {
  return getDb().get<{ role: "owner" | "player" }>("SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?", campaignId, userId);
}

/** Garante que o usuário participa da campanha (ou é ADM MASTER, só leitura). */
export async function requireMember(user: SessionUser, campaignId: string, opts: { allowMaster?: boolean } = {}): Promise<CampaignRow> {
  const camp = await getCampaignRow(campaignId);
  if (await membership(campaignId, user.id)) return camp;
  if (opts.allowMaster && user.role === "master") return camp;
  throw notFound("Campanha não encontrada."); // não revela a existência para quem não é membro
}

export async function requireOwner(user: SessionUser, campaignId: string): Promise<CampaignRow> {
  const camp = await requireMember(user, campaignId);
  if (camp.owner_user_id !== user.id) throw forbidden("Apenas o administrador da campanha pode fazer isso.");
  return camp;
}

async function memberCount(campaignId: string): Promise<number> {
  return Number((await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM campaign_members WHERE campaign_id = ?", campaignId))?.n ?? 0);
}

export async function createCampaign(user: SessionUser, input: unknown) {
  const data = createCampaignSchema.parse(input);
  const db = getDb();
  const c = getConfig();
  const premium = await isPremium(user.id);
  const limit = premium ? c.PREMIUM_MAX_ACTIVE_CAMPAIGNS : c.FREE_MAX_ACTIVE_CAMPAIGNS;
  const id = newId();
  const now = nowIso();
  await db.tx(async () => {
    await db.lock(`user-campaigns:${user.id}`);
    const active = Number(
      (await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM campaigns c JOIN campaign_members m ON m.campaign_id = c.id WHERE m.user_id = ? AND c.status <> 'finished'",
        user.id,
      ))?.n ?? 0,
    );
    if (active >= limit) throw conflict(`Limite de ${limit} campanhas em andamento atingido${premium ? "" : " (premium permite mais)"}.`, "limite_campanhas");
    await db.run(
      `INSERT INTO campaigns(id,name,owner_user_id,scenario_id,mode,status,max_players,seed,flags,created_at,updated_at)
       VALUES(?,?,?,?,?,'lobby',?,?,?,?,?)`,
      id, data.name, user.id, "vale_silente", data.mode, data.mode === "solo" ? 1 : MAX_PLAYERS, c.FIXED_SEED ?? newToken(12),
      JSON.stringify({ dificuldade: data.difficulty }), now, now,
    );
    await db.run("INSERT INTO campaign_members(id,campaign_id,user_id,role,joined_at) VALUES(?,?,?,'owner',?)", newId(), id, user.id, now);
  });
  return getCampaignRow(id);
}

export async function listMyCampaigns(user: SessionUser) {
  const rows = await getDb().all<CampaignRow & { role: string; members: number; character_name: string | null; alive: number | null }>(
    `SELECT c.*, m.role,
            (SELECT COUNT(*) FROM campaign_members mm WHERE mm.campaign_id = c.id) AS members,
            ch.name AS character_name, ch.alive AS alive
       FROM campaigns c
       JOIN campaign_members m ON m.campaign_id = c.id AND m.user_id = ?
       LEFT JOIN characters ch ON ch.campaign_id = c.id AND ch.user_id = ?
      ORDER BY c.updated_at DESC`,
    user.id, user.id,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    status: r.status,
    role: r.role,
    members: Number(r.members),
    maxPlayers: r.max_players,
    characterName: r.character_name,
    alive: r.alive === null ? null : !!r.alive,
    ending: r.ending,
    endingType: r.ending_type,
    updatedAt: r.updated_at,
    difficulty: difficultyView(r.flags),
  }));
}

export async function lobbyView(user: SessionUser, campaignId: string) {
  const camp = await requireMember(user, campaignId, { allowMaster: true });
  const members = await getDb().all<{ user_id: string; role: string; display_name: string; character_id: string | null; character_name: string | null }>(
    `SELECT m.user_id, m.role, p.display_name, ch.id AS character_id, ch.name AS character_name
       FROM campaign_members m JOIN profiles p ON p.user_id = m.user_id
       LEFT JOIN characters ch ON ch.campaign_id = m.campaign_id AND ch.user_id = m.user_id
      WHERE m.campaign_id = ? ORDER BY m.joined_at`,
    campaignId,
  );
  return {
    id: camp.id,
    name: camp.name,
    mode: camp.mode,
    status: camp.status,
    maxPlayers: camp.max_players,
    difficulty: difficultyView(camp.flags),
    isOwner: camp.owner_user_id === user.id,
    members: members.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      role: m.role,
      hasCharacter: !!m.character_id,
      characterName: m.character_name,
      isMe: m.user_id === user.id,
    })),
  };
}

// ---------- Convites ----------
export async function createInvite(user: SessionUser, campaignId: string) {
  const camp = await requireOwner(user, campaignId);
  if (camp.mode !== "coop") throw badRequest("Campanhas solo não aceitam convites.");
  if (camp.status !== "lobby") throw conflict("Convites só podem ser criados antes do início.");
  if ((await memberCount(campaignId)) >= camp.max_players) throw conflict("A campanha já está cheia.", "campanha_cheia");
  const code = newToken(16);
  const now = new Date();
  await getDb().run(
    "INSERT INTO campaign_invites(id,campaign_id,code_hash,created_by,max_uses,uses,expires_at,created_at) VALUES(?,?,?,?,?,0,?,?)",
    newId(), campaignId, sha256(code), user.id, MAX_PLAYERS - 1, new Date(now.getTime() + INVITE_TTL_HOURS * 3600_000).toISOString(), now.toISOString(),
  );
  return { code, url: `${getConfig().APP_URL}/convite/${code}`, expiresInHours: INVITE_TTL_HOURS };
}

export async function revokeInvites(user: SessionUser, campaignId: string): Promise<void> {
  await requireOwner(user, campaignId);
  await getDb().run("UPDATE campaign_invites SET revoked_at = ? WHERE campaign_id = ? AND revoked_at IS NULL", nowIso(), campaignId);
}

export async function acceptInvite(user: SessionUser, input: unknown) {
  const { code } = z.strictObject({ code: z.string().min(10).max(100) }).parse(input);
  const db = getDb();
  const inv0 = await db.get<{ campaign_id: string }>("SELECT campaign_id FROM campaign_invites WHERE code_hash = ?", sha256(code));
  if (!inv0) throw badRequest("Convite inválido ou expirado.", "convite_invalido");
  return db.tx(async () => {
    // Trava por campanha: duas pessoas aceitando ao mesmo tempo não estouram o limite de 4.
    await db.lock(`campaign:${inv0.campaign_id}`);
    const inv = await db.get<{ id: string; campaign_id: string; max_uses: number; uses: number; expires_at: string; revoked_at: string | null }>(
      "SELECT * FROM campaign_invites WHERE code_hash = ?",
      sha256(code),
    );
    if (!inv || inv.revoked_at || inv.expires_at < nowIso() || inv.uses >= inv.max_uses) {
      throw badRequest("Convite inválido ou expirado.", "convite_invalido");
    }
    const camp = await getCampaignRow(inv.campaign_id);
    if (camp.status !== "lobby") throw conflict("Esta campanha já começou.", "campanha_iniciada");
    if (await membership(camp.id, user.id)) return { campaignId: camp.id, alreadyMember: true };
    if ((await memberCount(camp.id)) >= Math.min(camp.max_players, MAX_PLAYERS)) throw conflict("A campanha já está cheia (máx. 4).", "campanha_cheia");
    await db.run("INSERT INTO campaign_members(id,campaign_id,user_id,role,joined_at) VALUES(?,?,?,'player',?)", newId(), camp.id, user.id, nowIso());
    await db.run("UPDATE campaign_invites SET uses = uses + 1 WHERE id = ?", inv.id);
    return { campaignId: camp.id, alreadyMember: false };
  });
}

// ---------- Personagem ----------
export async function createCharacter(user: SessionUser, campaignId: string, input: unknown) {
  const camp = await requireMember(user, campaignId);
  if (camp.status !== "lobby") throw conflict("Personagens são criados antes do início da campanha.");
  const v = validateCharacterSheet(input);
  if (!v.ok) throw badRequest(v.error, "ficha_invalida");
  const db = getDb();
  const content = getScenario(camp.scenario_id);
  return db.tx(async () => {
    await db.lock(`campaign:${campaignId}`);
    if (await db.get("SELECT 1 FROM characters WHERE campaign_id = ? AND user_id = ?", campaignId, user.id)) {
      throw conflict("Você já criou um personagem nesta campanha.");
    }
    const char = initCharacter(content, newId, { id: newId(), userId: user.id }, v.sheet, v.finalAttributes);
    await insertCharacter(campaignId, char, v.sheet);
    return { characterId: char.id, attributes: v.finalAttributes };
  });
}

// ---------- Ciclo de vida ----------
export async function startCampaign(user: SessionUser, campaignId: string) {
  await requireOwner(user, campaignId);
  const db = getDb();
  await db.tx(async () => {
    await db.lock(`campaign:${campaignId}`);
    const camp = await getCampaignRow(campaignId);
    if (camp.status !== "lobby") throw conflict("A campanha já foi iniciada.");
    const members = await db.all<{ user_id: string; has_char: number | boolean }>(
      `SELECT m.user_id, EXISTS(SELECT 1 FROM characters c WHERE c.campaign_id = m.campaign_id AND c.user_id = m.user_id) AS has_char
         FROM campaign_members m WHERE m.campaign_id = ?`,
      campaignId,
    );
    if (members.some((m) => !m.has_char)) throw conflict("Todos os participantes precisam criar o personagem antes de começar.", "fichas_pendentes");
    const content = getScenario(camp.scenario_id);
    const world = initWorld(content, campaignId, camp.seed);
    world.flags.dificuldade = difficultyOf(json(camp.flags, {})); // initWorld zera as flags: mantém o modo escolhido
    // Ato I: cada um acorda num ponto do vale. O dono começa nos destroços (evento de abertura);
    // os convidados, em ordem de entrada, nos outros pontos de partida.
    const charRows = await db.all<{ id: string; user_id: string; joined_at: string }>(
      `SELECT c.id, c.user_id, m.joined_at FROM characters c
         JOIN campaign_members m ON m.campaign_id = c.campaign_id AND m.user_id = c.user_id
        WHERE c.campaign_id = ? ORDER BY (c.user_id = ?) DESC, m.joined_at, c.id`,
      campaignId, camp.owner_user_id,
    );
    const starts = content.startLocations?.length ? content.startLocations : [content.startLocation];
    const placed = charRows.map((r, i) => ({ id: r.id, loc: starts[i % starts.length] }));
    for (const p of placed) {
      await db.run("UPDATE character_status SET location_id = ? WHERE character_id = ?", p.loc, p.id);
      revealLocation(world, p.loc);
      world.locations[p.loc].visited = true;
      for (const n of neighbors(world, content, p.loc)) revealLocation(world, n.to);
    }
    const ev = startEvent(content)!;
    world.eventHistory[ev.id] = 0;
    await saveWorld(world);
    const now = nowIso();
    await db.run("UPDATE campaigns SET status='active', started_at=?, last_heartbeat_at=?, updated_at=? WHERE id=?", now, now, now, campaignId);
    // O evento de abertura é de quem acordou no local dele (os destroços).
    const openers = placed.filter((p) => !ev.locationId || p.loc === ev.locationId).map((p) => p.id);
    await db.run(
      "INSERT INTO campaign_events(id,campaign_id,event_id,status,participants,round_triggered,triggered_at_minute,created_at) VALUES(?,?,?,'active',?,1,0,?)",
      newId(), campaignId, ev.id, JSON.stringify(openers.length ? openers : placed.map((p) => p.id)), now,
    );
    // Cada um só vê o próprio despertar (quem está longe não sabe o que houve nos destroços).
    for (const id of openers.length ? openers : placed.map((p) => p.id)) await addLog(campaignId, id, 0, "event", `【${ev.title}】 ${ev.body}`);
    for (const p of placed) {
      const intro = content.startIntros?.[p.loc];
      if (intro && !openers.includes(p.id)) await addLog(campaignId, p.id, 0, "narrative", `【${content.locations[p.loc].name}】 ${intro}`);
    }
  });
  return lobbyView(user, campaignId);
}

export async function removeMember(actor: SessionUser, campaignId: string, targetUserId: string, ip: string | null) {
  const camp = await getCampaignRow(campaignId);
  const isOwner = camp.owner_user_id === actor.id && !!(await membership(campaignId, actor.id));
  if (!isOwner && actor.role !== "master") throw forbidden("Apenas o administrador da campanha pode remover participantes.");
  if (targetUserId === camp.owner_user_id) throw badRequest("O administrador da campanha não pode ser removido.");
  if (!(await membership(campaignId, targetUserId))) throw notFound("Participante não encontrado.");
  const db = getDb();
  await db.tx(async () => {
    // Mesma trava da resolução de rodada: não apaga o personagem no meio de um autosave.
    await db.lock(`campaign:${campaignId}`);
    await db.run("DELETE FROM characters WHERE campaign_id = ? AND user_id = ?", campaignId, targetUserId);
    await db.run("DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?", campaignId, targetUserId);
  });
  if (actor.role === "master" && !isOwner) await adminLog(actor.id, "campaign.remove_member", { type: "campaign", id: campaignId }, { targetUserId }, ip);
}

export async function leaveCampaign(user: SessionUser, campaignId: string) {
  const camp = await requireMember(user, campaignId);
  if (camp.owner_user_id === user.id) throw badRequest("O administrador não pode sair; encerre a campanha.");
  const db = getDb();
  await db.tx(async () => {
    await db.lock(`campaign:${campaignId}`);
    await db.run("DELETE FROM characters WHERE campaign_id = ? AND user_id = ?", campaignId, user.id);
    await db.run("DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?", campaignId, user.id);
  });
}

/**
 * Apaga a campanha de vez (só o administrador dela). O banco apaga em cascata personagens,
 * membros, convites, diário, ações e estado do mundo. Campanhas encerradas ficam, para não
 * sumir com a pontuação do ranking.
 */
export async function deleteCampaign(user: SessionUser, campaignId: string): Promise<{ ok: true }> {
  const camp = await requireMember(user, campaignId);
  if (camp.owner_user_id !== user.id) throw forbidden("Só o administrador da campanha pode apagá-la. Você pode sair dela.");
  if (camp.status === "finished") throw conflict("Campanhas encerradas ficam no histórico e no ranking.", "campanha_encerrada");
  const db = getDb();
  await db.tx(async () => {
    await db.lock(`campaign:${campaignId}`);
    await db.run("DELETE FROM campaigns WHERE id = ? AND owner_user_id = ?", campaignId, user.id);
  });
  return { ok: true };
}

export async function endCampaign(actor: SessionUser, campaignId: string, ip: string | null) {
  const camp = await getCampaignRow(campaignId);
  const isOwner = camp.owner_user_id === actor.id;
  if (!isOwner && actor.role !== "master") throw forbidden();
  if (camp.status === "finished") throw conflict("A campanha já foi encerrada.");
  const db = getDb();
  await db.tx(async () => {
    await db.lock(`campaign:${campaignId}`);
    await db.run(
      "UPDATE campaigns SET status='finished', ending='abandonada', ending_type='abandoned', ended_at=?, updated_at=?, version=version+1 WHERE id=?",
      nowIso(), nowIso(), campaignId,
    );
    await db.run("UPDATE player_actions SET status='cancelled' WHERE campaign_id = ? AND status='pending'", campaignId);
  });
  if (!isOwner) await adminLog(actor.id, "campaign.end", { type: "campaign", id: campaignId }, {}, ip);
}
