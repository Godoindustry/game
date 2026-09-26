"use client";
/**
 * PWA: registra o service worker (só em produção) e mostra um aviso discreto
 * de "instalar o app" — botão no Android/Chrome, instrução no iPhone (Safari
 * não tem prompt de instalação). Some quando já está instalado ou é dispensado.
 */
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "pwa-install-dismissed";

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function Pwa() {
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    // Dentro do app Capacitor ou já instalado: nada a oferecer.
    if (isStandalone() || "Capacitor" in window) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === "1"; } catch {}
    if (dismissed) return;

    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    // Espera um pouco para não disputar a atenção com a tela recém-aberta.
    const t = isIos ? setTimeout(() => { setIos(true); setHidden(false); }, 1500) : undefined;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as InstallEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  function dismiss() {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
  }

  if (hidden) return null;
  return (
    <div className="pwa-banner" role="dialog" aria-label="Instalar o jogo">
      <div className="pwa-text">
        {ios ? (
          <>Instale o jogo: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</>
        ) : (
          <>Instale o jogo no celular: abre em tela cheia, como um app.</>
        )}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {installEvt && (
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              await installEvt.prompt();
              await installEvt.userChoice.catch(() => null);
              setInstallEvt(null);
              setHidden(true);
            }}
          >
            Instalar
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={dismiss}>Agora não</button>
      </div>
    </div>
  );
}
