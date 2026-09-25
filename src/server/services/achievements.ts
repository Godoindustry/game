import { getDb, nowIso } from "../db/database";

/** Desbloqueia (idempotente). Retorna true se foi desbloqueada agora. */
export async function unlockAchievement(userId: string, achievementId: string, campaignId: string | null): Promise<boolean> {
  const r = await getDb().run(
    "INSERT INTO user_achievements(user_id,achievement_id,campaign_id,unlocked_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
    userId, achievementId, campaignId, nowIso(),
  );
  return r.changes > 0;
}

export async function listAchievements(userId: string) {
  const rows = await getDb().all<{ id: string; name: string; description: string; icon: string; points: number; hidden: number; unlocked_at: string | null }>(
    `SELECT a.id, a.name, a.description, a.icon, a.points, a.hidden, ua.unlocked_at
       FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
      ORDER BY (ua.unlocked_at IS NULL), a.points DESC`,
    userId,
  );
  return rows.map((a) => ({
    id: a.id,
    name: a.hidden && !a.unlocked_at ? "???" : a.name,
    description: a.hidden && !a.unlocked_at ? "Conquista secreta." : a.description,
    icon: a.icon,
    points: a.points,
    unlockedAt: a.unlocked_at,
  }));
}

export async function ranking(limit = 50) {
  const rows = await getDb().all<{ user_id: string; display_name: string; character_name: string; score: number; survived_minutes: number; clues_found: number; ending: string; created_at: string }>(
    `SELECT r.user_id, p.display_name, r.character_name, r.score, r.survived_minutes, r.clues_found, r.ending, r.created_at
       FROM ranking_scores r JOIN profiles p ON p.user_id = r.user_id
      ORDER BY r.score DESC, r.created_at ASC LIMIT ?`,
    limit,
  );
  return rows.map((r, i) => ({
    position: i + 1,
    displayName: r.display_name,
    characterName: r.character_name,
    score: r.score,
    survivedMinutes: r.survived_minutes,
    cluesFound: r.clues_found,
    ending: r.ending,
    date: r.created_at,
  }));
}
