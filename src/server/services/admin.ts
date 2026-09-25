/**
 * Painel do ADM MASTER. Toda mutação grava em admin_logs.
 * Não existe endpoint para conceder o papel "master": ele vem só do .env (seed).
 */
import { z } from "zod";
import { getDb, nowIso } from "../db/database";
import type { SessionUser } from "./auth";
import { forbidden, notFound, badRequest } from "./errors";
import { adminLog } from "./audit";
import { setPremium, earlySlotsUsed } from "./premium";
import { endCampaign } from "./campaigns";
import { aiUsageSummary } from "../ai/service";
import { getConfig } from "../config";

export function requireMaster(user: SessionUser): void {
  if (user.role !== "master") throw forbidden("Área restrita ao ADM MASTER.");
}

export async function stats() {
  const db = getDb();
  const n = async (sql: string) => Number((await db.get<{ n: number }>(sql))?.n ?? 0);
  return {
    users: await n("SELECT COUNT(*) AS n FROM users"),
    bannedUsers: await n("SELECT COUNT(*) AS n FROM users WHERE status = 'banned'"),
    premiumUsers: await n("SELECT COUNT(*) AS n FROM premium_status WHERE is_premium = 1 AND revoked_at IS NULL"),
    earlySlots: { used: await earlySlotsUsed(), total: getConfig().PREMIUM_EARLY_SLOTS },
    campaigns: {
      lobby: await n("SELECT COUNT(*) AS n FROM campaigns WHERE status = 'lobby'"),
      active: await n("SELECT COUNT(*) AS n FROM campaigns WHERE status = 'active'"),
      finished: await n("SELECT COUNT(*) AS n FROM campaigns WHERE status = 'finished'"),
    },
    actionsResolved: await n("SELECT COUNT(*) AS n FROM action_resolutions"),
    deaths: await n("SELECT COUNT(*) AS n FROM characters WHERE alive = 0"),
    ai: await aiUsageSummary(),
  };
}

export async function listUsers(query: string | null) {
  const q = `%${(query ?? "").slice(0, 60).toLowerCase()}%`;
  return getDb().all(
    `SELECT u.id, u.email, u.role, u.status, u.created_at, u.last_login_at, p.display_name,
            ps.is_premium, ps.source AS premium_source, ps.slot_number, ps.revoked_at AS premium_revoked_at
       FROM users u JOIN profiles p ON p.user_id = u.id
       LEFT JOIN premium_status ps ON ps.user_id = u.id
      WHERE LOWER(u.email) LIKE ? OR LOWER(p.display_name) LIKE ?
      ORDER BY u.created_at ASC LIMIT 200`,
    q, q,
  );
}

const userActionSchema = z.strictObject({ action: z.enum(["ban", "unban", "grant_premium", "revoke_premium", "logout_all"]) });

export async function userAction(actor: SessionUser, targetId: string, input: unknown, ip: string | null) {
  const { action } = userActionSchema.parse(input);
  const db = getDb();
  const target = await db.get<{ id: string; role: string; email: string }>("SELECT id, role, email FROM users WHERE id = ?", targetId);
  if (!target) throw notFound("Usuário não encontrado.");
  if (target.id === actor.id && (action === "ban" || action === "logout_all")) throw badRequest("Você não pode fazer isso com a própria conta.");
  if (target.role === "master" && action === "ban") throw forbidden("Não é possível banir um ADM MASTER.");
  switch (action) {
    case "ban":
      await db.tx(async () => {
        await db.run("UPDATE users SET status = 'banned', updated_at = ? WHERE id = ?", nowIso(), targetId);
        await db.run("DELETE FROM sessions WHERE user_id = ?", targetId);
      });
      break;
    case "unban":
      await db.run("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?", nowIso(), targetId);
      break;
    case "grant_premium":
      await setPremium(targetId, true);
      break;
    case "revoke_premium":
      await setPremium(targetId, false);
      break;
    case "logout_all":
      await db.run("DELETE FROM sessions WHERE user_id = ?", targetId);
      break;
  }
  await adminLog(actor.id, `user.${action}`, { type: "user", id: targetId }, { email: target.email }, ip);
  return { ok: true };
}

export async function listCampaigns() {
  return getDb().all(
    `SELECT c.id, c.name, c.mode, c.status, c.ending, c.game_minutes, c.current_round, c.created_at, c.updated_at, p.display_name AS owner,
            (SELECT COUNT(*) FROM campaign_members m WHERE m.campaign_id = c.id) AS members
       FROM campaigns c JOIN profiles p ON p.user_id = c.owner_user_id
      ORDER BY c.updated_at DESC LIMIT 200`,
  );
}

export async function adminEndCampaign(actor: SessionUser, campaignId: string, ip: string | null) {
  await endCampaign(actor, campaignId, ip);
  return { ok: true };
}

export async function logs() {
  const db = getDb();
  return {
    admin: await db.all(
      `SELECT l.id, l.action, l.target_type, l.target_id, l.details, l.ip, l.created_at, p.display_name AS actor
         FROM admin_logs l LEFT JOIN profiles p ON p.user_id = l.actor_user_id ORDER BY l.created_at DESC LIMIT 100`,
    ),
    security: await db.all("SELECT id, user_id, kind, details, ip, created_at FROM security_logs ORDER BY id DESC LIMIT 100"),
  };
}

export async function outbox() {
  return getDb().all("SELECT id, to_email, subject, body, created_at FROM mail_outbox ORDER BY created_at DESC LIMIT 50");
}
