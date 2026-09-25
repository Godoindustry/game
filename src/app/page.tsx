import Link from "next/link";
import { Brand } from "@/client/ui";

export default function Home() {
  return (
    <div className="auth-wrap">
      <section className="auth-art" aria-hidden="true">
        <div className="auth-art-text">
          <p className="label amber">Vale Silente · 23:40</p>
          <p className="mono small" style={{ color: "#cfd8d2", maxWidth: 420 }}>
            “sete… quatro… zero…” — a voz no rádio não para. O cinto do piloto foi cortado. Ninguém sabe que você está aqui.
          </p>
        </div>
      </section>
      <section className="auth-form">
        <div className="auth-card stack-lg">
          <Brand />
          <div className="stack">
            <h1 className="h1">Cada decisão pesa.</h1>
            <p className="muted">
              Sobrevivência realista com mistério e terror psicológico. Gerencie água, frio, ferimentos e o peso da mochila.
              Cada ação leva tempo. Sozinho ou com até 4 pessoas.
            </p>
          </div>
          <div className="stack">
            <Link href="/cadastro" className="btn btn-primary btn-block">
              Criar conta
            </Link>
            <Link href="/entrar" className="btn btn-block">
              Já tenho conta
            </Link>
          </div>
          <div className="grid-3 small muted">
            <div>
              <div className="label amber">Tempo real</div>
              Examinar leva 5 min. Tratar um ferimento, 15.
            </div>
            <div>
              <div className="label amber">Consequências</div>
              A morte é permanente.
            </div>
            <div>
              <div className="label amber">Cooperativo</div>
              Convide até 3 pessoas.
            </div>
          </div>
          <p className="disclaimer">Mecânicas médicas e de sobrevivência são ficção de jogo — não são orientação real.</p>
        </div>
      </section>
    </div>
  );
}
