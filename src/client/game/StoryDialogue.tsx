"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "./useGame";
import { SurvivorPortrait } from "./Portrait";
import { D20_REVEAL_MS } from "./Immersion";

type LogLine = GameState["log"][number];
type SpeakerKind = "narrator" | "player" | "npc" | "creature" | "spirit";

interface SpeakerView {
  name: string;
  role: string;
  kind: SpeakerKind;
  characterId?: string;
  portrait?: "tavares" | "iara" | "anselmo" | "stranger" | "mae" | "ambar";
}

const PORTRAIT_POSITION: Record<string, string> = {
  tavares: "0% 0%",
  iara: "100% 0%",
  anselmo: "0% 100%",
  stranger: "100% 100%",
};

const SCENE_POSITION = {
  tracks: "0% 0%",
  radio: "100% 0%",
  shelter: "0% 100%",
  night: "100% 100%",
} as const;

function eventId(state: GameState): string {
  return state.event?.id ?? "";
}

function speakerFor(state: GameState, line: LogLine): SpeakerView {
  const source = `${eventId(state)} ${line.text}`.toLocaleLowerCase("pt-BR");
  if (/tavares|dono da carga|faróis/.test(source)) return { name: "Tavares", role: "O HOMEM DA CARGA", kind: "npc", portrait: "tavares" };
  if (/iara|23h40|vinte e oito anos/.test(source)) return { name: "Iara Menezes", role: "A VOZ NA FREQUÊNCIA", kind: "spirit", portrait: "iara" };
  if (/anselmo|mateiro/.test(source)) return { name: "Anselmo", role: "O MATEIRO", kind: "npc", portrait: "anselmo" };
  if (/mãe das asas|trono da noite|poço escuro/.test(source)) return { name: "Mãe das Asas", role: "A FOME SOB O POÇO", kind: "creature", portrait: "mae" };
  if (/lobo de âmbar|lua cheia|garras a três metros/.test(source)) return { name: "Lobo de Âmbar", role: "O GUARDIÃO DA CRISTA", kind: "creature", portrait: "ambar" };
  if (line.kind === "npc" && state.here.npc) return { name: state.here.npc.name, role: "INTERLOCUTOR", kind: "npc", portrait: "stranger" };
  if (line.kind === "npc") return { name: "Desconhecido", role: "VOZ NA ESCURIDÃO", kind: "npc", portrait: "stranger" };
  // characterId é o DESTINATÁRIO de uma linha privada, não quem fala: o resto é do narrador
  // (e o narrador não abre cena falada — o texto já está no palco).
  return { name: "Narrador", role: "O VALE OBSERVA", kind: "narrator" };
}

function artworkFor(state: GameState, line: LogLine) {
  const boss = state.story.boss;
  if (boss?.active && boss.id !== "tavares") {
    return {
      backgroundImage: 'url("/art/vale-silente/boss-atlas.webp")',
      backgroundPosition: boss.artPosition,
      backgroundSize: "300% 100%",
    };
  }

  const source = `${eventId(state)} ${line.text}`.toLocaleLowerCase("pt-BR");
  const position = /rádio|frequência|iara|celular|23h40|sinal/.test(source)
    ? SCENE_POSITION.radio
    : /fogueira|abrigo|descans|acampamento/.test(source)
      ? SCENE_POSITION.shelter
      : /rastro|pegada|carcaça|passos|lama/.test(source)
        ? SCENE_POSITION.tracks
        : SCENE_POSITION.night;
  return {
    backgroundImage: 'url("/art/vale-silente/voice-scene-atlas.webp")',
    backgroundPosition: position,
    backgroundSize: "200% 200%",
  };
}

function splitEventText(text: string) {
  const match = /^【([^】]+)】\s*([\s\S]*)$/.exec(text);
  return match ? { title: match[1], body: match[2] } : { title: null, body: text };
}

