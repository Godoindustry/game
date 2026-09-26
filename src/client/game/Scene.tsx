"use client";
/**
 * Cenas: recorte "de câmera" do mapa em volta de um local, em pixel art de
 * celular antigo (PixelCanvas), com luz do horário, chuva, névoa e fogo —
 * sem assets extras, só a arte do mapa + CSS.
 * Também o texto em máquina de escrever dos eventos.
 */
import { useEffect, useState } from "react";
import { PixelCanvas } from "./PixelCanvas";

export type DayPhase = "dawn" | "day" | "dusk" | "night";

/** Fase do dia pelo relógio "HH:MM" (noite 18h30–5h45, igual ao motor). */
export function dayPhase(clock: string): DayPhase {
  const [h, m] = clock.split(":").map(Number);
  const t = (h || 0) * 60 + (m || 0);
  if (t >= 18 * 60 + 30 || t < 5 * 60 + 45) return "night";
  if (t < 7 * 60 + 30) return "dawn";
  if (t >= 17 * 60) return "dusk";
  return "day";
}

export function LocationScene({
  image, x, y, phase, rain, fire, danger, caption, compact,
}: {
  image: string;
  x: number;
  y: number;
  phase: DayPhase;
  rain?: boolean;
  fire?: boolean;
  danger?: boolean;
  caption?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`scene scene-${phase} ${compact ? "scene-compact" : ""} ${danger ? "scene-danger" : ""}`}
      aria-hidden="true"
    >
      <div className="scene-img">
        <PixelCanvas
          src={image}
          width={compact ? 168 : 192}
          height={compact ? 48 : 80}
          crop={{ x: x / 100, y: y / 100, w: compact ? 0.24 : 0.19 }}
          phase={phase}
        />
      </div>
      {fire && <div className="scene-fire" style={{ left: `${x}%`, top: `${y}%` }} />}
      <div className="scene-grade" />
      <div className="scene-fog" />
      {rain && <div className="scene-rain" />}
      <div className="scene-vignette" />
      {caption && <div className="scene-caption">{caption}</div>}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Revela o texto aos poucos. Remonte com `key` para reiniciar.
 * Clique para mostrar tudo. Leitores de tela recebem o texto inteiro de uma vez.
 */
export function Typewriter({ text, cps = 70 }: { text: string; cps?: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text.length : 0));
  const done = shown >= text.length;

  useEffect(() => {
    if (done) return;
    const step = Math.max(1, Math.round(cps / 30));
    const t = setInterval(() => setShown((n) => Math.min(text.length, n + step)), 1000 / 30);
    return () => clearInterval(t);
  }, [done, text.length, cps]);

  return (
    <span className="typewriter" onClick={() => setShown(text.length)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, shown)}
        {!done && <span className="tw-caret">▍</span>}
      </span>
    </span>
  );
}

/** Props de cena para um local do estado do jogo (ou nulo se o local não estiver no mapa). */
export function sceneProps(
  state: {
    campaign: { clock: string; weather: string };
    map: { image: string; locations: { id: string; name: string; x: number; y: number; fire: boolean; danger: number }[] };
  },
  locationId: string,
) {
  const l = state.map.locations.find((x) => x.id === locationId);
  if (!l) return null;
  return {
    image: state.map.image,
    x: l.x,
    y: l.y,
    phase: dayPhase(state.campaign.clock),
    rain: state.campaign.weather === "chuva",
    fire: l.fire,
    danger: l.danger >= 3,
    caption: l.name,
  };
}
