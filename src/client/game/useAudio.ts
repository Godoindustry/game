"use client";
/**
 * useAudio — gerenciador de áudio S-OS v1.4
 *
 * Catálogo de IDs:
 *   intro-quote-1..4    → tela de entrada (aleatório)
 *   hud-alert-*         → alertas críticos do HUD
 *   event-*             → narração de eventos
 *   npc-desconhecido-*  → falas de NPC
 *   death-1, death-fome, death-hipotermia, death-ferimento
 *   victory-1, victory-radio
 *   action-*            → feedback de ações
 */

import { useCallback, useEffect, useRef, useState } from "react";

const AUDIO_BASE = "/audio";

// Catálogo completo de IDs de arquivo
export const SFX = {
  // Tela inicial — pick aleatório
  INTRO: ["intro-quote-1", "intro-quote-2", "intro-quote-3", "intro-quote-4"] as const,

  // Alertas HUD
  ALERT_FOME:       "hud-alert-fome",
  ALERT_SEDE:       "hud-alert-sede",
  ALERT_SANGUE:     "hud-alert-sangue",
  ALERT_HIPOTERMIA: "hud-alert-hipotermia",

  // Eventos narrativos
  EVENT_RASTROS:  "event-rastros",
  EVENT_RADIO:    "event-radio",
  EVENT_FOGUEIRA: "event-fogueira",
  EVENT_ABRIGO:   "event-abrigo",
  EVENT_NOITE:    "event-noite",

  // NPC
  NPC_DESCONHECIDO_1: "npc-desconhecido-1",
  NPC_DESCONHECIDO_2: "npc-desconhecido-2",

  // Morte — mapeado por causa
  DEATH_DEFAULT:    "death-1",
  DEATH_FOME:       "death-fome",
  DEATH_HIPOTERMIA: "death-hipotermia",
  DEATH_FERIMENTO:  "death-ferimento",

  // Vitória
  VICTORY:       "victory-1",
  VICTORY_RADIO: "victory-radio",

  // Ações
  ACTION_COLETANDO:   "action-coletando",
  ACTION_TRATANDO:    "action-tratando",
  ACTION_DESCANSANDO: "action-descansando",
} as const;

// ──────────────────────────────────────────────────────────────────────────
export function useAudio(volume = 0.55) {
  const currentRef = useRef<HTMLAudioElement | null>(null);
  const [enabled, setEnabled] = useState(true);

  const play = useCallback((id: string, opts?: { vol?: number; loop?: boolean }) => {
    try {
      if (currentRef.current) {
        currentRef.current.pause();
        currentRef.current.currentTime = 0;
      }
      const audio = new Audio(`${AUDIO_BASE}/${id}.mp3`);
      audio.volume = opts?.vol ?? volume;
      audio.loop   = opts?.loop ?? false;
      currentRef.current = audio;
      audio.play().catch(() => { /* autoplay bloqueado — silencioso */ });
    } catch {
      // silencioso — áudio é enhancement, não feature crítica
    }
  }, [volume]);

  const stop = useCallback(() => {
    if (currentRef.current) {
      currentRef.current.pause();
      currentRef.current.currentTime = 0;
    }
  }, []);

  const playRandom = useCallback((ids: readonly string[], opts?: { vol?: number }) => {
    const id = ids[Math.floor(Math.random() * ids.length)];
    play(id, opts);
  }, [play]);

  const toggle = useCallback(() => {
    setEnabled((v) => {
      const next = !v;
      if (!next) stop();
      return next;
    });
  }, [stop]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { play, stop, playRandom, toggle, enabled };
}

// ──────────────────────────────────────────────────────────────────────────
// Toca alertas de saúde automaticamente ao mudar estado do personagem
export function useHealthAudio(
  me: {
    alive: boolean;
    health: { health: number };
    status: { thirst: number; bodyTemp: number };
    wounds: { bleedingRate: number }[];
  } | null | undefined
) {
  const { play } = useAudio(0.5);
  const prevAlert = useRef<string | null>(null);

  useEffect(() => {
    if (!me?.alive) return;

    let alert: string | null = null;
    if (me.wounds.some((w) => w.bleedingRate > 0)) alert = SFX.ALERT_SANGUE;
    else if (me.status.bodyTemp < 35)               alert = SFX.ALERT_HIPOTERMIA;
    else if (me.status.thirst > 85)                 alert = SFX.ALERT_SEDE;
    else if (me.health.health < 20)                 alert = SFX.ALERT_FOME;

    if (alert && alert !== prevAlert.current) play(alert, { vol: 0.5 });
    prevAlert.current = alert;
  }, [me, play]);
}

// ──────────────────────────────────────────────────────────────────────────
// Escolhe o áudio de morte baseado na causa
export function deathAudioId(cause?: string): string {
  if (!cause) return SFX.DEATH_DEFAULT;
  const lc = cause.toLowerCase();
  if (lc.includes("fome") || lc.includes("inanição"))    return SFX.DEATH_FOME;
  if (lc.includes("frio") || lc.includes("hipotermia"))  return SFX.DEATH_HIPOTERMIA;
  if (lc.includes("sangue") || lc.includes("ferimento")) return SFX.DEATH_FERIMENTO;
  return SFX.DEATH_DEFAULT;
}
