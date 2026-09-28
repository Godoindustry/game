"use client";
/**
 * Heartbeat de presença: avisa o servidor onde o jogador está (menu, lobby ou partida)
 * para os amigos verem. Se a aba fechar sem avisar, o servidor considera offline sozinho.
 */
import { useEffect } from "react";
import { api } from "./api";

export type Activity = "menu" | "lobby" | "playing";

const INTERVAL_MS = 30_000;

export function usePresence(activity: Activity | null, campaignId?: string | null) {
  useEffect(() => {
    if (!activity) return;
    const send = () => {
      if (document.visibilityState === "hidden") return;
      void api("POST", "/api/presence", { activity, campaignId: campaignId ?? null }).catch(() => undefined);
    };
    const onVisible = () => document.visibilityState === "visible" && send();
    const onHide = () => void api("POST", "/api/presence", { activity: "offline" }, { keepalive: true }).catch(() => undefined);
    send();
    const timer = setInterval(send, INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHide);
    };
  }, [activity, campaignId]);
}

/** Atividade e campanha a partir da rota das páginas com AppShell. */
export function activityFromPath(pathname: string): { activity: Activity; campaignId: string | null } {
  const m = pathname.match(/^\/campanha\/([^/]+)\/(lobby|personagem|jogar)/);
  if (!m) return { activity: "menu", campaignId: null };
  return { activity: m[2] === "jogar" ? "playing" : "lobby", campaignId: m[1] };
}
