"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { audioDirector } from "./game/audioDirector";

export const PREGAME_MUSIC = "musica/ambient-horror";

/**
 * Mantém a mesma faixa desde a abertura do site até a entrada na partida.
 * O AudioDirector sobrevive às navegações do App Router, respeita o mixer e faz o crossfade.
 */
export function PregameMusic() {
  const pathname = usePathname();
  const isPlaying = /^\/campanha\/[^/]+\/jogar(?:\/|$)/.test(pathname);

  useEffect(() => {
    if (isPlaying) return;
    const director = audioDirector();
    director.setBed(PREGAME_MUSIC, 0.72, "musica");
    return () => {
      director.clearBed(PREGAME_MUSIC);
    };
  }, [isPlaying]);

  return null;
}
