/**
 * Tags de expressão para o modelo de voz (ex.: ElevenLabs `eleven_v3` "audio tags").
 *
 * Escrevemos a tag ENTRE COLCHETES, em inglês (o idioma que o modelo de voz entende melhor),
 * imediatamente antes do trecho que ela afeta:
 *
 *   "[whispers] sete… quatro… zero… [pause] [trembling] Ninguém sabe que você está aqui."
 *
 * - O texto guardado no conteúdo/banco mantém as tags (fonte da verdade).
 * - Para a TELA usamos `stripVoiceTags()` → o jogador nunca vê as tags.
 * - Para a VOZ usamos `toVoiceText()` → mantém só tags da lista permitida.
 * - Modelos de voz sem suporte a tags (ex.: eleven_multilingual_v2) devem receber o texto limpo,
 *   senão leriam "whispers" em voz alta.
 */

export const VOICE_TAGS = {
  // entrega / volume
  whispers: "sussurra",
  "speaking softly": "fala baixo",
  shouts: "grita",
  // respiração e sons do corpo
  sighs: "suspira",
  gasps: "perde o fôlego",
  exhales: "solta o ar",
  "breathing heavily": "respira pesado",
  "clears throat": "pigarreia",
  gulps: "engole seco",
  // emoção
  nervous: "nervoso",
  scared: "com medo",
  terrified: "aterrorizado",
  trembling: "tremendo",
  tense: "tenso",
  sad: "triste",
  hopeful: "esperançoso",
  relieved: "aliviado",
  desperate: "desesperado",
  calm: "calmo",
  cold: "frio, sem emoção",
  serious: "sério",
  urgent: "urgente",
  mysterious: "misterioso",
  ominous: "sinistro",
  dramatic: "dramático",
  exhausted: "exausto",
  // ritmo
  pause: "pausa",
  "long pause": "pausa longa",
  slowly: "devagar",
} as const;

export type VoiceTag = keyof typeof VOICE_TAGS;

const ALLOWED = new Set<string>(Object.keys(VOICE_TAGS));

/** [tag] com letras minúsculas/espaços (não confunde com texto normal nem com 【títulos】). */
const TAG_RE = /\[([a-z][a-z ]{1,24})\]/g;

export function isVoiceTag(tag: string): tag is VoiceTag {
  return ALLOWED.has(tag);
}

/** Remove TODAS as tags (permitidas ou não) — texto para a tela. */
export function stripVoiceTags(text: string): string {
  return text
    .replace(TAG_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?…])/g, "$1")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

/** Mantém só as tags permitidas — texto para o modelo de voz. */
export function toVoiceText(text: string): string {
  return text
    .replace(TAG_RE, (m, tag: string) => (ALLOWED.has(tag) ? m : ""))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Tags permitidas presentes no texto, na ordem. */
export function extractVoiceTags(text: string): VoiceTag[] {
  return [...text.matchAll(TAG_RE)].map((m) => m[1]).filter(isVoiceTag);
}

/** Par pronto para a API: o que a tela mostra e o que a voz fala. */
export function speakable(text: string): { text: string; voice: string } {
  return { text: stripVoiceTags(text), voice: toVoiceText(text) };
}
