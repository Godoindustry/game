/**
 * Voz humana gravada do jogo, com Gemini TTS opcional para falas dinâmicas.
 *
 * A rota só sintetiza linhas que já existem no diário e que o jogador pode ver.
 * Texto, interpretação e voz são separados: a tela nunca mostra as marcações sonoras,
 * enquanto o Gemini recebe a transcrição literal com direção de atuação em metadata.
 */
import { getDb, nowIso } from "../db/database";
import { getConfig } from "../config";
import { newId, sha256 } from "./ids";
import { notFound } from "./errors";
import type { SessionUser } from "./auth";
import { requireMember } from "./campaigns";
import { stripVoiceTags, toVoiceText } from "@/shared/voiceTags";
import { normalizeSpeechPerformance, speechStyle, splitSpeech, type SpeechTone } from "@/shared/speech";
import { concatWav, geminiKeys, resolveVoiceProfile, synthesizeGeminiSpeech } from "./geminiTts";

const MAX_TEXT_CHARS = 2_000;

interface LogVoiceRow {
  text: string;
  kind: string;
  character_id: string | null;
  speaker_key: string | null;
  speech_tone: string | null;
  speech_voice: string | null;
  speech_say: string | null;
}

type RecordedVoiceRow = Pick<LogVoiceRow, "text" | "kind" | "speaker_key">;

function recordedVariant(seed: string, choices: readonly string[]): string {
  const index = Number.parseInt(sha256(seed).slice(0, 8), 16) % choices.length;
  return choices[index];
}

/**
 * Vozes e interpretações humanas já gravadas no projeto. É o modo padrão quando
 * não existe chave externa e também a reserva para cota/indisponibilidade da IA.
 */
export function recordedVoiceAsset(row: RecordedVoiceRow): string {
  const source = row.text.toLocaleLowerCase("pt-BR");
  const speaker = row.speaker_key ?? "";

  if (row.kind === "death") {
    if (/fome|inanição/.test(source)) return "/audio/voz-da-morte/death-fome.mp3";
    if (/frio|hipotermia/.test(source)) return "/audio/voz-da-morte/death-hipotermia.mp3";
    if (/sangr|ferimento|lacera|fratura/.test(source)) return "/audio/voz-da-morte/death-ferimento.mp3";
    return "/audio/voz-da-morte/death-1.mp3";
  }
  if (row.kind === "ending") {
    return /rádio|radio|frequência|transmit|sinal/.test(source)
      ? "/audio/narrador/victory-radio.mp3"
      : "/audio/sistema/victory-1.mp3";
  }

  if (speaker === "npc:iara" || /iara|23h40|sete.+quatro.+zero/.test(source)) {
    return recordedVariant(source, [
      "/audio/iara/sussurro-chamado.mp3",
      "/audio/iara/sussurro-numeros.mp3",
      "/audio/iara/suspiro.mp3",
    ]);
  }
  if (speaker === "creature:mae") return "/audio/mae-das-asas/grito-aparicao.mp3";
  if (speaker === "creature:ambar") return "/audio/lobo-de-ambar/rosnado.mp3";
  if (speaker.startsWith("creature:")) return "/audio/almas/sussurro-arrepiante.mp3";
  if (row.kind === "npc" || speaker.startsWith("npc:")) {
    return recordedVariant(`${speaker}|${source}`, [
      "/audio/desconhecido/npc-desconhecido-1.mp3",
      "/audio/desconhecido/npc-desconhecido-2.mp3",
    ]);
  }

  if (/rádio|radio|frequência|transmiss|chiado|sinal/.test(source)) return "/audio/narrador/event-radio.mp3";
  if (/fogueira|chama|fogo|crepita/.test(source)) return "/audio/narrador/event-fogueira.mp3";
  if (/abrigo|cabana|dorm|descans/.test(source)) return "/audio/narrador/event-abrigo.mp3";
  if (/rastro|pegada|lama|carcaça|passos/.test(source)) return "/audio/narrador/event-rastros.mp3";
  if (/ferimento|atadura|sangr|curativo/.test(source)) return "/audio/narrador/action-tratando.mp3";
  if (/colet|vasculh|procur|examinar/.test(source)) return "/audio/narrador/action-coletando.mp3";
  return recordedVariant(source, [
    "/audio/narrador/event-noite.mp3",
    "/audio/narrador/intro-quote-2.mp3",
    "/audio/narrador/intro-quote-4.mp3",
  ]);
}

function recordedVoiceResponse(row: RecordedVoiceRow): Response {
  const asset = recordedVoiceAsset(row);
  return new Response(null, {
    status: 307,
    headers: {
      Location: asset,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Voice-Source": "recorded",
    },
  });
}

interface CachedAudio {
  audio: Buffer;
  model: string;
}

type TtsGlobal = typeof globalThis & { __valeTtsInflight?: Map<string, Promise<CachedAudio>> };

