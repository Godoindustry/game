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
import { narrationForLog } from "./narrationPack";
import { libraryHas, libraryPath, libraryPut, libraryUrl } from "./audioLibrary";
import { wavToMp3 } from "./mp3";
import { mediaUrl } from "./media";
import { getScenario } from "../content/valeSilente";
import { stripVoiceTags, toVoiceText } from "@/shared/voiceTags";
import { normalizeSpeechPerformance, speechStyle, splitSpeech, type SpeechTone } from "@/shared/speech";
import { concatWav, geminiKeys, resolveVoiceProfile, synthesizeGeminiSpeech } from "./geminiTts";
import { kvLock, kvUnlock } from "../kv";

const MAX_TEXT_CHARS = 2_000;
/** Trava de geração por frase. Maior que o timeout do TTS, para não liberar antes da synthesis. */
const TTS_LOCK_MS = 45_000;
/** Quanto esperar o áudio de outra instância antes de gerar o próprio. Curto de propósito. */
const TTS_LOCK_WAIT_MS = 2_500;
const TTS_LOCK_POLL_MS = 350;

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
 * Devolve null quando nenhuma gravação corresponde à cena: uma fala genérica que
 * diz outra coisa do que está escrito na tela é pior do que o silêncio.
 */
export function recordedVoiceAsset(row: RecordedVoiceRow): string | null {
  const source = row.text.toLocaleLowerCase("pt-BR");
  const speaker = row.speaker_key ?? "";

  if (row.kind === "death") {
    if (/fome|inanição/.test(source)) return "/audio/voz-da-morte/death-fome.mp3";
    if (/frio|hipotermia/.test(source)) return "/audio/voz-da-morte/death-hipotermia.mp3";
    if (/sangr|ferimento|lacera|fratura/.test(source)) return "/audio/voz-da-morte/death-ferimento.mp3";
    return "/audio/voz-da-morte/death-1.mp3";
  }
  // Resultado de escolha é específico demais para um clipe genérico: só a narração gerada serve.
  if (row.kind === "result") return null;
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
  // As duas falas gravadas do desconhecido não servem para Anselmo, Tavares etc.
  if (row.kind === "npc" || speaker.startsWith("npc:")) return null;

  // Nada de frase gravada "parecida" para o narrador: "você encontrou pegadas na lama" sobre
  // um texto que só cita passos soa errado. A narração de verdade vem do pacote gerado.
  return null;
}

function recordedVoiceResponse(row: RecordedVoiceRow): Response {
  const asset = recordedVoiceAsset(row);
  // 204: o cliente mantém a cena só em texto, sem aviso de erro.
  if (!asset) return new Response(null, { status: 204, headers: { "X-Voice-Source": "none" } });
  return new Response(null, {
    status: 307,
    headers: {
      Location: mediaUrl(asset),
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

/**
 * Gera (ou reaproveita) um trecho de áudio.
 *
 * Duas camadas evitam chamar o Gemini mais de uma vez para a mesma frase:
 * o cache no banco e um "single-flight". O single-flight local cobre requisições na
 * mesma instância; a trava no KV cobre instâncias diferentes, que era o jeito de
 * gastar cota duplicada em produção. Se a trava falhar, geramos mesmo assim — o
 * jogador nunca fica esperando por um erro de infraestrutura.
 */
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

  const generate = () => generateChunk(user, campaignId, cacheKey, transcript, style, profile, scene, context);
  const lock = await kvLock(`ls:tts:${cacheKey}`, TTS_LOCK_MS);
  if (!lock) {
    // Outra instância está sintetizando o MESMO trecho. Duplicar a chamada gasta cota da
    // Gemini e devolve áudio mais tarde para os dois, então espera o resultado dela: um
    // orçamento curto e fixo, e depois gera o seu. Ninguém fica pendurado esperando a IA.
    const waited = await waitForAudio(cacheKey, TTS_LOCK_WAIT_MS);
    if (waited) {
      await logTts(user.id, campaignId, cacheKey, transcript.length, "cache_hit", waited.model);
      return { value: waited, source: "cache" };
    }
    return { value: await generate(), source: "generated" };
  }

  const promise = generate();
  inflight().set(cacheKey, promise);
  try {
    return { value: await promise, source: "generated" };
  } finally {
    if (inflight().get(cacheKey) === promise) inflight().delete(cacheKey);
    await kvUnlock(`ls:tts:${cacheKey}`, lock);
  }
}

/** Espera o trecho aparecer no cache, com orçamento fixo. Nunca lança. */
async function waitForAudio(cacheKey: string, budgetMs: number): Promise<CachedAudio | null> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const hit = await cachedAudio(cacheKey);
    if (hit) return hit;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, TTS_LOCK_POLL_MS));
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
  const camp = await requireMember(user, campaignId);
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
  // 1º: narração pré-gerada da própria fala (Chatterbox). Mais de um trecho → lista para o
  // cliente tocar em sequência, com pré-carregamento.
  const generated = row.kind === "death" ? [] : narrationForLog(getScenario(camp.scenario_id), row.text);
  if (generated.length === 1) {
    return new Response(null, {
      status: 307,
      headers: { Location: mediaUrl(generated[0]), "Cache-Control": "private, max-age=31536000, immutable", "X-Voice-Source": "narracao" },
    });
  }
  if (generated.length > 1) {
    return new Response(JSON.stringify({ parts: generated.map(mediaUrl) }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600", "X-Voice-Source": "narracao" },
    });
  }
  const visibleText = stripVoiceTags(row.text).replace(/[【】]/g, "").trim();
  const tone = inferredTone(row.kind, row.speech_say ?? row.text);
  const performance = normalizeSpeechPerformance(visibleText, {
    tone: (row.speech_tone as SpeechTone | null) ?? tone,
    voice: row.speech_voice ?? undefined,
    say: narrationText(row.speech_say ?? row.text),
  }, tone);
  const profile = resolveVoiceProfile(row.speaker_key, row.kind, visibleText);
  const style = speechStyle(performance, config.TTS_SPEECH_LEVEL);
  const chunks = splitSpeech(performance.say);
  const overallKey = sha256(`pt-BR|${profile.key}|${profile.voice}|${style}|${performance.say}`);

  // 2º: biblioteca do Supabase — alguém, em qualquer campanha, já gerou exatamente esta fala?
  // Toca direto de lá: sem token, sem espera, e cada partida deixa a próxima mais barata.
  const libPath = libraryPath("vozes", [overallKey], "mp3");
  if (visibleText && chunks.length && (await libraryHas(libPath))) {
    return new Response(null, {
      status: 307,
      headers: { Location: libraryUrl(libPath)!, "Cache-Control": "private, max-age=31536000, immutable", "X-Voice-Source": "biblioteca" },
    });
  }

  // Produção usa as interpretações já gravadas. Gemini só é consultado com opt-in
  // explícito e chave válida, evitando espera/erro por uma credencial antiga no ambiente.
  if (config.TTS_PROVIDER !== "gemini" || !geminiKeys(config).length) return recordedVoiceResponse(row);
  if (!visibleText || !chunks.length) throw notFound("Nada para narrar.");

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
  const wav = concatWav(parts);
  // Guarda na biblioteca (MP3, ~6× menor) para as próximas partidas; no máximo 4 s de espera.
  await Promise.race([wavToMp3(wav).then((mp3) => libraryPut(libPath, mp3, "audio/mpeg")), new Promise((r) => setTimeout(r, 4000))]).catch(() => undefined);
  return audioResponse(wav, {
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
