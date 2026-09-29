"use client";
/**
 * Estado da campanha no cliente. O servidor é a fonte da verdade:
 * o cliente só envia intenções (tipo + parâmetros) e exibe o estado retornado.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, newIdempotencyKey } from "../api";
import { toastError } from "../session";
import { useCampaignRealtime } from "./useRealtime";
import { setMediaAudioBase } from "./mediaBase";
import type { getState } from "@/server/services/game";

export type GameState = Awaited<ReturnType<typeof getState>>;

export function useGame(campaignId: string) {
  const [state, setState] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [offset, setOffset] = useState(0); // relógio do servidor - relógio local
  const inflight = useRef(false);

  const accept = useCallback((s: GameState) => {
    setState(s);
    setOffset(Date.parse(s.campaign.serverTime) - Date.now());
    // CDN de áudio (vazio quando não há Cloudinary): os efeitos que o cliente monta sozinho.
    setMediaAudioBase(s.media?.audioBase);
  }, []);

  const sync = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      accept(await api<GameState>("POST", `/api/campaigns/${campaignId}/sync`));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 401)) setFatal(err.message);
      else if (!(err instanceof ApiError && err.code === "rede")) toastError(err);
    } finally {
      inflight.current = false;
    }
  }, [campaignId, accept]);

  const submit = useCallback(
    async (type: string, params: Record<string, unknown> = {}) => {
      setBusy(true);
      try {
        const r = await api<{ state: GameState }>("POST", `/api/campaigns/${campaignId}/actions`, { type, params, idempotencyKey: newIdempotencyKey() });
        accept(r.state);
        return true;
      } catch (err) {
        toastError(err);
        await sync();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [campaignId, accept, sync],
  );

  const cancel = useCallback(async () => {
    setBusy(true);
    try {
      accept(await api<GameState>("DELETE", `/api/campaigns/${campaignId}/actions/pending`));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }, [campaignId, accept]);

  // Canal privado da campanha: quando o servidor resolve a rodada, chega o aviso e o sync
  // acontece na hora. Se o Realtime não estiver configurado, `live` fica false e o polling
  // de 3 s abaixo continua sendo o mecanismo — nada muda para quem não configurou.
  const { live } = useCampaignRealtime(campaignId, sync);

  // Primeira carga
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca assíncrona ao montar; o setState ocorre após o await
    void sync();
  }, [sync]);

  // Agenda o próximo sync conforme a situação (espera concluída, grupo, heartbeat).
  // Com o canal vivo o intervalo vira só rede de segurança: o push é quem traz a novidade.
  useEffect(() => {
    if (!state || state.campaign.status === "finished") return;
    let delay = 20_000;
    if (state.pending) {
      const done = Date.parse(state.pending.completesAt) - (Date.now() + offset);
      // Espera acabando: sync logo em seguida. Já passou e segue pendente (IA lenta, outra
      // resolução em curso): 2 s, para não martelar o servidor a cada 400 ms.
      delay = state.pending.waitingFor.length ? (live ? 20_000 : 3000) : done > -1500 ? Math.max(400, done + 350) : 2000;
    } else if (state.campaign.mode === "coop") delay = live ? 20_000 : 3000;
    const t = setTimeout(sync, delay);
    return () => clearTimeout(t);
  }, [state, offset, sync, live]);

  // Ao voltar para a aba, sincroniza imediatamente.
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sync]);

  return { state, busy, fatal, offset, sync, submit, cancel };
}

export function useNow(active: boolean, offset: number): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now() + offset), 250);
    return () => clearInterval(t);
  }, [active, offset]);
  return now;
}

export const ACTION_LABEL: Record<string, string> = {
  examinar: "Examinando a área",
  procurar: "Procurando recursos",
  mover: "Seguindo pela rota",
  descansar: "Descansando",
  dormir: "Dormindo",
  comer: "Comendo",
  beber: "Bebendo",
  coletar_agua: "Enchendo a garrafa",
  purificar_agua: "Purificando água",
  ferver_agua: "Fervendo água",
  tratar_ferimento: "Tratando ferimento",
  tomar_analgesico: "Tomando analgésico",
  montar_abrigo: "Montando abrigo",
  acender_fogueira: "Acendendo fogueira",
  coletar_lenha: "Coletando lenha",
  pegar_item: "Pegando item",
  largar_item: "Largando item",
  mover_item: "Reorganizando a mochila",
  equipar: "Trocando equipamento",
  desequipar: "Trocando equipamento",
  conversar: "Conversando",
  escolha_evento: "Agindo",
  esperar: "Esperando",
};
