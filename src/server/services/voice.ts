import { z } from "zod";
import type { SessionUser } from "./auth";
import { requireMember } from "./campaigns";

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

type IncomingSignal = z.infer<typeof signalSchema> & { from: string };
type VoiceMember = { campaignId: string; userId: string; displayName: string; lastSeen: number };
type VoiceState = { members: Map<string, VoiceMember>; queues: Map<string, IncomingSignal[]> };
type VoiceGlobal = typeof globalThis & { __lsVoice?: VoiceState };

const MEMBER_TTL_MS = 15_000;

function state(): VoiceState {
  const g = globalThis as VoiceGlobal;
  g.__lsVoice ??= { members: new Map(), queues: new Map() };
  return g.__lsVoice;
}

function key(campaignId: string, userId: string) {
  return `${campaignId}:${userId}`;
}

function prune(room: VoiceState, now: number) {
  for (const [k, member] of room.members) {
    if (now - member.lastSeen > MEMBER_TTL_MS) {
      room.members.delete(k);
      room.queues.delete(k);
    }
  }
}

/**
 * Sinalização efêmera para uma malha WebRTC. O servidor nunca recebe áudio:
 * ele apenas encaminha ofertas/ICE entre membros autenticados da campanha.
 */
export async function exchange(user: SessionUser, campaignId: string, input: unknown) {
  await requireMember(user, campaignId);
  const data = exchangeSchema.parse(input);
  const room = state();
  const now = Date.now();
  prune(room, now);
  const selfKey = key(campaignId, user.id);

  if (!data.active) {
    room.members.delete(selfKey);
    room.queues.delete(selfKey);
    return { selfId: user.id, peers: [], signals: [] };
  }

  room.members.set(selfKey, { campaignId, userId: user.id, displayName: user.displayName, lastSeen: now });

  for (const signal of data.signals) {
    if (signal.to === user.id) continue;
    const targetKey = key(campaignId, signal.to);
    const target = room.members.get(targetKey);
    if (!target || target.campaignId !== campaignId) continue;
    const queue = room.queues.get(targetKey) ?? [];
    if (queue.length < 64) queue.push({ ...signal, from: user.id });
    room.queues.set(targetKey, queue);
  }

  const signals = room.queues.get(selfKey) ?? [];
  room.queues.set(selfKey, []);
  const peers = [...room.members.values()]
    .filter((member) => member.campaignId === campaignId && member.userId !== user.id)
    .map((member) => ({ id: member.userId, name: member.displayName }));

  return { selfId: user.id, peers, signals };
}

export function resetVoiceForTests() {
  const g = globalThis as VoiceGlobal;
  g.__lsVoice = undefined;
}
