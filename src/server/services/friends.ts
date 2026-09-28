/**
 * Amigos e presença.
 *
 * Amizade: cada usuário tem um código público (ex.: "K7QM-4TZP") — adicionar por código evita
 * expor ou enumerar e-mails. Pedido pendente → o destinatário aceita ou recusa. Se os dois se
 * pedirem ao mesmo tempo, o segundo pedido aceita o primeiro.
 *
 * Presença: o cliente manda um heartbeat a cada ~30 s dizendo onde está (menu, lobby ou partida).
 * Sem heartbeat por ONLINE_WINDOW_MS o jogador aparece offline — não depende do "sair" chegar.
 */
import { z } from "zod";
import { randomInt } from "node:crypto";
import { getDb, nowIso } from "../db/database";
import type { SessionUser } from "./auth";
import { newId } from "./ids";
import { badRequest, conflict, forbidden, notFound } from "./errors";

export const ONLINE_WINDOW_MS = 75_000;
export const MAX_FRIENDS = 100;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O, 1/I

export type Activity = "menu" | "lobby" | "playing" | "offline";

function randomCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Aceita "k7qm4tzp", "K7QM-4TZP", " k7qm 4tzp " etc. */
function normalizeCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== 8 || [...s].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export async function friendCode(userId: string): Promise<string> {
  const db = getDb();
  const existing = await db.get<{ code: string }>("SELECT code FROM friend_codes WHERE user_id = ?", userId);
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.run("INSERT INTO friend_codes(user_id, code, created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING", userId, randomCode(), nowIso());
      break;
    } catch {
      /* colisão de código (UNIQUE) — tenta outro */
    }
  }
  return (await db.get<{ code: string }>("SELECT code FROM friend_codes WHERE user_id = ?", userId))!.code;
}

// ---------- Presença ----------
const heartbeatSchema = z.strictObject({
  activity: z.enum(["menu", "lobby", "playing", "offline"]),
  campaignId: z.string().max(100).nullish(),
});

export async function heartbeat(user: SessionUser, input: unknown): Promise<{ ok: true }> {
  const data = heartbeatSchema.parse(input);
  const db = getDb();
  let campaignId: string | null = null;
  // Só registra a campanha se o usuário for membro dela (não dá para "aparecer" na partida dos outros).
  if (data.campaignId && data.activity !== "menu" && data.activity !== "offline") {
    const m = await db.get("SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ?", data.campaignId, user.id);
    if (m) campaignId = data.campaignId;
  }
  const activity = data.activity !== "menu" && data.activity !== "offline" && !campaignId ? "menu" : data.activity;
  await db.run(
    `INSERT INTO user_presence(user_id, activity, campaign_id, last_seen_at) VALUES(?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET activity = excluded.activity, campaign_id = excluded.campaign_id, last_seen_at = excluded.last_seen_at`,
    user.id, activity, campaignId, nowIso(),
  );
  return { ok: true };
}

export async function setOffline(userId: string): Promise<void> {
  await getDb().run("UPDATE user_presence SET activity = 'offline', campaign_id = NULL WHERE user_id = ?", userId);
}

// ---------- Listagem ----------
interface FriendRow {
  friendship_id: string;
  status: "pending" | "accepted";
  requester_id: string;
  other_id: string;
  created_at: string;
  display_name: string;
  avatar: string;
  activity: Activity | null;
  last_seen_at: string | null;
  campaign_name: string | null;
  campaign_mode: "solo" | "coop" | null;
  campaign_status: "lobby" | "active" | "finished" | null;
}

export interface FriendView {
  userId: string;
  displayName: string;
  avatar: string;
  online: boolean;
  /** Onde está agora: menu principal, lobby ou partida. `null` se offline. */
  activity: Exclude<Activity, "offline"> | null;
  campaign: { name: string; mode: "solo" | "coop" } | null;
  lastSeenAt: string | null;
  since: string;
}

function toView(r: FriendRow, now: number): FriendView {
  const online = r.activity !== null && r.activity !== "offline" && r.last_seen_at !== null && now - Date.parse(r.last_seen_at) <= ONLINE_WINDOW_MS;
  let activity: FriendView["activity"] = online ? (r.activity as FriendView["activity"]) : null;
  // Campanha encerrada ou apagada: quem ainda está na tela está, na prática, fora de partida.
  if (activity === "playing" && r.campaign_status !== "active") activity = r.campaign_status === "lobby" ? "lobby" : "menu";
  if (activity === "lobby" && !r.campaign_status) activity = "menu";
  return {
    userId: r.other_id,
    displayName: r.display_name,
    avatar: r.avatar,
    online,
    activity,
    campaign: activity === "lobby" || activity === "playing" ? { name: r.campaign_name!, mode: r.campaign_mode! } : null,
    lastSeenAt: r.last_seen_at,
    since: r.created_at,
  };
}

const ORDER: Record<string, number> = { playing: 0, lobby: 1, menu: 2 };

