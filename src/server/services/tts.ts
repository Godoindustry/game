/**
 * Narrador de voz (ElevenLabs `eleven_v3`, que interpreta as tags [sighs], [laughs], [whispers]…).
 *
 * Segurança de custo: não existe "TTS de texto livre". Só narramos linhas que JÁ estão no
 * diário da campanha e que o jogador pode ver — então a conta não vira TTS grátis para ninguém.
 *
 * Escala: o áudio vai para o cache compartilhado (ai_responses, base64, mp3 de baixa taxa),
 * então cada linha é sintetizada UMA vez para todos os jogadores e instâncias serverless.
 * Cota diária por usuário + orçamento global de caracteres. Sem chave → 503 e o cliente usa
 * a voz do navegador.
 */
import { getDb, nowIso } from "../db/database";
import { getConfig } from "../config";
import { newId, sha256 } from "./ids";
import { AppError, notFound } from "./errors";
import type { SessionUser } from "./auth";
import { requireMember } from "./campaigns";
import { toVoiceText } from "@/shared/voiceTags";

export type VoiceRole = "narrador" | "npc" | "morte";

const ROLE_BY_KIND: Record<string, VoiceRole> = { npc: "npc", death: "morte", ending: "morte" };
const MAX_CHARS = 600;

function voiceId(role: VoiceRole): string {
  const c = getConfig();
  return role === "npc" ? c.ELEVENLABS_VOICE_NPC : role === "morte" ? c.ELEVENLABS_VOICE_MORTE : c.ELEVENLABS_VOICE_NARRADOR;
}

function startOfDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function logTts(userId: string, campaignId: string, cacheKey: string, chars: number, status: string, extra: { latency?: number; error?: string } = {}) {
  await getDb().run(
    `INSERT INTO ai_requests(id,user_id,campaign_id,provider,model,purpose,cache_key,prompt_chars,max_tokens,status,latency_ms,cost_usd,error,used_fallback,created_at)
     VALUES(?,?,?,'elevenlabs',?,'tts',?,?,0,?,?,0,?,0,?)`,
    newId(), userId, campaignId, getConfig().ELEVENLABS_MODEL, cacheKey, chars, status, extra.latency ?? null, extra.error?.slice(0, 300) ?? null, nowIso(),
  );
}

/** Texto a narrar: sem os marcadores visuais do diário (【】, emojis de sistema), com as tags de voz. */
export function narrationText(raw: string): string {
  return toVoiceText(raw)
    .replace(/[【】]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}☀-➿️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

function audioResponse(buf: Buffer, source: string): Response {
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.length),
      // A mesma linha não muda: o navegador guarda por um dia.
      "Cache-Control": "private, max-age=86400",
      "X-Voice-Source": source,
    },
  });
}

export async function logVoice(user: SessionUser, campaignId: string, logId: string): Promise<Response> {
  const c = getConfig();
  if (!c.ELEVENLABS_API_KEY) throw new AppError(503, "Narrador de voz não configurado.", "tts_off");
  await requireMember(user, campaignId);
  const db = getDb();
  const id = Number(logId);
  if (!Number.isInteger(id) || id <= 0) throw notFound("Mensagem não encontrada.");
  const row = await db.get<{ text: string; kind: string; character_id: string | null }>(
    "SELECT text, kind, character_id FROM campaign_log WHERE id = ? AND campaign_id = ?",
    id, campaignId,
  );
  // Mensagem privada de outro personagem: não existe para este jogador.
  if (row?.character_id) {
    const mine = await db.get("SELECT 1 FROM characters WHERE id = ? AND user_id = ?", row.character_id, user.id);
    if (!mine) throw notFound("Mensagem não encontrada.");
  }
  if (!row) throw notFound("Mensagem não encontrada.");
  const text = narrationText(row.text);
  if (!text) throw notFound("Nada para narrar.");
  const role = ROLE_BY_KIND[row.kind] ?? "narrador";
  const voice = voiceId(role);
  const cacheKey = sha256(`tts|${c.ELEVENLABS_MODEL}|${voice}|${text}`);

  const hit = await db.get<{ content: string }>(
    "SELECT content FROM ai_responses WHERE cache_key = ? AND valid = 1 AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    cacheKey, nowIso(),
  );
  if (hit) {
    await logTts(user.id, campaignId, cacheKey, text.length, "cache_hit");
    return audioResponse(Buffer.from(hit.content, "base64"), "cache");
  }

  const since = startOfDay();
  const used = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM ai_requests WHERE user_id = ? AND purpose = 'tts' AND status = 'ok' AND created_at >= ?",
    user.id, since,
  );
  if (Number(used?.n ?? 0) >= c.TTS_USER_DAILY_REQUESTS) {
    await logTts(user.id, campaignId, cacheKey, text.length, "quota_exceeded");
    throw new AppError(429, "Cota diária do narrador atingida. A voz do navegador assume.", "tts_cota");
  }
  const spent = await db.get<{ s: number }>(
    "SELECT COALESCE(SUM(prompt_chars),0) AS s FROM ai_requests WHERE purpose = 'tts' AND status = 'ok' AND created_at >= ?",
    since,
  );
  if (Number(spent?.s ?? 0) + text.length > c.TTS_DAILY_CHAR_BUDGET) {
    await logTts(user.id, campaignId, cacheKey, text.length, "budget_exceeded");
    throw new AppError(429, "Orçamento diário do narrador esgotado. A voz do navegador assume.", "tts_orcamento");
  }

  const started = Date.now();
  let buf: Buffer;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_22050_32`, {
      method: "POST",
      headers: { "xi-api-key": c.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: c.ELEVENLABS_MODEL,
        language_code: "pt",
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      }),
      signal: AbortSignal.timeout(c.TTS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    await logTts(user.id, campaignId, cacheKey, text.length, "error", { latency: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
    throw new AppError(502, "O narrador não respondeu. A voz do navegador assume.", "tts_falha");
  }
  await logTts(user.id, campaignId, cacheKey, text.length, "ok", { latency: Date.now() - started });
  await db.run(
    "INSERT INTO ai_responses(id,request_id,cache_key,content,valid,expires_at,created_at) VALUES(?,NULL,?,?,1,?,?)",
    newId(), cacheKey, buf.toString("base64"), new Date(Date.now() + c.TTS_CACHE_DAYS * 86400_000).toISOString(), nowIso(),
  );
  return audioResponse(buf, "elevenlabs");
}
