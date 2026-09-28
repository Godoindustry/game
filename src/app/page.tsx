import Image from "next/image";
import Link from "next/link";
import styles from "./home.module.css";

function RadioMark() {
  return (
    <svg className={styles.radioMark} viewBox="0 0 44 44" aria-hidden="true">
      <path d="M22 3 40 36H4L22 3Z" />
      <path d="M22 12v12m0 7v.5" />
      <path className={styles.radioWave} d="M12 19c-3 3-3 7 0 10m20-10c3 3 3 7 0 10" />
    </svg>
  );
}

const FEATURES = [
  { value: "D20", label: "Decisões e consequências reais" },
  { value: "4", label: "Sobreviventes por sala" },
  { value: "90–130", label: "Minutos por campanha" },
  { value: "AO VIVO", label: "Narrador e voz da sala" },
];

export default function Home() {
  return (
    <main className={`${styles.page} landing-root`}>
      <style>{`body::before,body::after{display:none!important}`}</style>
      <Image
        className={styles.backdrop}
        src="/art/vale-silente/landing-hero.png"
        alt="Destroços de um avião e sobreviventes sob chuva no Vale Silente"
        fill
        priority
        sizes="100vw"
      />
      <div className={styles.grade} aria-hidden="true" />
      <div className={styles.rain} aria-hidden="true" />
      <div className={styles.fog} aria-hidden="true" />

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Linha de Sobrevivência — início">
          <RadioMark />
          <span><b>Linha de</b> Sobrevivência</span>
        </Link>
        <Link className={styles.login} href="/entrar">Entrar</Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.signal}><i /> TRANSMISSÃO 074 · 23:40</div>
        <p className={styles.eyebrow}>RPG COOPERATIVO DE TERROR E SOBREVIVÊNCIA</p>
        <h1>O vale chama<br /><span>pelo seu nome.</span></h1>
        <p className={styles.lead}>
          Seu avião caiu onde nenhuma rota deveria passar. Sobreviva à noite, role o D20 e escolha o que vai deixar entrar quando o Vale Silente despertar em você.
        </p>

        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/cadastro"><span>Entrar no Vale</span><i aria-hidden="true">→</i></Link>
          <Link className={styles.secondaryAction} href="/entrar">Continuar campanha</Link>
        </div>

        <div className={styles.transmission}>
          <span className={styles.waveform} aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
          </span>
          <span><small>SINAL INTERCEPTADO</small>“Sete… quatro… zero…”</span>
        </div>
      </section>

      <section className={styles.features} aria-label="Características do jogo">
        {FEATURES.map((feature) => (
          <article key={feature.value}>
            <strong>{feature.value}</strong>
            <span>{feature.label}</span>
          </article>
        ))}
      </section>

      <div className={styles.warning} aria-hidden="true">NÃO OLHE PARA A MATA QUANDO A LUZ PISCAR</div>
    </main>
  );
}
