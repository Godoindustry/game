/**
 * Sinalização efêmera para uma malha WebRTC. O servidor nunca recebe áudio:
 * ele apenas encaminha ofertas/ICE entre membros autenticados da campanha.
 *
 * O estado fica no KV (Upstash) e não na memória do processo. Antes ele vivia num
 * `Map` local, o que quebrava assim que a Vercel servia dois jogadores em instâncias
 * diferentes: cada uma via SDP para o vácuo. Com o KV as instâncias compartilham a
 * mesma sala; sem o KV, o `kv.ts` cai para memória e o comportamento local é o de antes.
 */
import { z } from "zod";
import type { SessionUser } from "./auth";
import { requireMember } from "./campaigns";
import { kvDel, kvGet, kvListAppend, kvListTake, kvSet } from "../kv";

const descriptionSchema = z.strictObject({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().max(120_000),
});

const candidateSchema = z.strictObject({
  candidate: z.string().max(8_000),
  sdpMid: z.string().max(200).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(1_000).nullable().optional(),
  usernameFragment: z.string().max(500).nullable().optional(),
});

const signalSchema = z.strictObject({
  to: z.string().min(1).max(100),
  kind: z.enum(["description", "candidate"]),
  description: descriptionSchema.optional(),
  candidate: candidateSchema.optional(),
});

const exchangeSchema = z.strictObject({
  active: z.boolean(),
  signals: z.array(signalSchema).max(16).default([]),
});

/** Uma vez recebida, a oferta/candidata é entregue uma única vez. */
type IncomingSignal = z.infer<typeof signalSchema> & { from: string };
type VoiceMember = { userId: string; displayName: string; lastSeen: number };
type Roster = { members: VoiceMember[] };

/** A sala morre sozinha se ninguém fizer `exchange` por este tempo. */
const ROOM_TTL_SEC = 30;
/** Mais generoso que a sala: um sinal não pode sumir porque o alvo demorou a responder. */
const QUEUE_TTL_SEC = 20;
const MAX_QUEUE = 64;

const roomKey = (campaignId: string) => `ls:voice:room:${campaignId}`;
const queueKey = (campaignId: string, userId: string) => `ls:voice:q:${campaignId}:${userId}`;

function alive(m: VoiceMember, now: number): boolean {
  return now - m.lastSeen < ROOM_TTL_SEC * 1000;
}

/**
 * Sinalização efêmera para uma malha WebRTC entre até 4 membros da campanha.
 * O estado é compartilhado entre instâncias; o áudio nunca passa pelo servidor.
 */
export async function exchange(user: SessionUser, campaignId: string, input: unknown) {
  await requireMember(user, campaignId);
  const data = exchangeSchema.parse(input);
  const now = Date.now();

  const roster = (await kvGet<Roster>(roomKey(campaignId))) ?? { members: [] };
  // Descarta quem sumiu — não depende de um "saiu" chegar.
  const members = roster.members.filter((m) => alive(m, now));

  if (!data.active) {
    await leave(campaignId, user.id, members);
    return { selfId: user.id, peers: [], signals: [] };
  }

  const self: VoiceMember = { userId: user.id, displayName: user.displayName, lastSeen: now };
  const present = members.filter((m) => m.userId !== user.id);
  await kvSet(roomKey(campaignId), { members: [...present, self] } satisfies Roster, ROOM_TTL_SEC);

  // Encaminha só para quem está na sala agora: nunca para um id arbitrário do corpo.
  // `kvListAppend` e não ler-e-reescrever: dois membros negotiando ao mesmo tempo não podem
  // se sobrescrever, senão uma oferta chega pela metade.
  for (const signal of data.signals) {
    if (signal.to === user.id) continue;
    if (!present.some((m) => m.userId === signal.to)) continue;
    await kvListAppend(queueKey(campaignId, signal.to), [{ ...signal, from: user.id } satisfies IncomingSignal], QUEUE_TTL_SEC, MAX_QUEUE);
  }

  const signals = await kvListTake<IncomingSignal>(queueKey(campaignId, user.id), MAX_QUEUE);
  const peers = present.map((m) => ({ id: m.userId, name: m.displayName }));
  return { selfId: user.id, peers, signals };
}

async function leave(campaignId: string, userId: string, members: VoiceMember[]): Promise<void> {
  await kvDel(queueKey(campaignId, userId));
  const rest = members.filter((m) => m.userId !== userId);
  if (rest.length) await kvSet(roomKey(campaignId), { members: rest } satisfies Roster, ROOM_TTL_SEC);
  else await kvDel(roomKey(campaignId));
}
