"use client";
import Image from "next/image";
import type { ReactNode } from "react";
import { Brand } from "./ui";
import { mixVolume } from "./audioMixer";

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <section className="auth-art" aria-label="Vale Silente durante a tempestade">
        <Image
          className="auth-art-image"
          src="/art/vale-silente/landing-hero.webp"
          alt=""
          fill
          priority
          sizes="(max-width: 860px) 100vw, 58vw"
        />
        <div className="auth-art-atmosphere" aria-hidden="true" />
        <div className="auth-art-text">
          <div className="auth-art-kicker">
            <span>TRANSMISSÃO 074</span>
            <i aria-hidden="true" />
            <span>23:40</span>
          </div>
          <h2>O vale lembra<br />quem tentou fugir.</h2>
          <p>
            O avião caiu. O piloto desapareceu. Na frequência morta, uma mulher repete três números há vinte e oito anos.
          </p>
          <div className="auth-transmission">
            <span className="auth-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
            <blockquote>“Sete… quatro… zero…”</blockquote>
            <button
              type="button"
              onClick={() => {
                const audio = new Audio('/audio/sistema/intro-quote-1.mp3');
                audio.volume = mixVolume("narracao", 0.5);
                void audio.play().catch(() => undefined);
              }}
              className="auth-audio"
              title="Ouvir transmissão"
            >
              <span aria-hidden="true">▶</span> OUVIR
            </button>
          </div>
        </div>
      </section>
      <section className="auth-form">
        <div className="auth-card stack-lg">
          <div className="auth-brand"><Brand /></div>
          <div className="auth-heading">
            <span>ACESSO À CAMPANHA</span>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {children}
          <p className="auth-footnote">A escuridão escuta. Use fones de ouvido.</p>
        </div>
      </section>
    </div>
  );
}
