"use client";
/**
 * Voz do narrador. Primeiro tenta a voz real do servidor (ElevenLabs v3, que interpreta
 * [sighs], [laughs], [whispers]…); se não houver chave, a cota acabar ou a rede falhar,
 * usa a voz do navegador — com as tags REMOVIDAS (senão ela leria "sighs" em voz alta)
 * e com pausas nos lugares de [pause]/[long pause].
 */
import { stripVoiceTags } from "@/shared/voiceTags";
import { mixVolume, onMixChange } from "../audioMixer";

// Mexer no slider de narração durante uma fala muda o volume dela na hora.
let baseVolume = 0.9;
if (typeof window !== "undefined") onMixChange(() => { if (current) current.volume = mixVolume("narracao", baseVolume); });

let current: HTMLAudioElement | null = null;
let serverOff = false; // servidor respondeu "sem narrador": não insiste nesta sessão
let token = 0;

export function stopNarration(): void {
  token++;
  current?.pause();
  current = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export async function narrate(campaignId: string, logId: number, text: string, volume = 0.9): Promise<void> {
  stopNarration();
  baseVolume = volume;
  const mine = token;
  if (!serverOff) {
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/log/${logId}/voice`, { credentials: "same-origin" });
      if (mine !== token) return;
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        if (mine !== token) return URL.revokeObjectURL(url);
        const audio = new Audio(url);
        audio.volume = mixVolume("narracao", volume);
        audio.onended = () => URL.revokeObjectURL(url);
        current = audio;
        await audio.play();
        return;
      }
      if (res.status === 503) serverOff = true;
    } catch {
      /* rede ou autoplay bloqueado: voz do navegador */
    }
  }
  if (mine === token) browserVoice(text, volume);
}

function browserVoice(text: string, volume: number) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  const voice = voices.find((v) => v.lang.toLowerCase() === "pt-br") ?? voices.find((v) => v.lang.toLowerCase().startsWith("pt")) ?? null;
  // Cada [pause]/[long pause] vira um corte: frases separadas soam como pausa.
  const parts = text.split(/\[(?:long )?pause\]/i).map(stripVoiceTags).map((s) => s.replace(/[【】]/g, "").trim()).filter(Boolean);
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p);
    u.voice = voice;
    u.lang = "pt-BR";
    u.rate = 0.86;
    u.pitch = 0.7; // grave, sombrio
    u.volume = mixVolume("narracao", volume);
    synth.speak(u);
  }
}
