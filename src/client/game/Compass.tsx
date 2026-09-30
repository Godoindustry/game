"use client";
/**
 * Objetivo no HUD: mostra a próxima etapa da crônica e abre as rotas narrativas.
 * Uma necessidade urgente do corpo (sangramento, frio, sede…) tem prioridade.
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
  const progress = obj ? Math.round(((obj.stepIndex + 1) / Math.max(1, obj.totalSteps)) * 100) : 0;

  return (
    <div className="compass-wrap" ref={ref} data-tut-id="compass">
      <button
        className={`compass ${urgent ? "compass-urgent" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Objetivo: ${urgent?.label ?? obj?.label}`}
      >
        <span className="compass-dial" aria-hidden="true">
          <i className="compass-dial-ring" />
          <i className="compass-north">N</i>
          {urgent ? (
            <span className="compass-alert-mark">!</span>
          ) : angle !== null ? (
            <span className="compass-needle" style={{ transform: `rotate(${angle}deg)` }}><i /></span>
          ) : (
            <span className="compass-target-mark">{atTarget ? "◎" : "✦"}</span>
          )}
        </span>
        <span className="compass-text">
          <span className="compass-kicker">{urgent ? "Urgente" : `Objetivo ${obj!.stepIndex + 1}/${obj!.totalSteps}`}</span>
          <span className="compass-label">{urgent?.label ?? obj!.label}</span>
          {!urgent && obj && (
            <span className="compass-mini-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
          )}
        </span>
        <span className="compass-open-mark" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="compass-pop panel" role="dialog" aria-label="Objetivo atual">
          <div className="compass-pop-head">
            <span>
              <i aria-hidden="true" />
              ORIENTAÇÃO
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fechar objetivo">×</button>
          </div>
          {urgent && (
            <div className={`compass-urgent-card ${obj ? "has-objective" : ""}`}>
              <span className="compass-urgent-icon" aria-hidden="true">!</span>
              <span>
                <small>ATENÇÃO IMEDIATA</small>
                <strong>{urgent.label}</strong>
                <p>{urgent.hint}</p>
              </span>
            </div>
          )}
          {obj && (
            <div className="compass-objective-card">
              <div className="compass-route-title">
                <span>ROTA ATIVA</span>
                <b>{progress}%</b>
              </div>
              <strong className="compass-route-name">{obj.routeTitle}</strong>
              <div className="compass-current-step">
                <i>{String(obj.stepIndex + 1).padStart(2, "0")}</i>
                <span>
                  <small>PRÓXIMO PASSO</small>
                  <b>{obj.label}</b>
                  <p>{obj.hint}</p>
                </span>
              </div>
              <div className="compass-steps" aria-label={`Etapa ${obj.stepIndex + 1} de ${obj.totalSteps}`}>
                {Array.from({ length: obj.totalSteps }, (_, i) => (
                  <span key={i} className={i < obj.stepIndex ? "done" : i === obj.stepIndex ? "now" : ""}>
                    <i>{i < obj.stepIndex ? "✓" : i + 1}</i>
                  </span>
                ))}
              </div>
              {obj.targetName && (
                atTarget ? (
                  <div className="compass-destination is-here">
                    <span aria-hidden="true">◎</span>
                    <span><small>VOCÊ ESTÁ AQUI</small><b>{obj.targetName}</b></span>
                  </div>
                ) : obj.targetOnMap ? (
                  <button className="compass-destination" onClick={() => { onShow(obj.targetLocationId!); setOpen(false); }}>
                    <span aria-hidden="true">⌖</span>
                    <span><small>DESTINO</small><b>{obj.targetName}</b></span>
                    <i>VER ROTA →</i>
                  </button>
                ) : (
                  <div className="compass-destination is-locked">
                    <span aria-hidden="true">◇</span>
                    <span><small>DESTINO A REVELAR</small><b>{obj.targetName}</b><em>Suas decisões abrem o caminho.</em></span>
                  </div>
                )
              )}
              {obj.others.length > 0 && (
                <div className="compass-other-routes">
                  <span>OUTRAS SAÍDAS</span>
                  {obj.others.map((o) => (
                    <div key={o.title}><b>{o.title}</b><small>{o.done}/{o.total}</small></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
