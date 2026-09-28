"use client";
/**
 * Assinatura do canal privado da campanha (Supabase Realtime, free tier).
 *
 * O canal é "só o sinal": quando o servidor resolve uma rodada ou alguém age, ele publica
 * um contador de versão. O estado de verdade continua vindo de `POST /sync`. Assim o
 * cliente nunca recebe conteúdo do jogo por este caminho, e uma versão duplicada ou fora
 * de ordem é simplesmente ignorada.
 *
 * Falha de projeto, token expirado, WebSocket bloqueado, CSP, rede móvel instável: tudo
 * aqui degrada para o polling que já existia. Por isso o hook também devolve `live` — o
 * `useGame` só estica o intervalo de reserva quando o canal está realmente de pé.
 *
 * Sem SDK: o protocolo do Realtime é o Phoenix (envelope JSON), e implementá-lo direto
 * evita uma dependência de ~100 KB no bundle do PWA por um canal que manda só `{v: n}`.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

interface RealtimeAccess {
  url: string;
  apikey: string;
  token: string;
  topic: string;
}

const JOIN_TIMEOUT_MS = 4_000;
const HEARTBEAT_MS = 25_000;
const BACKOFF_MS = [2_000, 5_000, 10_000, 30_000];

type Envelope = [string | null, string | null, string, string, Record<string, unknown>];

const isAccess = (v: unknown): v is RealtimeAccess => {
  const a = v as RealtimeAccess | null;
  return Boolean(a && typeof a.url === "string" && typeof a.apikey === "string" && typeof a.token === "string" && a.topic);
};

/**
 * Mantém o WebSocket vivo e chama `onChange` a cada aviso. Devolve `live` para o chamador
 * saber se pode relaxing o polling.
 */
export function useCampaignRealtime(campaignId: string, onChange: () => void): { live: boolean; configured: boolean } {
  const [live, setLive] = useState(false);
  const [configured, setConfigured] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    // Mantém o callback atual sem refazer a assinatura quando a identidade muda.
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let access: RealtimeAccess | null = null;
    let ref = 0;
    let attempt = 0;
    let joined = false;
    let version = 0;
    let joinTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const cleanup = () => {
      stopped = true;
      if (joinTimer) clearTimeout(joinTimer);
      if (heartbeat) clearInterval(heartbeat);
      if (retry) clearTimeout(retry);
      socket?.close();
      socket = null;
    };

    const open = () => {
      if (stopped || !access) return;
      const wsUrl = `${access.url.replace(/^http/, "ws").replace(/\/+$/, "")}/realtime/v1/websocket?apikey=${encodeURIComponent(access.apikey)}&vsn=1.0.0`;
      const topic = `realtime:${access.topic}`;
      const schedule = () => {
        if (stopped) return;
        setLive(false);
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        retry = setTimeout(open, wait);
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        schedule();
        return;
      }
      socket = ws;
      const joinRef = String(++ref);

      joinTimer = setTimeout(() => {
        // Entrou mas não respondeu a tempo: melhor o polling de 3 s que fingir estar vivo.
        if (!joined) {
          ws.close();
          schedule();
        }
      }, JOIN_TIMEOUT_MS);

      ws.onopen = () => {
        const ref1 = String(++ref);
        ws.send(JSON.stringify([joinRef, ref1, topic, "phx_join", {
          config: { broadcast: { ack: false, self: false }, presence: { key: `${campaignId}:${Math.random().toString(36).slice(2, 10)}` }, postgres_changes: [], private: true },
          access_token: access!.token,
        }]));
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify([null, String(++ref), "phoenix", "heartbeat", {}]));
        }, HEARTBEAT_MS);
      };

      ws.onmessage = (event) => {
        let env: Envelope;
        try {
          env = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const [, , , evt, payload] = env;
        if (evt === "phx_reply") {
          if (!joined) {
            const status = (payload as { status?: string })?.status;
            if (status === "ok") {
              joined = true;
              attempt = 0;
              if (joinTimer) clearTimeout(joinTimer);
              setLive(true);
            } else {
              ws.close();
              schedule();
            }
          }
          return;
        }
        if (evt === "broadcast") {
          const v = (payload as { payload?: { v?: number } })?.payload?.v;
          if (typeof v !== "number" || v <= version) return; // fora de ordem ou repetido
          version = v;
          onChangeRef.current();
        }
      };

      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        if (stopped) return;
        joined = false;
        schedule();
      };
    };

    void (async () => {
      try {
        const res = await api<unknown>("GET", `/api/campaigns/${campaignId}/realtime`);
        if (!isAccess(res)) return; // sem Realtime configurado: segue no polling
        access = res;
        setConfigured(true);
        open();
      } catch {
        /* sem sessão/permissão ou projeto fora do ar: polling */
      }
    })();

    return cleanup;
  }, [campaignId]);

  return { live, configured };
}
