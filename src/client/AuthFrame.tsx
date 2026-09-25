"use client";
import type { ReactNode } from "react";
import { Brand } from "./ui";

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      {/* Painel de arte lateral */}
      <section className="auth-art" aria-hidden="true">
        <div className="auth-art-text">
          {/* Coordenadas fictícias */}
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10,
            color: "rgba(126,203,133,0.5)", letterSpacing: "0.12em",
            marginBottom: 14, display: "flex", gap: 14,
          }}>
            <span>LAT -23.842°</span>
            <span>LNG -46.319°</span>
            <span>ALT 1240m</span>
          </div>
          <p className="label amber" style={{ marginBottom: 8, fontSize: 10, letterSpacing: "0.18em" }}>
            Vale Silente · 23:40
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <p className="mono small" style={{ color: "#c0ccc4", maxWidth: 380, lineHeight: 1.65, margin: 0, fontStyle: "italic", flex: 1 }}>
              &quot;sete… quatro… zero…&quot; — a voz no rádio não para. O cinto do piloto foi cortado. Ninguém sabe que você está aqui.
            </p>
            <button
              onClick={() => {
                const audio = new Audio('/audio/quote-1.mp3');
                audio.volume = 0.5;
                audio.play();
              }}
              className="btn btn-sm"
              style={{ padding: "4px 8px", fontSize: 10, background: "rgba(126,203,133,0.1)", color: "var(--green)" }}
              title="Ouvir transmissão"
            >
              ▶ ÁUDIO
            </button>
          </div>
          {/* Barras de sinal */}
          <div style={{
            marginTop: 20, display: "flex", alignItems: "center", gap: 8,
            fontFamily: "var(--font-mono)", fontSize: 10,
            color: "rgba(126,203,133,0.4)", letterSpacing: "0.1em",
          }}>
            <span>SIG</span>
            {[1, 2, 3, 4, 5].map((bar) => (
              <span key={bar} style={{
                display: "inline-block", width: 4,
                height: 4 + bar * 2.5,
                background: bar <= 2 ? "rgba(126,203,133,0.55)" : "rgba(126,203,133,0.12)",
                borderRadius: 1, verticalAlign: "bottom",
              }} />
            ))}
            <span style={{ color: "rgba(232,160,32,0.55)" }}>FRACO</span>
          </div>
        </div>
      </section>
      {/* Formulário */}
      <section className="auth-form">
        <div className="auth-card stack-lg">
          <Brand />
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="h2">{title}</h1>
            {subtitle && <p className="muted small" style={{ margin: 0 }}>{subtitle}</p>}
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