function inflight(): Map<string, Promise<CachedAudio>> {
  const global = globalThis as TtsGlobal;
  global.__valeTtsInflight ??= new Map();
  return global.__valeTtsInflight;
}

function startOfDay(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

async function logTts(
  userId: string,
  campaignId: string,
  cacheKey: string,
  chars: number,
  status: string,
  model: string | null,
  extra: { latency?: number; error?: string; fallback?: boolean } = {},
) {
  await getDb().run(
    `INSERT INTO ai_requests(id,user_id,campaign_id,provider,model,purpose,cache_key,prompt_chars,max_tokens,status,latency_ms,cost_usd,error,used_fallback,created_at)
     VALUES(?,?,?,'gemini',?,'tts',?,?,0,?,?,0,?,?,?)`,
    newId(), userId, campaignId, model, cacheKey, chars, status, extra.latency ?? null,
    extra.error?.slice(0, 300) ?? null, extra.fallback ? 1 : 0, nowIso(),
  );
}

/** Texto literal para voz: sem marcadores visuais; tags legadas viram tags Gemini. */
export function narrationText(raw: string): string {
  return toVoiceText(raw)
    .replace(/[【】]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}☀-➿️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function inferredTone(kind: string, text: string): SpeechTone {
  const source = text.toLocaleLowerCase("pt-BR");
  if (kind === "death" || kind === "ending") return "sad";
  if (/<whispers>|\bsussurr/.test(source)) return "whispering";
  if (/<sigh>|\bsuspir/.test(source)) return "sighing";
  if (/corr|agora|rápido|depressa|socorro|fug/.test(source)) return "hurried";
  if (/medo|escuro|ameaça|perigo|sangue|grito/.test(source)) return "worried";
  if (kind === "npc") return "hesitant";
  return "neutral";
}

function parseCached(content: string): CachedAudio | null {
  try {
    const parsed = JSON.parse(content) as { audio?: unknown; mimeType?: unknown; model?: unknown };
    if (typeof parsed.audio !== "string" || parsed.mimeType !== "audio/wav") return null;
    return { audio: Buffer.from(parsed.audio, "base64"), model: typeof parsed.model === "string" ? parsed.model : "gemini-cache" };
  } catch {
    return null;
  }
}

async function cachedAudio(cacheKey: string): Promise<CachedAudio | null> {
  const hit = await getDb().get<{ content: string }>(
    "SELECT content FROM ai_responses WHERE cache_key = ? AND valid = 1 AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    cacheKey,
    nowIso(),
  );
  return hit ? parseCached(hit.content) : null;
}

async function generateChunk(
  user: SessionUser,
  campaignId: string,
  cacheKey: string,
  transcript: string,
  style: string,
  profile: ReturnType<typeof resolveVoiceProfile>,
  scene: string,
  context: string,
): Promise<CachedAudio> {
  const config = getConfig();
  const started = Date.now();
  try {
    const generated = await synthesizeGeminiSpeech(config, { transcript, style, profile, scene, context });
    const value = { audio: generated.audio, model: generated.model };
    await logTts(user.id, campaignId, cacheKey, transcript.length, "ok", generated.model, { latency: Date.now() - started });
    await getDb().run(
      "INSERT INTO ai_responses(id,request_id,cache_key,content,valid,expires_at,created_at) VALUES(?,NULL,?,?,1,?,?)",
      newId(),
      cacheKey,
      JSON.stringify({ audio: generated.audio.toString("base64"), mimeType: generated.mimeType, model: generated.model }),
      new Date(Date.now() + config.TTS_CACHE_DAYS * 86_400_000).toISOString(),
      nowIso(),
    );
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logTts(user.id, campaignId, cacheKey, transcript.length, "error", null, {
      latency: Date.now() - started,
      error: message,
      fallback: true,
    });
    throw error;
  }
}

async function chunkAudio(
  user: SessionUser,
  campaignId: string,
  cacheKey: string,
  transcript: string,
  style: string,
  profile: ReturnType<typeof resolveVoiceProfile>,
  scene: string,
  context: string,
): Promise<{ value: CachedAudio; source: "cache" | "generated" | "inflight" }> {
  const cached = await cachedAudio(cacheKey);
  if (cached) {
    await logTts(user.id, campaignId, cacheKey, transcript.length, "cache_hit", cached.model);
    return { value: cached, source: "cache" };
  }

  const pending = inflight().get(cacheKey);
  if (pending) return { value: await pending, source: "inflight" };
  const promise = generateChunk(user, campaignId, cacheKey, transcript, style, profile, scene, context);
  inflight().set(cacheKey, promise);
  try {
    return { value: await promise, source: "generated" };
  } finally {
    if (inflight().get(cacheKey) === promise) inflight().delete(cacheKey);
  }
}

function audioResponse(audio: Buffer, meta: { cacheKey: string; source: string; speaker: string; voice: string; tone: string; model: string }): Response {
  return new Response(new Uint8Array(audio), {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(audio.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: `"${meta.cacheKey}"`,
      "X-Voice-Cache-Key": meta.cacheKey,
      "X-Voice-Source": meta.source,
      "X-Voice-Speaker": meta.speaker,
      "X-Voice-Name": meta.voice,
      "X-Voice-Tone": meta.tone,
      "X-Voice-Model": meta.model,
    },
  });
}

export async function logVoice(user: SessionUser, campaignId: string, logId: string): Promise<Response> {
  const config = getConfig();
  await requireMember(user, campaignId);
  const db = getDb();
  const id = Number(logId);
  if (!Number.isInteger(id) || id <= 0) throw notFound("Mensagem não encontrada.");
  const row = await db.get<LogVoiceRow>(
    `SELECT text, kind, character_id, speaker_key, speech_tone, speech_voice, speech_say
       FROM campaign_log WHERE id = ? AND campaign_id = ?`,
    id,
    campaignId,
  );
  if (!row) throw notFound("Mensagem não encontrada.");
  // character_id é o destinatário privado, não necessariamente quem fala.
  if (row.character_id) {
    const mine = await db.get("SELECT 1 FROM characters WHERE id = ? AND user_id = ?", row.character_id, user.id);
    if (!mine) throw notFound("Mensagem não encontrada.");
  }
  // Sem chave, usa imediatamente as interpretações humanas que já acompanham o jogo.
  if (!geminiKeys(config).length) return recordedVoiceResponse(row);

  const visibleText = stripVoiceTags(row.text).replace(/[【】]/g, "").trim();
  if (!visibleText) throw notFound("Nada para narrar.");
  const tone = inferredTone(row.kind, row.speech_say ?? row.text);
  const performance = normalizeSpeechPerformance(visibleText, {
    tone: (row.speech_tone as SpeechTone | null) ?? tone,
    voice: row.speech_voice ?? undefined,
    say: narrationText(row.speech_say ?? row.text),
  }, tone);
  const profile = resolveVoiceProfile(row.speaker_key, row.kind, visibleText);
  const style = speechStyle(performance, config.TTS_SPEECH_LEVEL);
  const chunks = splitSpeech(performance.say);
  if (!chunks.length) throw notFound("Nada para narrar.");

  const previous = await db.get<{ text: string }>(
    `SELECT text FROM campaign_log
      WHERE campaign_id = ? AND id < ? AND (character_id IS NULL OR character_id = ?)
      ORDER BY id DESC LIMIT 1`,
    campaignId,
    id,
    row.character_id ?? "",
  );
  const context = previous ? stripVoiceTags(previous.text).slice(0, 260) : "";
  const scene = "A rain-soaked night in isolated Vale Silente, Brazil, during an intimate and tense live conversation.";
  const chunkKeys = chunks.map((chunk) => sha256(`pt-BR|${profile.key}|${profile.voice}|${style}|${chunk}`));
  const overallKey = sha256(`pt-BR|${profile.key}|${profile.voice}|${style}|${performance.say}`);

  const existing = await Promise.all(chunkKeys.map(cachedAudio));
  const missing = existing.filter((item) => !item).length;
  if (missing) {
    const since = startOfDay();
    const used = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM ai_requests WHERE user_id = ? AND purpose = 'tts' AND status = 'ok' AND created_at >= ?",
      user.id,
      since,
    );
    if (Number(used?.n ?? 0) + missing > config.TTS_USER_DAILY_REQUESTS) {
      return recordedVoiceResponse(row);
    }
    const spent = await db.get<{ s: number }>(
      "SELECT COALESCE(SUM(prompt_chars),0) AS s FROM ai_requests WHERE purpose = 'tts' AND status = 'ok' AND created_at >= ?",
      since,
    );
    if (Number(spent?.s ?? 0) + chunks.reduce((sum, chunk) => sum + chunk.length, 0) > config.TTS_DAILY_CHAR_BUDGET) {
      return recordedVoiceResponse(row);
    }
  }

  const parts: Buffer[] = [];
  const sources: string[] = [];
  let model = existing.find(Boolean)?.model ?? "gemini-cache";
  try {
    for (let index = 0; index < chunks.length; index++) {
      const result = await chunkAudio(user, campaignId, chunkKeys[index], chunks[index], style, profile, scene, context);
      parts.push(result.value.audio);
      sources.push(result.source);
      model = result.value.model;
    }
  } catch {
    return recordedVoiceResponse(row);
  }
  const source = sources.every((item) => item === "cache") ? "cache" : sources.some((item) => item === "generated") ? "gemini" : "inflight";
  return audioResponse(concatWav(parts), {
    cacheKey: overallKey,
    source,
    speaker: profile.key,
    voice: profile.voice,
    tone: performance.tone,
    model,
  });
}

export function resetTtsForTests(): void {
  (globalThis as TtsGlobal).__valeTtsInflight = new Map();
}
