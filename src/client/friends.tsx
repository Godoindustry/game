"use client";
/** Amigos: tipos da API, rótulo de status (menu/lobby/partida/offline) e atualização periódica. */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export interface Friend {
  userId: string;
  displayName: string;
  avatar: string;
  online: boolean;
  activity: "menu" | "lobby" | "playing" | null;
  campaign: { name: string; mode: "solo" | "coop" } | null;
  lastSeenAt: string | null;
  since: string;
}
export interface FriendRequest { id: string; userId: string; displayName: string; avatar: string; createdAt: string }
export interface FriendsData {
  code: string;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  onlineCount: number;
}

export const AVATAR_ICON: Record<string, string> = {
  bussola: "🧭", radio: "📻", lanterna: "🔦", mochila: "🎒", fogueira: "🔥", mapa: "🗺️", corda: "🪢", cruz: "✚",
};

const POLL_MS = 20_000;

/** Busca /api/friends e atualiza a cada 20 s enquanto a aba estiver visível. */
export function useFriends() {
  const [data, setData] = useState<FriendsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    () =>
      api<FriendsData>("GET", "/api/friends").then(
        (d) => {
          setData(d);
          setError(null);
        },
        (e) => setError(e instanceof Error ? e.message : "Falha ao carregar amigos."),
      ),
    [],
  );
  useEffect(() => {
    void reload();
    const t = setInterval(() => document.visibilityState === "visible" && void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);
  return { data, error, reload };
}

function ago(iso: string | null): string {
  if (!iso) return "nunca entrou";
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "visto agora há pouco";
  if (min < 60) return `visto há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `visto há ${h} h`;
  const d = Math.floor(h / 24);
  return `visto há ${d} dia${d > 1 ? "s" : ""}`;
}

export function FriendStatus({ f, compact }: { f: Friend; compact?: boolean }) {
  if (!f.online) return <span className="chip">○ Offline{compact ? "" : ` · ${ago(f.lastSeenAt)}`}</span>;
  if (f.activity === "playing") {
    return (
      <span className="chip chip-green" title={f.campaign?.name}>
        ● Em partida{!compact && f.campaign ? ` · ${f.campaign.name}` : ""}
      </span>
    );
  }
  if (f.activity === "lobby") {
    return (
      <span className="chip chip-amber" title={f.campaign?.name}>
        ● No lobby{!compact && f.campaign ? ` · ${f.campaign.name}` : ""}
      </span>
    );
  }
  return <span className="chip chip-blue">● No menu principal</span>;
}
