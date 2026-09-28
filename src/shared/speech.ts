import { extractGeminiSoundTags, stripVoiceTags, toVoiceText } from "./voiceTags";

export const SPEECH_TONES = [
  "neutral",
  "happy",
  "laughing",
  "amused",
  "excited",
  "surprised",
  "curious",
  "worried",
  "sad",
  "annoyed",
  "embarrassed",
  "apologetic",
  "tender",
  "sarcastic",
  "hesitant",
  "whispering",
  "sighing",
  "hurried",
] as const;

export type SpeechTone = (typeof SPEECH_TONES)[number];
export type SpeechLevel = "beginner" | "advanced";

export interface SpeechPerformance {
  tone: SpeechTone;
  /** Direção em inglês para o ator, sem texto a ser pronunciado. */
  voice: string;
  /** Transcrição literal, podendo conter até duas tags sonoras Gemini. */
  say: string;
}

const TONE_DIRECTIONS: Record<SpeechTone, string> = {
  neutral: "calm and present, natural pace, medium-low conversational volume",
  happy: "quietly happy, warm energy, relaxed pace and gentle smile",
  laughing: "genuinely laughing, loose rhythm, warm breath and bright energy",
  amused: "subtly amused, restrained chuckle, conversational pace and soft volume",
  excited: "genuinely excited, quick rhythm, rising voice and vivid energy",
  surprised: "genuinely surprised, voice rising, then a breathless reaction",
  curious: "carefully curious, leaning forward, measured pace and searching tone",
  worried: "truly worried, uneven breath, restrained volume and urgent undertone",
  sad: "deeply sad, fragile breath, slow rhythm and subdued volume",
  annoyed: "annoyed but controlled, clipped words, firm pace and low volume",
  embarrassed: "visibly embarrassed, hesitant rhythm, softer volume and nervous breath",
  apologetic: "sincerely apologetic, careful words, gentle pace and lowered voice",
  tender: "intimate and tender, warm breath, unhurried rhythm and soft voice",
  sarcastic: "dryly sarcastic, precise timing, restrained energy and pointed emphasis",
  hesitant: "genuinely hesitant, broken rhythm, small pauses and uncertain volume",
  whispering: "tense whisper, close breath, slow rhythm and almost no volume",
  sighing: "emotionally drained, audible exhale, slow pace and weighted words",
  hurried: "hurried and breathless, fast rhythm, low volume and urgent energy",
};

const clean = (text: string) => stripVoiceTags(text).replace(/\s+/g, " ").trim();

export function validVoiceDirection(voice: string): boolean {
  const words = voice.trim().split(/\s+/).filter(Boolean);
  return words.length >= 4 && words.length <= 14 && !/[<>\[\]]/.test(voice);
}

/**
 * Garante que o modelo não tenha mudado nenhuma palavra em `say`.
 * Se mudar texto, inventar tags ou exagerar nos sons, a variante é descartada.
 */
export function normalizeSpeechPerformance(
  text: string,
  candidate?: Partial<SpeechPerformance> | null,
  fallbackTone: SpeechTone = "neutral",
): SpeechPerformance {
  const visible = clean(text);
  const tone = candidate?.tone && SPEECH_TONES.includes(candidate.tone) ? candidate.tone : fallbackTone;
  const rawSay = typeof candidate?.say === "string" ? candidate.say.trim() : "";
  const normalizedSay = toVoiceText(rawSay);
  const tags = extractGeminiSoundTags(normalizedSay);
  const say = rawSay && tags.length <= 2 && clean(normalizedSay) === visible ? normalizedSay : visible;
  const voice = candidate?.voice && validVoiceDirection(candidate.voice)
    ? candidate.voice.trim()
    : TONE_DIRECTIONS[tone];
  return { tone, voice, say };
}

export function speechStyle(performance: SpeechPerformance, level: SpeechLevel = "advanced"): string {
  const rhythm = level === "beginner"
    ? "speaking a little slower than usual and articulating every word clearly, still natural"
    : "at natural native speed";
  return `${performance.voice}; ${rhythm}`;
}

/** Divide em pausas naturais sem ultrapassar o limite usado pelo TTS. */
export function splitSpeech(text: string, maxChars = 260): string[] {
  const input = text.replace(/\s+/g, " ").trim();
  if (!input) return [];
  if (input.length <= maxChars) return [input];

  const sentences = input.match(/[^.!?…]+(?:[.!?…]+[”"']?|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [input];
  const chunks: string[] = [];
  let current = "";

  const pushPiece = (piece: string) => {
    if (!piece) return;
    if (!current) current = piece;
    else if (`${current} ${piece}`.length <= maxChars) current += ` ${piece}`;
    else {
      chunks.push(current);
      current = piece;
    }
  };

  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      pushPiece(sentence);
      continue;
    }
    // Pausas com duas palavras são um único token do Gemini; nunca corte a tag ao meio.
    const words = sentence.match(/<(?:short|long) pause>|\S+/g) ?? [];
    let piece = "";
    for (const word of words) {
      if (!piece || `${piece} ${word}`.length <= maxChars) piece = piece ? `${piece} ${word}` : word;
      else {
        pushPiece(piece);
        piece = word;
      }
    }
    pushPiece(piece);
  }
  if (current) chunks.push(current);
  return chunks;
}
