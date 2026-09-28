"use client";
/** Recursos de celular: vibração no dado e tela acesa enquanto a história está aberta. */
import { useEffect } from "react";

export const HAPTIC = {
  roll: [18, 40, 18, 40, 18],
  criticalSuccess: [40, 60, 120],
  criticalFailure: [220],
} as const;

/** Vibra se o aparelho suportar (Android); no iPhone e no PC não faz nada. */
export function vibrate(pattern: readonly number[]): void {
  try {
    navigator.vibrate?.([...pattern]);
  } catch {
    /* sem vibração: tudo bem */
  }
}

/**
 * Impede a tela de apagar no meio da leitura/narração. O navegador solta o bloqueio quando a
 * aba some; ele é pedido de novo quando o jogo volta a ficar visível.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      if (document.visibilityState !== "visible" || lock) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release();
        else {
          lock = next;
          next.addEventListener("release", () => { if (lock === next) lock = null; });
        }
      } catch {
        /* bateria fraca ou permissão negada: segue sem bloqueio */
      }
    };
    void request();
    document.addEventListener("visibilitychange", request);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
      lock = null;
    };
  }, [active]);
}
