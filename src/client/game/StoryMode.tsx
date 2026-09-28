"use client";

import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { GameState } from "./useGame";
import { EventCard, HereCard, PendingCard } from "./Panels";
import { sceneArtwork } from "./Immersion";

type Act = (type: string, params?: Record<string, unknown>) => void;

function narrativeLine(state: GameState) {
  const latest = [...state.log]
    .reverse()
    .find((entry) => ["event", "narrative", "npc", "ending", "death"].includes(entry.kind));
  const raw = state.event?.body ?? latest?.text ?? state.here.description;
  const match = /^【([^】]+)】\s*([\s\S]*)$/.exec(raw);
  return {
    title: state.event?.title ?? match?.[1] ?? state.here.name,
    text: match?.[2] ?? raw,
    speaker: latest?.speaker ?? (state.event ? "Narrador" : "O vale"),
  };
}

export function StoryMode({
  state,
  busy,
  offset,
  selected,
  onAct,
  onCancel,
}: {
  state: GameState;
  busy: boolean;
  offset: number;
  selected: string | null;
  onAct: Act;
  onCancel: () => void;
}) {
  const line = useMemo(() => narrativeLine(state), [state]);
  const art = sceneArtwork(state) as CSSProperties | undefined;
  const finished = state.campaign.status === "finished";
  const dead = !!state.me && !state.me.alive;
  const activeEvent = state.event?.participating ? state.event : null;
  const dangerous = !!state.story.boss?.active || !!activeEvent?.choices.some((choice) => /fug|corr|enfrent|atac/i.test(choice.label));

  return (
    <main className={`story-mode ${dangerous ? "story-mode-danger" : ""}`} aria-label="Modo história">
      <section className="story-stage" aria-label={`Cena: ${line.title}`}>
        <div className="story-stage-art" style={art} aria-hidden="true" />
        <div className="story-stage-breathe" aria-hidden="true" />
        {state.campaign.weather === "chuva" && <div className="story-stage-rain" aria-hidden="true" />}
        <div className="story-stage-grade" aria-hidden="true" />

        <div className="story-stage-topline">
          <span><i /> MODO HISTÓRIA</span>
          <span>{state.here.name}</span>
          <span>DIA {state.campaign.day} · {state.campaign.clock}</span>
        </div>

        <div className="story-stage-copy">
          <span className="story-speaker">{line.speaker}</span>
          <h1>{line.title}</h1>
          <p>{line.text}</p>
          <div className="story-rule"><i /></div>
          <small>
            {state.event?.participating === false
              ? "A cena acontece longe de você. O grupo decide."
              : state.event
                ? "A história espera sua decisão."
                : "Escolha o que seu personagem faz a seguir."}
          </small>
        </div>
      </section>

      <section className="story-decisions" aria-label="Decisões da história">
        <div className="story-decisions-heading">
          <div>
            <span>{activeEvent ? "DECISÃO" : state.pending ? "AÇÃO EM CURSO" : "PRÓXIMO PASSO"}</span>
            <strong>{activeEvent ? "O que você faz?" : state.pending ? "O tempo passa no vale" : "Conduza a cena"}</strong>
          </div>
          <em>Decisões, diálogos e D20 · cada escolha avança a narrativa</em>
        </div>

        {finished ? (
          <p className="muted">A crônica terminou. Abra o resultado para rever o desfecho.</p>
        ) : dead ? (
          <p className="muted">Sua história terminou aqui. O diário ainda acompanha o restante do grupo.</p>
        ) : activeEvent ? (
          <EventCard state={state} event={activeEvent} onAct={onAct} busy={busy} storyMode />
        ) : state.pending ? (
          <PendingCard pending={state.pending} offset={offset} onCancel={onCancel} busy={busy} />
        ) : (
          <>
            {state.event && !state.event.participating && (
              <p className="story-remote-event">A cena “{state.event.title}” acontece com outro sobrevivente. Sua história continua aqui.</p>
            )}
            <HereCard state={state} onAct={onAct} busy={busy} selected={selected} storyMode />
          </>
        )}
      </section>
    </main>
  );
}
