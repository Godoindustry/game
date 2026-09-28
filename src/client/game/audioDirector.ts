"use client";
/**
 * Diretor de áudio — o ÚNICO lugar que toca som no jogo. Regras de "vida real":
 *
 *  1. VOZ (narrador, personagens, alertas): uma de cada vez, em fila. Enquanto alguém fala,
 *     o mixer abaixa ambiente, efeitos e música (VOICE_DUCK) — a fala fica sempre por cima.
 *     Narração tem prioridade; alerta de HUD é descartado se já houver alguém falando.
 *  2. FUNDO: um único som de ambiente por vez (luta > fogueira > água > noite/dia),
 *     trocado em crossfade. Nada de empilhar loops.
 *  3. EFEITOS: no máximo um a cada 1,5 s; os importantes (chefe, morte) passam na frente.
 *
 * Os volumes-base são pensados para arquivos já normalizados (scripts/normalize-audio.mjs),
 * então 1 = "volume certo da categoria"; o mixer multiplica por categoria e geral.
 */
import { mixVolume, onMixChange, useMixer, type AudioCategory } from "../audioMixer";
import { localAudioFallback, sfxUrl } from "./mediaBase";

export type VoicePriority = "narracao" | "alerta";

export interface VoiceJob {
  priority: VoicePriority;
  /** Toca a fala e resolve quando ela termina (ou falha). */
  run: () => Promise<void>;
  stop: () => void;
  setVolume?: () => void;
}

const STING_GAP_MS = 1500;
const BED_FADE_IN_MS = 2200;
const BED_FADE_OUT_MS = 1600;
const fadeVersion = new WeakMap<HTMLAudioElement, number>();

function fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void) {
  const version = (fadeVersion.get(a) ?? 0) + 1;
  fadeVersion.set(a, version);
  const from = a.volume;
  const start = performance.now();
  const step = () => {
    if (fadeVersion.get(a) !== version) return;
    const k = Math.min(1, (performance.now() - start) / ms);
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

export class AudioDirector {
  private queue: VoiceJob[] = [];
  private current: VoiceJob | null = null;
  private nextVoiceTimer: ReturnType<typeof setTimeout> | null = null;
  private bed: { sound: string; el: HTMLAudioElement; base: number; cat: AudioCategory; fading: boolean } | null = null;
  private currentSting: { el: HTMLAudioElement; base: number } | null = null;
  // -Infinity: com 0, o intervalo mínimo engolia todo efeito do primeiro 1,5 s da página
  // (performance.now() começa em zero) — inclusive o zumbido da abertura.
  private lastSting = -Infinity;
  private enabled = true;
  /** Sons que deram 404 nesta aba: não pede de novo, vai direto para a reserva. */
  private missing = new Set<string>();

  constructor() {
    // Qualquer mudança no mixer (slider, ducking de voz) reajusta o fundo na hora, com rampa curta.
    onMixChange(() => {
      const b = this.bed;
      if (b && !b.el.paused) {
        b.fading = true;
        fade(b.el, mixVolume(b.cat, b.base), 400, () => { b.fading = false; });
      }
      this.current?.setVolume?.();
      if (this.currentSting && !this.currentSting.el.paused) {
        this.currentSting.el.volume = mixVolume("efeitos", this.currentSting.base);
      }
    });
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.stopVoices();
      this.setBed(null);
      this.stopSting();
    }
  }

  // ── Voz ──────────────────────────────────────────────────────────────────
  /** Fala de um arquivo (narração gravada, alerta do sistema). */
  voiceFile(url: string, base = 1, priority: VoicePriority = "narracao") {
    let el: HTMLAudioElement | null = null;
    let finish: (() => void) | null = null;
    const job: VoiceJob = {
      priority,
      run: () =>
        new Promise<void>((resolve) => {
          let settled = false;
          finish = () => {
            if (settled) return;
            settled = true;
            finish = null;
            resolve();
          };
          const start = (source: string, allowLocalFallback: boolean) => {
            el = new Audio(source);
            el.volume = mixVolume("narracao", base);
            el.onended = () => finish?.();
            el.onerror = () => {
              const fallback = allowLocalFallback ? localAudioFallback(source) : null;
              if (fallback) start(fallback, false);
              else finish?.();
            };
            void el.play().catch(() => finish?.());
          };
          start(url, true);
        }),
      stop: () => {
        el?.pause();
        finish?.();
      },
      setVolume: () => {
        if (el) el.volume = mixVolume("narracao", base);
      },
    };
    this.enqueue(job);
  }

  /** Fala qualquer (narrador ao vivo): quem chama toca e avisa quando terminou. */
  voice(job: VoiceJob) {
    this.enqueue(job);
  }

  /** Nova narração interrompe a anterior (a história andou) e limpa a fila de alertas velhos. */
  interruptWith(job: VoiceJob) {
    this.queue = [];
    if (this.nextVoiceTimer) clearTimeout(this.nextVoiceTimer);
    this.nextVoiceTimer = null;
    this.current?.stop();
    this.current = null;
    this.enqueue(job);
  }

  stopVoices() {
    this.queue = [];
    if (this.nextVoiceTimer) clearTimeout(this.nextVoiceTimer);
    this.nextVoiceTimer = null;
    this.current?.stop();
    this.current = null;
    useMixer.getState().setVoiceActive(false);
  }

  private enqueue(job: VoiceJob) {
    if (!this.enabled) return;
    if (job.priority === "alerta" && (this.current || this.queue.length)) return; // não empilha alertas
    this.queue.push(job);
    if (!this.current && !this.nextVoiceTimer) void this.next();
  }

  private async next() {
    const job = this.queue.shift();
    if (!job) {
      this.current = null;
      useMixer.getState().setVoiceActive(false);
      return;
    }
    this.current = job;
    useMixer.getState().setVoiceActive(true);
    try {
      await job.run();
    } finally {
      if (this.current === job) {
        this.current = null;
        // Pequena pausa entre falas, como numa conversa.
        this.nextVoiceTimer = setTimeout(() => {
          this.nextVoiceTimer = null;
          if (!this.current) void this.next();
        }, 350);
      }
    }
  }

  // ── Fundo (um só) ──────────────────────────────────────────────────────────
  setBed(sound: string | null, base = 1, cat: AudioCategory = "ambiente") {
    if (!this.enabled) sound = null;
    const old = this.bed;
    if (old && old.sound === sound) {
      old.base = base;
      old.cat = cat;
      if (!old.el.paused) fade(old.el, mixVolume(cat, base), 350, () => { old.fading = false; });
      return;
    }
    if (old) {
      old.fading = true;
      fade(old.el, 0, BED_FADE_OUT_MS, () => old.el.pause());
    }
    this.bed = null;
    if (!sound) return;
    const el = new Audio(sfxUrl(sound));
    el.loop = true;
    el.volume = 0;
    const bed = { sound, el, base, cat, fading: true };
    this.bed = bed;
    el.onerror = () => {
      const fallback = localAudioFallback(el.src);
      if (!fallback || this.bed !== bed) return;
      const local = new Audio(fallback);
      local.loop = true;
      local.volume = 0;
      bed.el = local;
      void local.play().then(() => fade(local, mixVolume(cat, base), BED_FADE_IN_MS, () => { bed.fading = false; })).catch(() => undefined);
    };
    void el.play().then(() => fade(el, mixVolume(cat, base), BED_FADE_IN_MS, () => { bed.fading = false; })).catch(() => undefined);
  }

  // ── Efeitos ────────────────────────────────────────────────────────────────
  /**
   * Efeito curto. `important` fura o intervalo (chefe, morte, transformação, escolha do jogador).
   * `fallback` toca se o arquivo principal ainda não existir (som planejado e não baixado).
   */
  sting(sound: string, base = 1, opts: { important?: boolean; fadeOutAfterMs?: number; fallback?: string } = {}) {
    if (!this.enabled) return;
    if (this.missing.has(sound)) {
      if (opts.fallback) this.sting(opts.fallback, base, { ...opts, fallback: undefined });
      return;
    }
    const now = performance.now();
    if (!opts.important && now - this.lastSting < STING_GAP_MS) return;
    if (!opts.important && this.currentSting && !this.currentSting.el.paused) return;
    this.lastSting = now;
    try {
      this.stopSting();
      const start = (source: string, allowLocalFallback: boolean) => {
        const el = new Audio(source);
        el.volume = mixVolume("efeitos", base);
        this.currentSting = { el, base };
        const clear = () => {
          if (this.currentSting?.el === el) this.currentSting = null;
        };
        el.onended = clear;
        el.onerror = () => {
          clear();
          const local = allowLocalFallback ? localAudioFallback(source) : null;
          if (local) start(local, false);
          else {
            this.missing.add(sound);
            if (opts.fallback) this.sting(opts.fallback, base, { ...opts, fallback: undefined, important: true });
          }
        };
        void el.play().catch(clear);
        if (opts.fadeOutAfterMs) setTimeout(() => fade(el, 0, 1500, () => { el.pause(); clear(); }), opts.fadeOutAfterMs);
      };
      start(sfxUrl(sound), true);
    } catch {
      /* áudio é enfeite, nunca quebra o jogo */
    }
  }

  stopSting() {
    this.currentSting?.el.pause();
    this.currentSting = null;
  }

  stopAll() {
    this.stopVoices();
    this.setBed(null);
    this.stopSting();
  }
}

type G = typeof globalThis & { __lsAudioDirector?: AudioDirector };

/** Um diretor por aba (sobrevive a trocas de página do Next). */
export function audioDirector(): AudioDirector {
  const g = globalThis as G;
  g.__lsAudioDirector ??= new AudioDirector();
  return g.__lsAudioDirector;
}