export function SpokenScene({ state }: { state: GameState }) {
  const latest = useMemo(
    () => [...state.log].reverse().find((line) =>
      ["event", "narrative", "npc"].includes(line.kind) && speakerFor(state, line).kind !== "narrator",
    ) ?? null,
    [state],
  );
  const [active, setActive] = useState<LogLine | null>(null);
  const hideTimer = useRef<number | null>(null);
  const latestRef = useRef(latest);
  const campaignId = state.campaign.id;
  const bossActive = !!state.story.boss?.active;
  const rollId = state.lastRoll?.id ?? null;
  const seenRoll = useRef<string | null | undefined>(undefined);
  const rolledAt = useRef(0);

  useEffect(() => {
    latestRef.current = latest;
  }, [latest]);

  // Declarado antes do efeito da cena: roda primeiro quando o D20 e a fala chegam juntos.
  useEffect(() => {
    if (seenRoll.current !== undefined && rollId !== null && rollId !== seenRoll.current) rolledAt.current = Date.now();
    seenRoll.current = rollId;
  }, [rollId]);

  useEffect(() => {
    const latestLine = latestRef.current;
    if (!latestLine) return;
    const storageKey = `vale-spoken:${campaignId}:${latestLine.id}`;
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, "shown");
    const duration = Math.min(11_000, Math.max(5_800, latestLine.text.length * 42));
    // A revelação do chefe ocupa 5,2 s e a do D20, D20_REVEAL_MS; a fala entra depois, sem cobrir o resultado.
    const afterRoll = D20_REVEAL_MS + 100 - (Date.now() - rolledAt.current);
    const delay = Math.max(bossActive ? 5_400 : 80, afterRoll);
    const showTimer = window.setTimeout(() => {
      setActive(latestLine);
      hideTimer.current = window.setTimeout(() => setActive(null), duration);
    }, delay);
    return () => {
      window.clearTimeout(showTimer);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [latest?.id, campaignId, bossActive]);

  if (!active) return null;
  const speaker = speakerFor(state, active);
  const copy = splitEventText(active.text);
  const duration = Math.min(11_000, Math.max(5_800, active.text.length * 42));
  const bossPortrait = speaker.portrait === "mae" || speaker.portrait === "ambar";
  const bossPosition = speaker.portrait === "mae" ? "0% 50%" : "50% 50%";

  return (
    <section
      className={`spoken-scene spoken-${speaker.kind}`}
      role="dialog"
      aria-label={`Cena falada por ${speaker.name}`}
      onClick={() => setActive(null)}
    >
      <div className="spoken-scene-art" style={artworkFor(state, active)} aria-hidden="true" />
      <div className="spoken-scene-rain" aria-hidden="true" />
      <div className="spoken-scene-shade" aria-hidden="true" />
      <button className="spoken-scene-close" type="button" onClick={() => setActive(null)} aria-label="Fechar cena">FECHAR ×</button>

      <div className="spoken-scene-dialogue">
        <div className="spoken-portrait" aria-hidden="true">
          {speaker.characterId ? (
            <SurvivorPortrait id={speaker.characterId} name={speaker.name} />
          ) : bossPortrait ? (
            <i className="spoken-portrait-boss" style={{ backgroundPosition: bossPosition }} />
          ) : speaker.portrait ? (
            <i className="spoken-portrait-npc" style={{ backgroundPosition: PORTRAIT_POSITION[speaker.portrait] }} />
          ) : (
            <i className="spoken-portrait-radio">074</i>
          )}
        </div>
        <div className="spoken-copy">
          <span>{speaker.role}</span>
          <strong>{speaker.name}</strong>
          {copy.title && <em>{copy.title}</em>}
          <blockquote>{copy.body}</blockquote>
          <div className="spoken-progress" aria-hidden="true"><i style={{ animationDuration: `${duration}ms` }} /></div>
        </div>
      </div>
    </section>
  );
}

export function ParticipantTransition({ state }: { state: GameState }) {
  const [participant, setParticipant] = useState<GameState["party"][number] | null>(null);
  const previous = useRef<{ round: number; acted: Set<string> } | null>(null);
  const partyRef = useRef(state.party);
  const actedKey = state.party.filter((member) => member.acted).map((member) => member.characterId).sort().join("|");

  useEffect(() => {
    partyRef.current = state.party;
  }, [state.party]);

  useEffect(() => {
    const current = new Set(actedKey ? actedKey.split("|") : []);
    const before = previous.current;
    previous.current = { round: state.campaign.round, acted: current };
    if (!before || before.round !== state.campaign.round || state.campaign.mode !== "coop") return;
    const fresh = partyRef.current.find((member) => current.has(member.characterId) && !before.acted.has(member.characterId));
    if (!fresh) return;
    let hideTimer: number | undefined;
    const showTimer = window.setTimeout(() => {
      setParticipant(fresh);
      hideTimer = window.setTimeout(() => setParticipant(null), 2600);
    }, 0);
    return () => {
      window.clearTimeout(showTimer);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [actedKey, state.campaign.mode, state.campaign.round]);

  if (!participant) return null;
  return (
    <div className="participant-transition" role="status" aria-live="polite">
      <SurvivorPortrait id={participant.characterId} name={participant.name} />
      <span><small>AÇÃO REGISTRADA</small><b>{participant.name}</b><em>{participant.player}</em></span>
      <i aria-hidden="true">✓</i>
    </div>
  );
}
