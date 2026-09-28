"use client";
/**
 * Mixer de áudio do jogador: volume geral + por categoria + por participante da voz.
 * Fica salvo no navegador (localStorage) — é preferência de cada pessoa, não do jogo.
 *
 * Categorias:
 *  - narracao:      narrador ao vivo e falas gravadas (sistema, narrador, voz da morte)
 *  - efeitos:       estalos de terror (chefes, gritos, risadas, galhos e uivos)
 *  - ambiente:      sons de lugar em loop (noite, floresta, fogueira, rio, poço) e o ambiente procedural
 *  - musica:        trilha narrativa e música de confronto com chefes
 *  - participantes: voz dos outros jogadores na sala
 *
 * Quem toca som chama `mixVolume(categoria, volumeBase)` na hora de tocar e, para sons longos,
 * `onMixChange()` para acompanhar o slider em tempo real.
 */
import { create } from "zustand";

export type AudioCategory = "narracao" | "efeitos" | "ambiente" | "musica" | "participantes";

export const CATEGORY_LABEL: Record<AudioCategory, string> = {
  narracao: "Narração",
  efeitos: "Efeitos",
  ambiente: "Ambiente",
  musica: "Música",
  participantes: "Voz dos participantes",
};

export interface MixerState {
  master: number;
  muted: boolean;
  levels: Record<AudioCategory, number>;
  /** Participantes da voz silenciados por mim (id do usuário → true). */
  peerMuted: Record<string, boolean>;
  /** Volume individual de cada participante (0..1.5; 1 = normal). */
  peerVolume: Record<string, number>;
  /** Música abaixa sozinha durante o confronto com um chefe (a música de luta assume). */
  ducked: boolean;
  /** Alguém está falando (narrador, personagem, alerta): o resto abaixa, como na vida real. */
  voiceActive: boolean;
  setVoiceActive: (v: boolean) => void;
  setMaster: (v: number) => void;
  setLevel: (cat: AudioCategory, v: number) => void;
  toggleMuted: () => void;
  togglePeer: (id: string) => void;
  setPeerVolume: (id: string, v: number) => void;
  setDucked: (v: boolean) => void;
  reset: () => void;
}

/** Equilíbrio padrão: narração e efeitos na frente, ambiente e música por baixo. */
export const DEFAULT_LEVELS: Record<AudioCategory, number> = {
  narracao: 0.96,
  efeitos: 0.52,
  ambiente: 0.38,
  musica: 0.26,
  participantes: 0.92,
};
const DEFAULT_MASTER = 0.78;
// v2 descarta a mixagem antiga, que deixava efeitos e ambientes altos demais.
const KEY = "ls-audio-mixer-v2";

type Saved = Pick<MixerState, "master" | "muted" | "levels" | "peerMuted" | "peerVolume">;

function load(): Partial<Saved> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as Partial<Saved>) : {};
  } catch {
    return {};
  }
}

function save(s: MixerState) {
  try {
    const data: Saved = { master: s.master, muted: s.muted, levels: s.levels, peerMuted: s.peerMuted, peerVolume: s.peerVolume };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* navegador sem armazenamento: vale só nesta sessão */
  }
}

const clamp01 = (v: number, max = 1) => Math.max(0, Math.min(max, Number.isFinite(v) ? v : 0));

const saved = load();
export const useMixer = create<MixerState>((set, get) => ({
  master: clamp01(saved.master ?? DEFAULT_MASTER),
  muted: !!saved.muted,
  levels: { ...DEFAULT_LEVELS, ...(saved.levels ?? {}) },
  peerMuted: saved.peerMuted ?? {},
  peerVolume: saved.peerVolume ?? {},
  ducked: false,
  voiceActive: false,
  setVoiceActive: (v) => { if (get().voiceActive !== v) set({ voiceActive: v }); },
  setMaster: (v) => { set({ master: clamp01(v) }); save(get()); },
  setLevel: (cat, v) => { set({ levels: { ...get().levels, [cat]: clamp01(v) } }); save(get()); },
  toggleMuted: () => { set({ muted: !get().muted }); save(get()); },
  togglePeer: (id) => { set({ peerMuted: { ...get().peerMuted, [id]: !get().peerMuted[id] } }); save(get()); },
  setPeerVolume: (id, v) => { set({ peerVolume: { ...get().peerVolume, [id]: clamp01(v, 1.5) } }); save(get()); },
  setDucked: (v) => { if (get().ducked !== v) set({ ducked: v }); },
  reset: () => { set({ master: DEFAULT_MASTER, muted: false, levels: { ...DEFAULT_LEVELS } }); save(get()); },
}));

/**
 * Quanto cada categoria abaixa enquanto alguém fala. Voz nunca abaixa; o resto recua
 * o suficiente para a fala ficar clara, sem sumir.
 */
export const VOICE_DUCK: Record<AudioCategory, number> = {
  narracao: 1,
  participantes: 1,
  efeitos: 0.36,
  ambiente: 0.24,
  musica: 0.18,
};

/** Volume final (0..1) de um som: base do próprio som × categoria × geral (0 se mudo). */
export function mixVolume(cat: AudioCategory, base = 1): number {
  const s = useMixer.getState();
  if (s.muted) return 0;
  const boss = cat === "musica" && s.ducked ? 0.25 : 1;
  const voice = s.voiceActive ? VOICE_DUCK[cat] : 1;
  return clamp01(base * s.levels[cat] * s.master * boss * voice);
}

/** Volume de um participante da voz (0 se eu o silenciei). HTMLAudioElement aceita no máximo 1. */
export function peerVolume(id: string): number {
  const s = useMixer.getState();
  if (s.muted || s.peerMuted[id]) return 0;
  return clamp01((s.peerVolume[id] ?? 1) * s.levels.participantes * s.master);
}

/** Avisa quando qualquer volume muda (para sons em loop acompanharem o slider). */
export function onMixChange(fn: () => void): () => void {
  return useMixer.subscribe(fn);
}
