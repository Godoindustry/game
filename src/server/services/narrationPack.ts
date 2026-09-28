/**
 * Narração pré-gerada (Chatterbox no Colab — ver narrador/ e docs/NARRACAO.md).
 *
 * 1. `npm run narration:export` escreve todas as falas fixas da história na célula 4 do
 *    notebook narrador/narrador_chatterbox.ipynb, uma chave estável por trecho.
 * 2. O Colab gera os MP3 e baixa narrador.zip.
 * 3. `npm run narration:import -- <narrador.zip>` copia os MP3 para public/audio/narracao/
 *    e grava o índice src/server/content/narracao.json (importado aqui — funciona na Vercel).
 *
 * O servidor casa cada linha do diário com os trechos gerados pela CHAVE: o texto enviado ao
 * TTS pode ser adaptado para soar natural sem quebrar a correspondência com o texto da tela.
 */
import type { GameContent } from "../engine/types";
import { stripVoiceTags } from "@/shared/voiceTags";
import narrationIndex from "../content/narracao.json";

export type NarrationEmotion = "calmo" | "normal" | "tenso" | "triste";

export interface NarrationLine {
  /** Chave única, só [a-z0-9_] — vira o nome do arquivo no notebook. */
  key: string;
  emotion: NarrationEmotion;
  /** Texto como aparece no jogo (sem tags de voz): usado para casar com o diário. */
  shown: string;
  /** Texto enviado ao TTS (números por extenso etc.). */
  spoken: string;
}

export interface NarrationIndex {
  versao: number;
  eventos: Record<string, { arquivo: string; texto: string }[]>;
}

/** O Chatterbox perde a naturalidade em blocos longos: trechos de até ~260 caracteres. */
const MAX_PART = 260;

const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Mesma normalização para o texto do conteúdo e o do diário. */
export function normalizeForMatch(text: string): string {
  return stripVoiceTags(text)
    .replace(/【[^】]*】/g, " ")
    .replace(/[“”"«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

/** Escreve para o ouvido: o TTS lê "23h40" e "7-4-0" melhor por extenso. */
export function speakable(text: string): string {
  return stripVoiceTags(text)
    .replace(/【[^】]*】/g, " ")
    .replace(/\b23h40\b/gi, "vinte e três e quarenta")
    .replace(/\b7-4-0\b/g, "sete, quatro, zero")
    .replace(/\b074\b/g, "zero sete quatro")
    .replace(/\s+—\s+/g, ", ")
    .replace(/[“”"«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Divide em frases inteiras, cada parte com no máximo MAX_PART caracteres (salvo frase gigante). */
export function splitForSpeech(text: string): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+["”]?|[^.!?…]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > MAX_PART) {
      parts.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Todas as falas fixas da campanha, em ordem de história. */
export function narrationScript(content: GameContent): NarrationLine[] {
  const lines: NarrationLine[] = [];
  const seen = new Set<string>();
  const add = (key: string, emotion: NarrationEmotion, raw: string | undefined) => {
    const shown = raw ? stripVoiceTags(raw).replace(/\s+/g, " ").trim() : "";
    if (!shown || seen.has(normalizeForMatch(shown))) return;
    seen.add(normalizeForMatch(shown));
    const parts = splitForSpeech(speakable(raw!));
    parts.forEach((spoken, index) => {
      lines.push({ key: parts.length > 1 ? `${slug(key)}_p${index + 1}` : slug(key), emotion, shown, spoken });
    });
  };

  for (const [location, intro] of Object.entries(content.startIntros ?? {})) add(`intro_${location}`, "calmo", intro);
  for (const event of content.events) {
    add(`${event.id}_cena`, "tenso", event.body);
    for (const choice of event.choices) {
      add(`${choice.id}_texto`, "normal", choice.outcome.text);
      add(`${choice.id}_sucesso`, "normal", choice.outcome.success?.text);
      add(`${choice.id}_falha`, "tenso", choice.outcome.failure?.text);
    }
  }
  for (const [npcId, rules] of Object.entries(content.npcRules)) {
    for (const [intent, rule] of Object.entries(rules)) {
      add(`npc_${npcId}_${intent}`, "normal", rule.text);
      add(`npc_${npcId}_${intent}_sucesso`, "normal", rule.success?.text);
      add(`npc_${npcId}_${intent}_falha`, "tenso", rule.failure?.text);
    }
  }
  for (const [key, ending] of Object.entries(content.endings)) add(`final_${key}`, ending.type === "victory" ? "calmo" : "triste", ending.text);
  return lines;
}

interface PackEntry {
  norm: string;
  files: string[];
}

const packCache = new WeakMap<NarrationIndex, WeakMap<GameContent, PackEntry[]>>();

/** Trechos gerados que ainda batem com o texto atual do conteúdo (fala velha é ignorada). */
function packFor(content: GameContent, source: NarrationIndex): PackEntry[] {
  const byContent = packCache.get(source) ?? new WeakMap<GameContent, PackEntry[]>();
  packCache.set(source, byContent);
  const cached = byContent.get(content);
  if (cached) return cached;
  const index = source.eventos ?? {};
  const byShown = new Map<string, { files: string[]; complete: boolean }>();
  for (const line of narrationScript(content)) {
    const norm = normalizeForMatch(line.shown);
    const entry = byShown.get(norm) ?? { files: [], complete: true };
    const file = index[line.key]?.[0];
    if (file && file.texto.trim() === line.spoken) entry.files.push(`/audio/narracao/${file.arquivo}`);
    else entry.complete = false;
    byShown.set(norm, entry);
  }
  const pack = [...byShown].filter(([, v]) => v.complete && v.files.length).map(([norm, v]) => ({ norm, files: v.files }));
  byContent.set(content, pack);
  return pack;
}

/** Arquivos (em ordem) que narram uma linha do diário, ou [] se não há fala gerada para ela. */
export function narrationForLog(content: GameContent, logText: string, index: NarrationIndex = narrationIndex): string[] {
  const pack = packFor(content, index);
  if (!pack.length) return [];
  const text = normalizeForMatch(logText);
  const hits = pack
    .map((entry) => ({ entry, at: text.indexOf(entry.norm) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at || b.entry.norm.length - a.entry.norm.length);
  const files: string[] = [];
  let covered = -1;
  for (const hit of hits) {
    if (hit.at < covered) continue; // trecho contido em outro já escolhido
    files.push(...hit.entry.files);
    covered = hit.at + hit.entry.norm.length;
  }
  return files;
}
