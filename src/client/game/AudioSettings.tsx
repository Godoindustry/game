"use client";
/** Botão + painel de volume do jogador (geral, por categoria, silenciar tudo). Salvo no navegador. */
import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABEL, useMixer, type AudioCategory } from "../audioMixer";

const ORDER: AudioCategory[] = ["narracao", "efeitos", "ambiente", "musica", "participantes"];

function Slider({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="row-between small" style={{ gap: 10, flexWrap: "nowrap" }}>
      <span style={{ minWidth: 150 }}>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} style={{ flex: 1 }} />
      <span className="mono tiny muted" style={{ width: 34, textAlign: "right" }}>{Math.round(value * 100)}%</span>
    </label>
  );
}

export function AudioSettings() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { master, muted, levels, setMaster, setLevel, toggleMuted, reset } = useMixer();

  // Fecha ao clicar fora ou com Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button className="hud-icon" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Volume do jogo" title="Volume do jogo">
        {muted ? "🔇" : "🎚"}
      </button>
      {open && (
        <div className="panel stack" role="dialog" aria-label="Volume do jogo"
          style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 340, maxWidth: "calc(100vw - 32px)", zIndex: 60, gap: 10 }}>
          <div className="row-between">
            <strong>Volume</strong>
            <button className={`btn btn-sm ${muted ? "btn-primary" : ""}`} onClick={toggleMuted} aria-pressed={muted}>
              {muted ? "Ligar o som" : "Silenciar tudo"}
            </button>
          </div>
          <Slider label="Geral" value={master} onChange={setMaster} disabled={muted} />
          <hr style={{ border: 0, borderTop: "1px solid var(--line, rgba(255,255,255,0.1))", margin: 0 }} />
          {ORDER.map((cat) => (
            <Slider key={cat} label={CATEGORY_LABEL[cat]} value={levels[cat]} onChange={(v) => setLevel(cat, v)} disabled={muted} />
          ))}
          <p className="tiny muted" style={{ margin: 0 }}>
            A voz sempre fica em primeiro plano. Ambiente, música e ruídos abaixam automaticamente enquanto o narrador ou um personagem fala.
          </p>
          <button className="btn btn-sm btn-ghost" onClick={reset}>Restaurar padrão</button>
        </div>
      )}
    </div>
  );
}
