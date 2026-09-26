"use client";
/**
 * Filtros de tela que fazem a punição doer: analgésico embaça as bordas,
 * sono extremo "pisca em preto", saúde baixa pulsa em vermelho, hipotermia gela as bordas,
 * estresse extremo fecha a visão num túnel que respira.
 * Tudo é decorativo (pointer-events: none) e respeita prefers-reduced-motion no CSS.
 */
import type { GameState } from "./useGame";

export function ScreenFx({ me }: { me: GameState["me"] }) {
  if (!me?.alive) return null;
  const fx: string[] = [];
  if (me.health.painkillerActive) fx.push("fx-blur");
  if (me.status.fatigue > 90) fx.push("fx-blink");
  if (me.health.health < 20) fx.push("fx-lowhp");
  if (me.status.bodyTemp < 35) fx.push("fx-cold");
  if (me.status.stress > 80) fx.push("fx-stress");
  return (
    <>
      {fx.map((c) => (
        <div key={c} className={`fx ${c}`} aria-hidden="true" />
      ))}
    </>
  );
}
