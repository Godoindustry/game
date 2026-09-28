import type { AppConfig } from "../config";

export interface VoiceProfile {
  key: string;
  name: string;
  voice: string;
  profile: string;
}

export interface GeminiSpeechRequest {
  transcript: string;
  style: string;
  profile: VoiceProfile;
  scene: string;
  context?: string;
}

export interface GeminiSpeechResult {
  audio: Buffer;
  mimeType: "audio/wav";
  model: string;
  endpoint: "interactions" | "generateContent";
  keySlot: number;
}

const DEFAULT_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-3.1-flash-tts-preview",
] as const;

const PROFILES: Record<string, VoiceProfile> = {
  narrator: {
    key: "narrator",
    name: "Narrador do Vale",
    voice: "pt-br-storyteller-10",
    profile: "homem, 48 anos, cronista de rádio do sul de Minas, sotaque brasileiro leve, atento e sombrio, voz grave íntima com respiração natural",
  },
  death: {
    key: "death",
    name: "A Voz da Morte",
    voice: "pt-br-storyteller-1",
    profile: "presença sem idade, voz brasileira quase humana, serena e inevitável, timbre baixo soproso, fala muito próxima do ouvido",
  },
  "npc:piloto": {
    key: "npc:piloto",
    name: "Comandante Brandão",
    voice: "pt-br-assistant-3",
    profile: "homem, 52 anos, piloto de táxi aéreo de Belo Horizonte, sotaque mineiro discreto, culpado e paranoico, voz madura rouca e cansada",
  },
  "npc:tavares": {
    key: "npc:tavares",
    name: "Tavares",
    voice: "pt-br-advisor-4",
    profile: "homem, 44 anos, chefe de segurança clandestina do interior, sotaque brasileiro neutro, calculista e ameaçador, voz firme seca sem pressa",
  },
  "npc:iara": {
    key: "npc:iara",
    name: "Iara Menezes",
    voice: "pt-br-storyteller-7",
    profile: "mulher, 31 anos, hidróloga de Campinas, sotaque paulista leve, lúcida e assombrada, voz macia distante com falhas de rádio imaginárias",
  },
  "npc:anselmo": {
    key: "npc:anselmo",
    name: "Anselmo",
    voice: "pt-br-storyteller-8",
    profile: "homem, 63 anos, mateiro do Vale Silente, sotaque rural mineiro leve, desconfiado e observador, voz áspera baixa com pausas longas",
  },
  "creature:mae": {
    key: "creature:mae",
    name: "Mãe das Asas",
    voice: "pt-br-advisor-3",
    profile: "mulher de idade impossível, entidade do poço, português brasileiro arcaico sutil, maternal e predatória, voz suave profunda com fome contida",
  },
  "creature:ambar": {
    key: "creature:ambar",
    name: "Lobo de Âmbar",
    voice: "pt-br-storyteller-11",
    profile: "homem, 38 anos, guardião amaldiçoado da serra, sotaque mineiro leve, feroz e dividido, voz grande ferida com respiração animal",
  },
  "creature:morcego": {
    key: "creature:morcego",
    name: "A Coisa Alada",
    voice: "pt-br-storyteller-5",
    profile: "criatura de idade desconhecida, predador do Vale Silente, articulação brasileira quebrada, faminta e cautelosa, voz cavernosa curta com respiração áspera",
  },
  "creature:alma": {
    key: "creature:alma",
    name: "Alma na Névoa",
    voice: "pt-br-storyteller-9",
    profile: "jovem sem idade, aparição da mata brasileira, sotaque indefinível e delicado, confusa e melancólica, voz frágil aérea quase sussurrada",
  },
  "npc:desconhecido": {
    key: "npc:desconhecido",
    name: "Desconhecido",
    voice: "pt-br-assistant-11",
    profile: "homem, 35 anos, origem desconhecida, sotaque brasileiro neutro, reservado e alerta, voz clara baixa com tensão controlada",
  },
};

const FALLBACK_VOICES = [
  "pt-br-assistant-1",
  "pt-br-assistant-2",
  "pt-br-assistant-4",
  "pt-br-assistant-5",
  "pt-br-assistant-6",
  "pt-br-assistant-7",
  "pt-br-assistant-8",
  "pt-br-assistant-9",
] as const;

function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % length;
}

