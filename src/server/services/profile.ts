import { z } from "zod";
import { getDb, nowIso } from "../db/database";
import type { SessionUser } from "./auth";
import { premiumInfo, earlySlotsUsed } from "./premium";
import { getConfig } from "../config";

export const AVATARS = ["bussola", "radio", "lanterna", "mochila", "fogueira", "mapa", "corda", "cruz"] as const;

const updateSchema = z.strictObject({
  displayName: z
    .string()
    .max(40)
    .transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, "").trim())
    .pipe(z.string().min(2))
    .optional(),
  avatar: z.enum(AVATARS).optional(),
  bio: z
    .string()
    .max(300)
    .transform((s) => s.replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, "").trim())
    .optional(),
});

export async function getProfile(user: SessionUser) {
  const db = getDb();
  const p = (await db.get<{ display_name: string; avatar: string; bio: string; created_at: string }>(
    "SELECT display_name, avatar, bio, created_at FROM profiles WHERE user_id = ?",
    user.id,
  ))!;
  const stats = await db.get<{ games: number; wins: number | null; best: number | null }>(
    `SELECT COUNT(*) AS games, SUM(CASE WHEN ending IN ('resgate_radio','resgate_sinalizador','resgate_fogueira') THEN 1 ELSE 0 END) AS wins, MAX(score) AS best
       FROM ranking_scores WHERE user_id = ?`,
    user.id,
  );
  const prem = await premiumInfo(user.id);
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: p.display_name,
    avatar: p.avatar,
    bio: p.bio,
    memberSince: p.created_at,
    premium: user.premium ? { source: prem?.source, slot: prem?.slot_number ?? null } : null,
    earlySlots: { used: await earlySlotsUsed(), total: getConfig().PREMIUM_EARLY_SLOTS },
    stats: { games: Number(stats?.games ?? 0), wins: Number(stats?.wins ?? 0), bestScore: Number(stats?.best ?? 0) },
  };
}

export async function updateProfile(user: SessionUser, input: unknown) {
  const data = updateSchema.parse(input);
  const db = getDb();
  if (data.displayName !== undefined) await db.run("UPDATE profiles SET display_name = ?, updated_at = ? WHERE user_id = ?", data.displayName, nowIso(), user.id);
  if (data.avatar !== undefined) await db.run("UPDATE profiles SET avatar = ?, updated_at = ? WHERE user_id = ?", data.avatar, nowIso(), user.id);
  if (data.bio !== undefined) await db.run("UPDATE profiles SET bio = ?, updated_at = ? WHERE user_id = ?", data.bio, nowIso(), user.id);
  return getProfile(user);
}
