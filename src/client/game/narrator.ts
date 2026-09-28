"use client";
/**
 * Voz do narrador. Primeiro tenta a voz real do servidor (ElevenLabs v3, que interpreta
 * [sighs], [laughs], [whispers]…); se não houver chave, a cota acabar ou a rede falhar,
 * usa a voz do navegador — com as tags REMOVIDAS (senão ela leria "sighs" em voz alta)
 * e com pausas nos lugares de [pause]/[long pause].
 *
 * Toda fala passa pelo diretor de áudio: uma de cada vez, e o resto abaixa enquanto ela dura.
 */
import { stripVoiceTags } from "@/shared/voiceTags";
import { mixVolume } from "../audioMixer";
import { audioDirector } from "./audioDirector";

let serverOff = false; // servidor respondeu "sem narrador": não insiste nesta sessão

export function stopNarration(): void {
  audioDirector().stopVoices();
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Narra uma linha do diário. Uma linha nova interrompe a anterior (a história andou). */
export function narrate(campaignId: string, logId: number, text: string, volume = 1): void {
  let el: HTMLAudioElement | null = null;
  let url: string | null = null;
  let cancelled = false;
  const releaseUrl = () => {
    if (!url) return;
    URL.revokeObjectURL(url);
    url = null;
  };
  audioDirector().interruptWith({
    priority: "narracao",
    stop: () => {
      cancelled = true;
      el?.pause();
      releaseUrl();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    run: async () => {
      if (!serverOff) {
        try {
          const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/log/${logId}/voice`, { credentials: "same-origin" });
          if (cancelled) return;
          if (res.ok) {
            url = URL.createObjectURL(await res.blob());
            if (cancelled) {
              releaseUrl();
              return;
            }
            el = new Audio(url);
            el.volume = mixVolume("narracao", volume);
            await new Promise<void>((resolve) => {
              el!.onended = () => resolve();
              el!.onerror = () => resolve();
              void el!.play().catch(() => resolve());
            });
            releaseUrl();
            return;
          }
          if (res.status === 503) serverOff = true;
        } catch {
          /* rede ou autoplay bloqueado: voz do navegador */
        }
      }
      if (!cancelled) await browserVoice(text, volume);
    },
    setVolume: () => {
      if (el) el.volume = mixVolume("narracao", volume);
    },
  });
}

function browserVoice(text: string, volume: number): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  const voice = voices.find((v) => v.lang.toLowerCase() === "pt-br") ?? voices.find((v) => v.lang.toLowerCase().startsWith("pt")) ?? null;
  // Cada [pause]/[long pause] vira um corte: frases separadas soam como pausa.
  const parts = text.split(/\[(?:long )?pause\]/i).map(stripVoiceTags).map((s) => s.replace(/[【】]/g, "").trim()).filter(Boolean);
  if (!parts.length) return Promise.resolve();
  return new Promise((resolve) => {
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.voice = voice;
      u.lang = "pt-BR";
      u.rate = 0.86;
      u.pitch = 0.7; // grave, sombrio
      u.volume = mixVolume("narracao", volume);
      if (i === parts.length - 1) {
        u.onend = () => resolve();
        u.onerror = () => resolve();
      }
      synth.speak(u);
    });
  });
}
