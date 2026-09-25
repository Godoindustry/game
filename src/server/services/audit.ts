/** Registro de ações administrativas (admin_logs) e de segurança (security_logs). */
import { getDb, nowIso } from "../db/database";
import { newId } from "./ids";

export async function adminLog(
  actorUserId: string | null,
  action: string,
  target: { type?: string; id?: string } = {},
  details: Record<string, unknown> = {},
  ip: string | null = null,
): Promise<void> {
  await getDb().run(
    "INSERT INTO admin_logs(id,actor_user_id,action,target_type,target_id,details,ip,created_at) VALUES(?,?,?,?,?,?,?,?)",
    newId(), actorUserId, action, target.type ?? null, target.id ?? null, JSON.stringify(details), ip, nowIso(),
  );
}

export async function securityLog(kind: string, userId: string | null, details: Record<string, unknown> = {}, ip: string | null = null): Promise<void> {
  await getDb().run(
    "INSERT INTO security_logs(user_id,kind,details,ip,created_at) VALUES(?,?,?,?,?)",
    userId, kind, JSON.stringify(details), ip, nowIso(),
  );
}
