"use client";
/**
 * useAudio — gerenciador de áudio S-OS v1.4
 *
 * public/audio é organizado por PESSOA (pasta) e SITUAÇÃO (nome do arquivo):
 *   sistema/       intro-quote-1/3, hud-alert-*, victory-1   (locutor frio)
 *   narrador/      intro-quote-2/4, event-*, action-*, victory-radio
 *   desconhecido/  npc-desconhecido-*
 *   voz-da-morte/  death-*
 * Efeitos de pessoas e criaturas (jogador, iara, mae-das-asas, lobo-de-ambar, tavares,
 * almas) e do cenário ficam em horrorAudio.ts. Créditos: public/audio/CREDITOS.md.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { audioDirector } from "./audioDirector";
import { sfxUrl } from "./mediaBase";

// Catálogo completo de IDs de arquivo
export const SFX = {
  // Tela inicial — pick aleatório
  INTRO: ["sistema/intro-quote-1", "narrador/intro-quote-2", "sistema/intro-quote-3", "narrador/intro-quote-4"] as const,

  // Alertas HUD
  ALERT_FOME:       "sistema/hud-alert-fome",
  ALERT_SEDE:       "sistema/hud-alert-sede",
  ALERT_SANGUE:     "sistema/hud-alert-sangue",
  ALERT_HIPOTERMIA: "sistema/hud-alert-hipotermia",

  // Eventos narrativos
  EVENT_RASTROS:  "narrador/event-rastros",
  EVENT_RADIO:    "narrador/event-radio",
  EVENT_FOGUEIRA: "narrador/event-fogueira",
  EVENT_ABRIGO:   "narrador/event-abrigo",
  EVENT_NOITE:    "narrador/event-noite",

  // NPC
  NPC_DESCONHECIDO_1: "desconhecido/npc-desconhecido-1",
  NPC_DESCONHECIDO_2: "desconhecido/npc-desconhecido-2",

  // Morte — mapeado por causa
  DEATH_DEFAULT:    "voz-da-morte/death-1",
  DEATH_FOME:       "voz-da-morte/death-fome",
  DEATH_HIPOTERMIA: "voz-da-morte/death-hipotermia",
  DEATH_FERIMENTO:  "voz-da-morte/death-ferimento",

  // Vitória
  VICTORY:       "sistema/victory-1",
  VICTORY_RADIO: "narrador/victory-radio",

  // Ações
  ACTION_COLETANDO:   "narrador/action-coletando",
  ACTION_TRATANDO:    "narrador/action-tratando",
  ACTION_DESCANSANDO: "narrador/action-descansando",
} as const;

// ──────────────────────────────────────────────────────────────────────────
export function useAudio(volume = 1) {
  // O diretor sobrevive às navegações do Next; o botão precisa refletir o estado real dele.
  const [enabled, setEnabled] = useState(() => audioDirector().isEnabled());

  // Toda fala gravada entra na fila de voz do diretor: uma de cada vez, o resto abaixa.
  const play = useCallback((id: string, opts?: { vol?: number; alert?: boolean }) => {
    audioDirector().voiceFile(sfxUrl(id), opts?.vol ?? volume, opts?.alert ? "alerta" : "narracao");
  }, [volume]);

  const stop = useCallback(() => audioDirector().stopVoices(), []);

  const playRandom = useCallback((ids: readonly string[], opts?: { vol?: number }) => {
    const id = ids[Math.floor(Math.random() * ids.length)];
    play(id, opts);
  }, [play]);

  const toggle = useCallback(() => {
    setEnabled((v) => {
      const next = !v;
      audioDirector().setEnabled(next);
      return next;
    });
  }, []);

  return { play, stop, playRandom, toggle, enabled };
}

// ──────────────────────────────────────────────────────────────────────────
// Toca alertas de saúde automaticamente ao mudar estado do personagem
export function useHealthAudio(
  me: {
    alive: boolean;
    health: { health: number };
    status: { hunger: number; thirst: number; bodyTemp: number };
    wounds: { bleedingRate: number }[];
  } | null | undefined
) {
  const { play } = useAudio(0.85);
  const prevAlert = useRef<string | null>(null);

  useEffect(() => {
    if (!me?.alive) return;

    let alert: string | null = null;
    if (me.wounds.some((w) => w.bleedingRate > 0)) alert = SFX.ALERT_SANGUE;
    else if (me.status.bodyTemp < 35)               alert = SFX.ALERT_HIPOTERMIA;
    else if (me.status.thirst > 85)                 alert = SFX.ALERT_SEDE;
    else if (me.status.hunger > 85)                 alert = SFX.ALERT_FOME;

    // Alerta não interrompe ninguém: se alguém já está falando, ele é descartado.
    if (alert && alert !== prevAlert.current) play(alert, { alert: true });
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
