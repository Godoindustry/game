/**
 * Tempo real do cooperativo (Supabase Realtime, plano gratuito).
 *
 * Hoje o grupo descobre que a rodada resolvou por *polling* de 3 s. Com o Realtime o
 * servidor avisa na hora e o cliente busca o estado — o polling continua existindo como
 * rede de segurança, então a latência média cai de ~1,5 s para ~0,1 s sem nunca deixar
 * o jogador sem sincronismo se o serviço cair.
 *
 * Segurança: o canal nunca carrega conteúdo do jogo. Publicamos só um contador de versão,
 * e o estado real continua vindo de `GET /api/campaigns/:id/state`, que exige sessão e
 * participação. O JWT é assinado no servidor (HS256 com SUPABASE_JWT_SECRET), então a
 * chave pública `anon` sozinha não abre canal de campanha nenhuma — a RLS em
 * `realtime.messages` (gerada em `schemaForPostgres`) exige membro da campanha.
 *
 * Sem as variáveis de ambiente, `realtimeConfigured()` é falso e nada muda.
 */
import { createHmac } from "node:crypto";
import { getConfig } from "../config";
import type { SessionUser } from "./auth";
import { requireMember } from "./campaigns";

/** O cliente renova o token antes disso; bem acima do relógio do navegador. */
const TOKEN_TTL_SEC = 300;
const BROADCAST_TIMEOUT_MS = 2_000;

/** Só o suficiente para o cliente saber que precisa recarregar. */
export interface StateChanged {
  v: number;
}

export function campaignTopic(campaignId: string): string {
  return `campaign:${campaignId}`;
}

export function realtimeConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.SUPABASE_URL && c.SUPABASE_ANON_KEY && c.SUPABASE_JWT_SECRET);
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

function sign(payload: Record<string, unknown>): string {
  const secret = getConfig().SUPABASE_JWT_SECRET!;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** Token curto com o `sub` = id do usuário do jogo, que é o que a policy de RLS compara. */
function mintToken(userId: string, campaignId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    sub: userId,
    role: "authenticated",
    campaign_id: campaignId,
    iat: now,
    exp: now + TOKEN_TTL_SEC,
  });
}

export interface RealtimeAccess {
  url: string;
  apikey: string;
  token: string;
  topic: string;
}

/** Só para membro da campanha: o próprio `requireMember` é a autorização. */
export async function accessFor(user: SessionUser, campaignId: string): Promise<RealtimeAccess | { realtime: false }> {
  if (!realtimeConfigured()) return { realtime: false };
  await requireMember(user, campaignId);
  const c = getConfig();
  return {
    url: c.SUPABASE_URL!.replace(/\/+$/, ""),
    apikey: c.SUPABASE_ANON_KEY!,
    token: mintToken(user.id, campaignId),
    topic: campaignTopic(campaignId),
  };
}

/**
 * Avisa a sala que a rodada andou. Nunca lança e nunca atrasa a resposta ao jogador:
 * quem resolve a rodada não pode ficar esperando o Realtime, e uma falha aqui só
 * custa alguns segundos de polling.
 */
export async function broadcastStateChanged(campaignId: string, version: number): Promise<void> {
  if (!realtimeConfigured()) return;
  const c = getConfig();
  try {
    await fetch(`${c.SUPABASE_URL!.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: c.SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${serverToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: [{ topic: campaignTopic(campaignId), event: "state", payload: { v: version }, private: true }] }),
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    /* o polling cobre; nunca vale falhar uma ação por causa do push */
  }
}

/**
 * Token de servidor para o broadcast. É o mesmo segredo do projeto, o que é o jeito
 * suportado de falar com o Realtime sem distribuir a chave `service_role`: a chave em
 * si nunca sai do `.env.local` e nunca chega ao navegador.
 */
function serverToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: "servidor", role: "service_role", iat: now, exp: now + 30 });
}
