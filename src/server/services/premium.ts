/**
 * Premium para os 12 primeiros usuários.
 * - A vaga é atribuída dentro da transação do cadastro, sob uma trava lógica
 *   (pg_advisory_xact_lock no Postgres; transação exclusiva no SQLite), e slot_number
 *   é UNIQUE: nem uma corrida entre cadastros gera 13 vagas.
 * - Vagas não são reaproveitadas: se um pioneiro for removido, ninguém "herda" a vaga.
 * - O ADM MASTER não ocupa vaga (é criado pelo seed, não pelo cadastro).
 */
import { getDb, nowIso } from "../db/database";
import { getConfig } from "../config";

export async function tryGrantEarlyAdopter(userId: string): Promise<number | null> {
  const db = getDb();
  return db.tx(async () => {
    await db.lock("premium-early-slots");
    const row = await db.get<{ n: number }>("SELECT COALESCE(MAX(slot_number), 0) AS n FROM premium_status WHERE slot_number IS NOT NULL");
    const next = Number(row?.n ?? 0) + 1;
    if (next > getConfig().PREMIUM_EARLY_SLOTS) return null;
    await db.run(
      "INSERT INTO premium_status(user_id,is_premium,source,slot_number,granted_at) VALUES(?,1,'early_adopter',?,?)",
      userId, next, nowIso(),
    );
    return next;
  });
}

export async function isPremium(userId: string): Promise<boolean> {
  const row = await getDb().get<{ is_premium: number }>(
    "SELECT is_premium FROM premium_status WHERE user_id = ? AND revoked_at IS NULL",
    userId,
  );
  return Boolean(row?.is_premium);
}

export async function premiumInfo(userId: string) {
  return getDb().get<{ source: string; slot_number: number | null; granted_at: string; revoked_at: string | null }>(
    "SELECT source, slot_number, granted_at, revoked_at FROM premium_status WHERE user_id = ?",
    userId,
  );
}

export async function earlySlotsUsed(): Promise<number> {
  const row = await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM premium_status WHERE slot_number IS NOT NULL");
  return Number(row?.n ?? 0);
}

export async function setPremium(userId: string, premium: boolean): Promise<void> {
  const db = getDb();
  const existing = await premiumInfo(userId);
  if (premium) {
    if (existing) await db.run("UPDATE premium_status SET is_premium=1, revoked_at=NULL WHERE user_id=?", userId);
    else await db.run("INSERT INTO premium_status(user_id,is_premium,source,granted_at) VALUES(?,1,'admin_grant',?)", userId, nowIso());
  } else if (existing) {
    await db.run("UPDATE premium_status SET is_premium=0, revoked_at=? WHERE user_id=?", nowIso(), userId);
  }
}
