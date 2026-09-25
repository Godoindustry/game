"use client";
/**
 * Bússola de objetivo no HUD: aponta do local atual para o próximo alvo da rota
 * de fuga. Uma necessidade urgente do corpo (sangramento, frio, sede…) tem prioridade.
 */
import { useEffect, useRef, useState } from "react";
import type { GameState } from "./useGame";

export function ObjectiveCompass({ state, onShow }: { state: GameState; onShow: (locationId: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { objective: obj, urgent } = state;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!obj && !urgent) return null;

  const atTarget = !!obj?.targetLocationId && obj.targetLocationId === state.here.locationId;
  // Coordenadas do mapa em %; y cresce para baixo, a agulha "▲" aponta para o norte.
  const b = obj?.bearing;
  const angle = b ? (Math.atan2(b.to.y - b.from.y, b.to.x - b.from.x) * 180) / Math.PI + 90 : null;

  return (
    <div className="compass-wrap" ref={ref} data-tut-id="compass">
      <button
        className={`compass ${urgent ? "compass-urgent" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Objetivo: ${urgent?.label ?? obj?.label}`}
      >
        <span className="compass-dial" aria-hidden="true">
          {urgent ? "!" : angle !== null ? <span className="compass-needle" style={{ transform: `rotate(${angle}deg)` }}>▲</span> : atTarget ? "◎" : "✦"}
        </span>
        <span className="compass-text">
          <span className="compass-kicker">{urgent ? "Urgente" : `Objetivo ${obj!.stepIndex + 1}/${obj!.totalSteps}`}</span>
          <span className="compass-label">{urgent?.label ?? obj!.label}</span>
        </span>
      </button>

      {open && (
        <div className="compass-pop panel" role="dialog" aria-label="Objetivo atual">
          {urgent && (
            <div className="stack-sm" style={{ marginBottom: obj ? 12 : 0 }}>
              <span className="label" style={{ color: "var(--red-2)" }}>Agora</span>
              <strong>{urgent.label}</strong>
              <span className="small muted">{urgent.hint}</span>
            </div>
          )}
          {obj && (
            <div className="stack-sm">
              <span className="label amber">Rota · {obj.routeTitle}</span>
              <strong>{obj.label}</strong>
              <span className="small muted">{obj.hint}</span>
              <div className="compass-steps" aria-label={`Etapa ${obj.stepIndex + 1} de ${obj.totalSteps}`}>
                {Array.from({ length: obj.totalSteps }, (_, i) => (
                  <span key={i} className={i < obj.stepIndex ? "done" : i === obj.stepIndex ? "now" : ""} />
                ))}
              </div>
              {obj.targetName && (
                atTarget ? (
                  <span className="tiny green">◎ Você está em {obj.targetName}.</span>
                ) : obj.targetOnMap ? (
                  <button className="btn btn-sm" onClick={() => { onShow(obj.targetLocationId!); setOpen(false); }}>
                    Mostrar {obj.targetName} no mapa
                  </button>
                ) : (
                  <span className="tiny muted">Destino: {obj.targetName}. Siga a agulha — o caminho aparece conforme você explora.</span>
                )
              )}
              {obj.others.map((o) => (
                <span key={o.title} className="tiny muted">Outra saída: {o.title} ({o.done}/{o.total})</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
