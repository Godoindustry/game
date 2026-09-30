"use client";

import { mixVolume } from "../audioMixer";
import { audioDirector } from "./audioDirector";
import { localAudioFallback } from "./mediaBase";
import { cachedVoice, storeVoice } from "./voiceCache";

export const VOICE_STATUS_EVENT = "vale-silente:voice-status";

export interface VoiceStatus {
  available: boolean;
  message: string | null;
}

export interface NarrationItem {
  logId: number;
}

/** Uma fala pode vir em partes (narração gerada divide textos longos): tocam em sequência. */
interface LoadedVoice {
  blobs: Blob[];
}

const AUDIO_TYPE = /audio\/(?:wav|wave|x-wav|mpeg|mp3)/i;
const PLAYBACK_STALL_TIMEOUT_MS = 12_000;

async function audioBlob(response: Response): Promise<Blob> {
  const blob = await response.blob();
  if (!blob.size || !AUDIO_TYPE.test(blob.type || response.headers.get("content-type") || "")) {
    throw new Error("O servidor devolveu um áudio de voz inválido. A conversa continua em texto.");
  }
  return blob;
}

/** Busca no Storage/CDN e tenta a cópia empacotada se o objeto externo ainda não chegou. */
async function fetchAudio(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.ok) return response;
  const fallback = localAudioFallback(response.url || url);
  return fallback ? fetch(fallback, init) : response;
}

/** null = a cena não tem voz (fica só em texto, sem aviso). */
const requests = new Map<string, Promise<LoadedVoice | null>>();

function announce(status: VoiceStatus): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<VoiceStatus>(VOICE_STATUS_EVENT, { detail: status }));
}

function requestKey(campaignId: string, logId: number): string {
  return `${campaignId}:${logId}`;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Resposta sem JSON: usa mensagem estável abaixo.
  }
  return response.status === 429
    ? "As vozes atingiram a cota temporária. A conversa continua em texto."
    : "A voz da cena está indisponível. A conversa continua em texto.";
}

