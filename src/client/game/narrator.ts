"use client";

import { mixVolume } from "../audioMixer";
import { audioDirector } from "./audioDirector";
import { cachedVoice, storeVoice } from "./voiceCache";

export const VOICE_STATUS_EVENT = "vale-silente:voice-status";

export interface VoiceStatus {
  available: boolean;
  message: string | null;
}

export interface NarrationItem {
  logId: number;
}

interface LoadedVoice {
  blob: Blob;
}

const requests = new Map<string, Promise<LoadedVoice>>();

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

async function fetchVoice(campaignId: string, logId: number): Promise<LoadedVoice> {
  const key = requestKey(campaignId, logId);
  const cached = await cachedVoice(key);
  if (cached) return { blob: cached };

  const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/log/${logId}/voice`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const blob = await response.blob();
  if (!blob.size || !/audio\/(?:wav|wave|x-wav|mpeg|mp3)/i.test(blob.type || response.headers.get("content-type") || "")) {
    throw new Error("O servidor devolveu um áudio de voz inválido. A conversa continua em texto.");
  }
  const audioKey = response.headers.get("x-voice-cache-key") || key;
  await storeVoice(key, audioKey, blob);
  return { blob };
}

export function preloadNarration(campaignId: string, logId: number): Promise<LoadedVoice> {
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
  let cancelled = false;

  const release = () => {
    currentAudio?.pause();
    currentAudio = null;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  };

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
        if (loaded.error || !loaded.voice) {
          announce({ available: false, message: loaded.error?.message ?? "Voz indisponível." });
          continue;
        }
        announce({ available: true, message: null });
        currentUrl = URL.createObjectURL(loaded.voice.blob);
        currentAudio = new Audio(currentUrl);
        currentAudio.volume = mixVolume("narracao", volume);
        await new Promise<void>((resolve) => {
          if (!currentAudio) return resolve();
          currentAudio.onended = () => resolve();
          currentAudio.onerror = () => {
            announce({ available: false, message: "Não foi possível reproduzir a voz. A fala permanece em texto." });
            resolve();
          };
          void currentAudio.play().catch(() => {
            announce({ available: false, message: "O celular bloqueou a reprodução automática. Toque em Narrador para tentar novamente." });
            resolve();
          });
        });
        release();
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
