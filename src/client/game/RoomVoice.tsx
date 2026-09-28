"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

type Peer = { id: string; name: string };
type OutgoingSignal = {
  to: string;
  kind: "description" | "candidate";
  description?: { type: "offer" | "answer"; sdp: string };
  candidate?: RTCIceCandidateInit;
};
type IncomingSignal = OutgoingSignal & { from: string };
type Exchange = { selfId: string; peers: Peer[]; signals: IncomingSignal[] };

export function RoomVoice({ campaignId, compact = false }: { campaignId: string; compact?: boolean }) {
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [open, setOpen] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const stream = useRef<MediaStream | null>(null);
  const connections = useRef(new Map<string, RTCPeerConnection>());
  const outbox = useRef<OutgoingSignal[]>([]);
  const selfId = useRef("");
  const busy = useRef(false);
  const audioHost = useRef<HTMLDivElement>(null);

  const closePeer = useCallback((id: string) => {
    connections.current.get(id)?.close();
    connections.current.delete(id);
    audioHost.current?.querySelector(`[data-peer="${CSS.escape(id)}"]`)?.remove();
    setConnected((items) => items.filter((item) => item !== id));
  }, []);

  const ensurePeer = useCallback((id: string) => {
    const old = connections.current.get(id);
    if (old) return old;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    stream.current?.getTracks().forEach((track) => peer.addTrack(track, stream.current!));
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) outbox.current.push({ to: id, kind: "candidate", candidate: candidate.toJSON() });
    };
    peer.ontrack = ({ streams }) => {
      if (!audioHost.current || !streams[0]) return;
      let audio = audioHost.current.querySelector<HTMLAudioElement>(`audio[data-peer="${CSS.escape(id)}"]`);
      if (!audio) {
        audio = document.createElement("audio");
        audio.dataset.peer = id;
        audio.autoplay = true;
        audioHost.current.appendChild(audio);
      }
      audio.srcObject = streams[0];
      void audio.play().catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") setConnected((items) => items.includes(id) ? items : [...items, id]);
      if (["failed", "closed"].includes(peer.connectionState)) closePeer(id);
    };
    connections.current.set(id, peer);
    return peer;
  }, [closePeer]);

  const makeOffer = useCallback(async (id: string) => {
    const peer = ensurePeer(id);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (offer.sdp) outbox.current.push({ to: id, kind: "description", description: { type: "offer", sdp: offer.sdp } });
  }, [ensurePeer]);

  const tick = useCallback(async () => {
    if (!active || busy.current) return;
    busy.current = true;
    const signals = outbox.current.splice(0, 16);
    try {
      const result = await api<Exchange>("POST", `/api/campaigns/${campaignId}/voice/exchange`, { active: true, signals });
      selfId.current = result.selfId;
      setPeers(result.peers);

      for (const signal of result.signals) {
        const peer = ensurePeer(signal.from);
        if (signal.kind === "description" && signal.description) {
          await peer.setRemoteDescription(signal.description);
          if (signal.description.type === "offer") {
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            if (answer.sdp) outbox.current.push({ to: signal.from, kind: "description", description: { type: "answer", sdp: answer.sdp } });
          }
        } else if (signal.kind === "candidate" && signal.candidate) {
          await peer.addIceCandidate(signal.candidate).catch(() => undefined);
        }
      }

      for (const peer of result.peers) {
        if (result.selfId.localeCompare(peer.id) < 0 && !connections.current.has(peer.id)) await makeOffer(peer.id);
      }
      for (const id of [...connections.current.keys()]) {
        if (!result.peers.some((peer) => peer.id === id)) closePeer(id);
      }
      setError("");
    } catch (reason) {
      outbox.current.unshift(...signals);
      setError(reason instanceof Error ? reason.message : "A sala de voz não respondeu.");
    } finally {
      busy.current = false;
    }
  }, [active, campaignId, closePeer, ensurePeer, makeOffer]);

  useEffect(() => {
    if (!active) return;
    void tick();
    const timer = window.setInterval(() => void tick(), 1_200);
    return () => window.clearInterval(timer);
  }, [active, tick]);

  useEffect(() => {
    const activeConnections = connections.current;
    return () => {
      for (const peer of activeConnections.values()) peer.close();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const join = async () => {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("O navegador não liberou o microfone. Use HTTPS ou localhost.");
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      setActive(true);
      setOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível acessar o microfone.");
      setOpen(true);
    }
  };

  const leave = () => {
    void api("POST", `/api/campaigns/${campaignId}/voice/exchange`, { active: false, signals: [] }).catch(() => undefined);
    setActive(false);
    setPeers([]);
    setConnected([]);
    for (const id of [...connections.current.keys()]) closePeer(id);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };

  const toggleMute = () => {
    const next = !muted;
    stream.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  };

  return (
    <div className={`voice-room ${compact ? "voice-compact" : ""}`}>
      <button className={`hud-icon voice-trigger ${active ? "is-live" : ""}`} onClick={() => active ? setOpen((value) => !value) : void join()} aria-pressed={active}>
        <span aria-hidden="true">{muted ? "⌁" : "◉"}</span>
        <span className="hide-mobile">{active ? `${connected.length + 1} na voz` : "Entrar na voz"}</span>
      </button>
      {open && (
        <div className="voice-popover">
          <div className="voice-title"><span className={active ? "voice-pulse" : ""} /> Voz da sala <button onClick={() => setOpen(false)} aria-label="Fechar">×</button></div>
          <p>Áudio ponto a ponto, restrito aos membros desta campanha. Nada é gravado.</p>
          {error && <div className="voice-error">{error}</div>}
          <div className="voice-members">
            {active && <span><i className={muted ? "is-muted" : "is-connected"} /> Você {muted ? "· mudo" : "· microfone ativo"}</span>}
            {peers.map((peer) => <span key={peer.id}><i className={connected.includes(peer.id) ? "is-connected" : ""} /> {peer.name} · {connected.includes(peer.id) ? "conectado" : "chamando…"}</span>)}
            {active && peers.length === 0 && <em>Aguardando os outros sobreviventes…</em>}
          </div>
          <div className="voice-actions">
            {!active ? <button className="btn btn-sm btn-primary" onClick={() => void join()}>Permitir microfone</button> : (
              <>
                <button className="btn btn-sm" onClick={toggleMute}>{muted ? "Abrir microfone" : "Silenciar"}</button>
                <button className="btn btn-sm" onClick={leave}>Sair da voz</button>
              </>
            )}
          </div>
        </div>
      )}
      <div ref={audioHost} hidden />
    </div>
  );
}