async function fetchVoice(campaignId: string, logId: number): Promise<LoadedVoice | null> {
  const key = requestKey(campaignId, logId);
  const cached = await cachedVoice(key);
  if (cached) return { blobs: [cached] };

  const response = await fetchAudio(`/api/campaigns/${encodeURIComponent(campaignId)}/log/${logId}/voice`, {
    credentials: "same-origin",
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(await errorMessage(response));
  if (/json/i.test(response.headers.get("content-type") ?? "")) {
    const { parts } = await response.json() as { parts?: string[] };
    if (!parts?.length) return null;
    const blobs = await Promise.all(parts.map(async (url) => {
      const part = await fetchAudio(url);
      if (!part.ok) throw new Error("A voz da cena está indisponível. A conversa continua em texto.");
      return audioBlob(part);
    }));
    return { blobs };
  }
  const blob = await audioBlob(response);
  // Só a voz sintetizada (Gemini) vai para o IndexedDB; arquivos estáticos já ficam no cache HTTP.
  const audioKey = response.headers.get("x-voice-cache-key");
  if (audioKey) await storeVoice(key, audioKey, blob);
  return { blobs: [blob] };
}

export function preloadNarration(campaignId: string, logId: number): Promise<LoadedVoice | null> {
  const key = requestKey(campaignId, logId);
  const active = requests.get(key);
  if (active) return active;
  const pending = fetchVoice(campaignId, logId);
  requests.set(key, pending);
  void pending.finally(() => {
    if (requests.get(key) === pending) requests.delete(key);
  }).catch(() => undefined);
  return pending;
}

function settledVoice(campaignId: string, logId: number) {
  return preloadNarration(campaignId, logId).then(
    (voice) => ({ voice, error: null as Error | null }),
    (error: unknown) => ({ voice: null, error: error instanceof Error ? error : new Error(String(error)) }),
  );
}

export function stopNarration(): void {
  audioDirector().stopVoices();
}

/**
 * Toca em ordem. Enquanto a fala atual está sendo reproduzida, a seguinte já
 * está sendo buscada ou lida do IndexedDB, evitando silêncio entre personagens.
 */
export function narrateSequence(campaignId: string, items: NarrationItem[], volume = 1): void {
  if (!items.length) return;
  let currentAudio: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;
  let finishPlayback: (() => void) | null = null;
  let cancelled = false;

  const release = () => {
    currentAudio?.pause();
    finishPlayback?.();
    finishPlayback = null;
    currentAudio = null;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  };

  const playBlob = (blob: Blob) => new Promise<void>((resolve) => {
    currentUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentUrl);
    currentAudio = audio;
    audio.volume = mixVolume("narracao", volume);
    let settled = false;
    let retryArmed = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };
    const disarmRetry = () => {
      if (!retryArmed) return;
      retryArmed = false;
      window.removeEventListener("pointerdown", retryOnGesture, true);
      window.removeEventListener("keydown", retryOnGesture, true);
    };
    const armRetry = () => {
      if (retryArmed) return;
      retryArmed = true;
      window.addEventListener("pointerdown", retryOnGesture, true);
      window.addEventListener("keydown", retryOnGesture, true);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearStall();
      disarmRetry();
      document.removeEventListener("visibilitychange", retryWhenVisible);
      window.removeEventListener("pageshow", retryWhenVisible);
      finishPlayback = null;
      resolve();
    };
    const tryPlay = () => {
      if (settled || cancelled || (!audio.paused && !audio.ended)) return;
      try {
        void audio.play().catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "NotAllowedError") armRetry();
          else finish();
        });
      } catch {
        finish();
      }
    };
    // Celular bloqueia som antes do primeiro toque: a fala espera o próximo toque.
    // A mesma retomada cobre Android/iOS depois de bloquear a tela ou trocar de app.
    function retryOnGesture() {
      disarmRetry();
      tryPlay();
    }
    function retryWhenVisible() {
      if (document.visibilityState !== "hidden") tryPlay();
      else clearStall();
    }
    const watchStall = () => {
      if (document.visibilityState === "hidden") return;
      clearStall();
      // Um blob preso não pode segurar para sempre todas as próximas falas da fila.
      stallTimer = setTimeout(finish, PLAYBACK_STALL_TIMEOUT_MS);
    };
    finishPlayback = finish;
    audio.onended = finish;
    audio.onplaying = clearStall;
    audio.ontimeupdate = clearStall;
    audio.onwaiting = watchStall;
    audio.onstalled = watchStall;
    audio.onpause = () => {
      if (!settled && !cancelled && !audio.ended) armRetry();
    };
    audio.onerror = () => {
      announce({ available: false, message: "Não foi possível reproduzir a voz. A fala permanece em texto." });
      finish();
    };
    document.addEventListener("visibilitychange", retryWhenVisible);
    window.addEventListener("pageshow", retryWhenVisible);
    tryPlay();
  });

  audioDirector().interruptWith({
    priority: "narracao",
    stop: () => {
      cancelled = true;
      release();
    },
    run: async () => {
      let next = settledVoice(campaignId, items[0].logId);
      for (let index = 0; index < items.length && !cancelled; index++) {
        const loaded = await next;
        // Pré-carrega a próxima antes de começar a reprodução da atual.
        if (index + 1 < items.length) next = settledVoice(campaignId, items[index + 1].logId);
        if (loaded.error) {
          announce({ available: false, message: loaded.error.message });
          continue;
        }
        if (!loaded.voice) continue; // cena sem gravação correspondente: só texto

        announce({ available: true, message: null });
        // Partes da mesma fala tocam emendadas, sem a pausa entre falas do diretor.
        for (const blob of loaded.voice.blobs) {
          if (cancelled) break;
          await playBlob(blob);
          release();
        }
      }
    },
    setVolume: () => {
      if (currentAudio) currentAudio.volume = mixVolume("narracao", volume);
    },
  });
}

export function narrate(campaignId: string, logId: number, volume = 1): void {
  narrateSequence(campaignId, [{ logId }], volume);
}