export async function listFriends(user: SessionUser) {
  const rows = await getDb().all<FriendRow>(
    `SELECT f.id AS friendship_id, f.status, f.requester_id, f.created_at,
            o.user_id AS other_id, o.display_name, o.avatar,
            pr.activity, pr.last_seen_at,
            c.name AS campaign_name, c.mode AS campaign_mode, c.status AS campaign_status
       FROM friendships f
       JOIN profiles o ON o.user_id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       JOIN users u ON u.id = o.user_id AND u.status = 'active'
       LEFT JOIN user_presence pr ON pr.user_id = o.user_id
       LEFT JOIN campaigns c ON c.id = pr.campaign_id
      WHERE f.requester_id = ? OR f.addressee_id = ?`,
    user.id, user.id, user.id,
  );
  const now = Date.now();
  const friends: FriendView[] = [];
  const incoming: { id: string; userId: string; displayName: string; avatar: string; createdAt: string }[] = [];
  const outgoing: typeof incoming = [];
  for (const r of rows) {
    if (r.status === "accepted") friends.push(toView(r, now));
    else {
      const req = { id: r.friendship_id, userId: r.other_id, displayName: r.display_name, avatar: r.avatar, createdAt: r.created_at };
      (r.requester_id === user.id ? outgoing : incoming).push(req);
    }
  }
  friends.sort((a, b) =>
    Number(b.online) - Number(a.online) ||
    (ORDER[a.activity ?? ""] ?? 9) - (ORDER[b.activity ?? ""] ?? 9) ||
    (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "") ||
    a.displayName.localeCompare(b.displayName, "pt-BR"),
  );
  return { code: await friendCode(user.id), friends, incoming, outgoing, onlineCount: friends.filter((f) => f.online).length };
}

// ---------- Pedidos ----------
export async function sendRequest(user: SessionUser, input: unknown): Promise<{ status: "pending" | "accepted"; displayName: string }> {
  const { code: raw } = z.strictObject({ code: z.string().max(40) }).parse(input);
  const code = normalizeCode(raw);
  if (!code) throw badRequest("Código de amigo inválido. Ele tem 8 caracteres, como K7QM-4TZP.", "codigo_invalido");
  const db = getDb();
  const target = await db.get<{ user_id: string; display_name: string }>(
    `SELECT fc.user_id, p.display_name FROM friend_codes fc
       JOIN users u ON u.id = fc.user_id AND u.status = 'active'
       JOIN profiles p ON p.user_id = fc.user_id
      WHERE fc.code = ?`,
    code,
  );
  if (!target) throw notFound("Nenhum jogador com esse código.");
  if (target.user_id === user.id) throw badRequest("Esse é o seu próprio código.", "proprio_codigo");

  return db.tx(async () => {
    // Serializa pedidos do mesmo par (evita duas linhas cruzadas em pedidos simultâneos).
    await db.lock(`friend:${[user.id, target.user_id].sort().join(":")}`);
    const existing = await db.get<{ id: string; status: string; requester_id: string }>(
      `SELECT id, status, requester_id FROM friendships
        WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      user.id, target.user_id, target.user_id, user.id,
    );
    if (existing?.status === "accepted") throw conflict(`Você e ${target.display_name} já são amigos.`, "ja_amigos");
    if (existing && existing.requester_id === user.id) throw conflict("Pedido já enviado. Aguarde a resposta.", "pedido_existente");
    if (existing) {
      // A outra pessoa já tinha pedido: aceitar direto.
      await db.run("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ?", nowIso(), existing.id);
      return { status: "accepted" as const, displayName: target.display_name };
    }
    const count = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM friendships WHERE requester_id = ? OR addressee_id = ?",
      user.id, user.id,
    );
    if (Number(count?.n ?? 0) >= MAX_FRIENDS) throw conflict(`Limite de ${MAX_FRIENDS} amigos e pedidos atingido.`, "limite_amigos");
    await db.run(
      "INSERT INTO friendships(id, requester_id, addressee_id, status, created_at) VALUES(?,?,?,'pending',?)",
      newId(), user.id, target.user_id, nowIso(),
    );
    return { status: "pending" as const, displayName: target.display_name };
  });
}

export async function respondRequest(user: SessionUser, requestId: string, input: unknown): Promise<{ ok: true }> {
  const { accept } = z.strictObject({ accept: z.boolean() }).parse(input);
  const db = getDb();
  const req = await db.get<{ addressee_id: string; status: string }>("SELECT addressee_id, status FROM friendships WHERE id = ?", requestId);
  if (!req || req.status !== "pending") throw notFound("Pedido não encontrado.");
  if (req.addressee_id !== user.id) throw forbidden("Esse pedido não é para você.");
  if (accept) await db.run("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ? AND status = 'pending'", nowIso(), requestId);
  else await db.run("DELETE FROM friendships WHERE id = ? AND status = 'pending'", requestId);
  return { ok: true };
}

/** Desfaz amizade, cancela pedido enviado ou recusa pedido recebido — qualquer vínculo com o outro usuário. */
export async function removeFriend(user: SessionUser, otherUserId: string): Promise<{ ok: true }> {
  const r = await getDb().run(
    "DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)",
    user.id, otherUserId, otherUserId, user.id,
  );
  if (r.changes === 0) throw notFound("Amigo não encontrado.");
  return { ok: true };
}
