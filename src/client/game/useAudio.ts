"use client";
/**
 * Liga o motor de som ao estado da campanha: clima → chuva/vento,
 * saúde < 20 → batimento, cliques em botões → bipe, novo evento → alerta.
 */
import { useCallback, useEffect, useState } from "react";
import { sound } from "./audio";
import type { GameState } from "./useGame";

const KEY = "ls.audio";

function readPref(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function useAudio(state: GameState | null) {
  const [enabled, setEnabled] = useState(true);

  // Preferência salva + desbloqueio no primeiro gesto + bipe nos botões do jogo.
  useEffect(() => {
    const on = readPref();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage só existe no cliente
    setEnabled(on);
    sound.setMuted(!on);
    const unlock = () => sound.unlock();
    const click = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest("button, a.btn, [role=button]");
      if (btn && !(btn as HTMLButtonElement).disabled && btn.closest(".game")) sound.beep("click");
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      document.removeEventListener("click", click);
      sound.dispose();
    };
  }, []);

  const me = state?.me;
  const ended = !state || state.campaign.status === "finished" || !me?.alive;
  const raining = state?.campaign.weather === "chuva";
  const covered = !!state && (state.here.indoor || state.here.sheltered);
  const night = !!state?.campaign.night;
  const cold = (state?.campaign.temperature ?? 20) < 8;

  useEffect(() => {
    if (!state) return;
    const rain = raining ? (covered ? 0.35 : 1) : 0;
    const wind = (state.here.indoor ? 0.1 : covered ? 0.3 : 0.55) * (night ? 1 : 0.6) * (cold ? 1.25 : 1) * (ended ? 0.5 : 1);
    sound.setAmbient(rain, Math.min(1, wind));
  }, [state, raining, covered, night, cold, ended]);

  // Batimento: começa em 20 de saúde e cresce até 0 (mais alto e mais rápido).
  const health = me?.health.health ?? 100;
  useEffect(() => {
    sound.setHeartbeat(!ended && health < 20 ? 0.25 + 0.75 * ((20 - health) / 20) : 0);
  }, [health, ended]);

  const eventId = state?.event?.participating ? state.event.instanceId : null;
  useEffect(() => {
    if (eventId) sound.beep("alert");
  }, [eventId]);

  const toggle = useCallback(() => {
    setEnabled((v) => {
      const next = !v;
      sound.unlock();
      sound.setMuted(!next);
      try {
        localStorage.setItem(KEY, next ? "on" : "off");
      } catch {
        /* sem armazenamento: vale só nesta sessão */
      }
      return next;
    });
  }, []);

  return { enabled, toggle };
}