export function resolveVoiceProfile(speakerKey: string | null | undefined, kind = "narrative", text = ""): VoiceProfile {
  let key = speakerKey?.trim() || (kind === "death" || kind === "ending" ? "death" : "narrator");
  const source = text.toLocaleLowerCase("pt-BR");
  if (!speakerKey && kind === "npc") {
    if (/tavares|dono da carga/.test(source)) key = "npc:tavares";
    else if (/iara|23h40|vinte e oito anos/.test(source)) key = "npc:iara";
    else if (/anselmo|mateiro/.test(source)) key = "npc:anselmo";
    else key = "npc:desconhecido";
  }
  const known = PROFILES[key];
  if (known) return known;
  const voice = FALLBACK_VOICES[stableIndex(key, FALLBACK_VOICES.length)];
  return {
    key,
    name: key.replace(/^[^:]+:/, "").replaceAll("_", " "),
    voice,
    profile: "pessoa adulta brasileira, origem não revelada, sotaque regional leve, presença realista e contida, voz conversacional distinta com respiração natural",
  };
}

export function geminiKeys(config: AppConfig): string[] {
  return [
    config.GEMINI_API_KEY,
    config.GEMINI_API_KEY2,
    config.GEMINI_API_KEY3,
    config.GEMINI_API_KEY4,
    config.GEMINI_API_KEY5,
    config.GEMINI_API_KEY6,
  ].filter((key): key is string => !!key);
}

function ttsModels(config: AppConfig): string[] {
  const configured = config.GEMINI_TTS_MODELS.split(",").map((model) => model.trim()).filter(Boolean);
  return configured.length ? configured : [...DEFAULT_MODELS];
}

function wavHeader(dataBytes: number, sampleRate = 24_000, channels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = channels * bitsPerSample / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

export function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  return Buffer.concat([wavHeader(pcm.length, sampleRate), pcm]);
}

function isWav(audio: Buffer): boolean {
  return audio.length >= 12 && audio.toString("ascii", 0, 4) === "RIFF" && audio.toString("ascii", 8, 12) === "WAVE";
}

function ensureWav(audio: Buffer, mimeType: string): Buffer {
  if (isWav(audio)) return audio;
  const rate = Number(/rate=(\d+)/i.exec(mimeType)?.[1] ?? 24_000);
  return pcmToWav(audio, rate);
}

interface WavData {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
  bits: number;
}

function wavData(wav: Buffer): WavData {
  if (!isWav(wav)) throw new Error("Áudio Gemini sem cabeçalho WAV válido.");
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bits = wav.readUInt16LE(34);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") return { pcm: wav.subarray(offset + 8, offset + 8 + size), sampleRate, channels, bits };
    offset += 8 + size + (size % 2);
  }
  throw new Error("Bloco PCM não encontrado no WAV Gemini.");
}

export function concatWav(parts: Buffer[]): Buffer {
  if (!parts.length) throw new Error("Nenhum trecho de áudio foi gerado.");
  if (parts.length === 1) return parts[0];
  const decoded = parts.map(wavData);
  const format = decoded[0];
  if (decoded.some((part) => part.sampleRate !== format.sampleRate || part.channels !== format.channels || part.bits !== format.bits)) {
    throw new Error("Trechos Gemini retornaram formatos incompatíveis.");
  }
  const pcm = Buffer.concat(decoded.map((part) => part.pcm));
  return Buffer.concat([wavHeader(pcm.length, format.sampleRate, format.channels, format.bits), pcm]);
}

type Json = Record<string, unknown>;

function interactionAudio(body: Json): { data: string; mimeType: string } | null {
  const direct = body.output_audio as Json | undefined;
  if (typeof direct?.data === "string") return { data: direct.data, mimeType: String(direct.mime_type ?? direct.mimeType ?? "audio/L16;rate=24000") };
  const steps = Array.isArray(body.steps) ? body.steps : [];
  for (const step of [...steps].reverse()) {
    const content = Array.isArray((step as Json).content) ? (step as Json).content as Json[] : [];
    for (const item of [...content].reverse()) {
      if (item.type === "audio" && typeof item.data === "string") {
        return { data: item.data, mimeType: String(item.mime_type ?? item.mimeType ?? "audio/L16;rate=24000") };
      }
    }
  }
  return null;
}

function generatedAudio(body: Json): { data: string; mimeType: string } | null {
  const candidates = Array.isArray(body.candidates) ? body.candidates as Json[] : [];
  for (const candidate of candidates) {
    const content = candidate.content as Json | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts as Json[] : [];
    for (const part of parts) {
      const inline = (part.inlineData ?? part.inline_data) as Json | undefined;
      if (typeof inline?.data === "string") return { data: inline.data, mimeType: String(inline.mimeType ?? inline.mime_type ?? "audio/L16;rate=24000") };
    }
  }
  return null;
}

class GeminiHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJson(url: string, key: string, body: Json, timeoutMs: number): Promise<Json> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
    throw new GeminiHttpError(response.status, `Gemini HTTP ${response.status}: ${detail}`);
  }
  return response.json() as Promise<Json>;
}

async function viaInteractions(model: string, key: string, request: GeminiSpeechRequest, timeoutMs: number): Promise<Buffer> {
  const body = await postJson("https://generativelanguage.googleapis.com/v1beta/interactions", key, {
    model,
    store: false,
    input: [{
      type: "user_input",
      content: [{
        type: "text",
        text: request.transcript,
        annotations: [{ type: "speech_metadata", style: request.style }],
      }],
    }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: request.profile.voice }] },
  }, timeoutMs);
  const audio = interactionAudio(body);
  if (!audio) throw new Error("Gemini interactions não devolveu áudio.");
  return ensureWav(Buffer.from(audio.data, "base64"), audio.mimeType);
}

function legacyPrompt(request: GeminiSpeechRequest): string {
  return [
    `AUDIO PROFILE: ${request.profile.name}, ${request.profile.profile}`,
    `SCENE: ${request.scene}`,
    `CONTEXT (do NOT say this): ${request.context?.trim() || "No previous spoken line."}`,
    `DIRECTOR'S NOTES: ${request.style}. Sound like a real person in a live conversation, not someone reading`,
    `TRANSCRIPT: ${request.transcript}`,
  ].join("\n");
}

async function viaGenerateContent(model: string, key: string, request: GeminiSpeechRequest, timeoutMs: number): Promise<Buffer> {
  const body = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, key, {
    contents: [{ role: "user", parts: [{ text: legacyPrompt(request) }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: request.profile.voice } } },
    },
  }, timeoutMs);
  const audio = generatedAudio(body);
  if (!audio) throw new Error("Gemini generateContent não devolveu áudio.");
  return ensureWav(Buffer.from(audio.data, "base64"), audio.mimeType);
}

type GlobalTts = typeof globalThis & { __geminiTtsKeyCursor?: number };

/** Interactions primeiro; generateContent como compatibilidade; 429 gira a chave. */
export async function synthesizeGeminiSpeech(config: AppConfig, request: GeminiSpeechRequest): Promise<GeminiSpeechResult> {
  const keys = geminiKeys(config);
  if (!keys.length) throw new Error("Nenhuma GEMINI_API_KEY configurada.");
  const models = ttsModels(config);
  const global = globalThis as GlobalTts;
  const start = global.__geminiTtsKeyCursor ?? 0;
  const errors: string[] = [];

  for (const model of models) {
    for (let offset = 0; offset < keys.length; offset++) {
      const keyIndex = (start + offset) % keys.length;
      const key = keys[keyIndex];
      // O 3.1 aceita áudio no generateContent, mas rejeita speech_metadata em interactions.
      if (!model.startsWith("gemini-3.1-")) {
        try {
          const audio = await viaInteractions(model, key, request, config.TTS_TIMEOUT_MS);
          global.__geminiTtsKeyCursor = keyIndex;
          return { audio, mimeType: "audio/wav", model, endpoint: "interactions", keySlot: keyIndex + 1 };
        } catch (error) {
          if (error instanceof GeminiHttpError && error.status === 429) {
            global.__geminiTtsKeyCursor = (keyIndex + 1) % keys.length;
            errors.push(`${model}/chave${keyIndex + 1}/interactions: 429`);
            continue;
          }
          errors.push(`${model}/chave${keyIndex + 1}/interactions: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const audio = await viaGenerateContent(model, key, request, config.TTS_TIMEOUT_MS);
          global.__geminiTtsKeyCursor = keyIndex;
          return { audio, mimeType: "audio/wav", model, endpoint: "generateContent", keySlot: keyIndex + 1 };
        } catch (error) {
          if (error instanceof GeminiHttpError && error.status === 503 && attempt < 2) {
            await wait(600 * (attempt + 1));
            continue;
          }
          if (error instanceof GeminiHttpError && error.status === 429) global.__geminiTtsKeyCursor = (keyIndex + 1) % keys.length;
          errors.push(`${model}/chave${keyIndex + 1}/generateContent: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
    }
  }
  throw new Error(errors.join(" | ").slice(0, 1800) || "Gemini TTS indisponível.");
}
