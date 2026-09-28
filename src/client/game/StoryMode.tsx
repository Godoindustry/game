"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    // `speaker` vem preenchido com o nome do destinatário em linhas privadas; só NPC fala de fato.
    speaker: latest?.speakerKey?.startsWith("npc:") && latest.speaker ? latest.speaker : state.event ? "Narrador" : "O vale",
  };
}

/**
 * O que a última escolha causou: as linhas entre o evento anterior e o atual.
 * Sem isto a tela pula direto para a próxima cena e o jogador não vê o resultado.
 */
function lastOutcome(state: GameState, shownText: string) {
  const log = state.log;
  let end = log.length;
  if (state.event) {
    for (let i = log.length - 1; i >= 0; i--) if (log[i].kind === "event") { end = i; break; }
  }
  let start = -1;
  for (let i = end - 1; i >= 0; i--) if (log[i].kind === "event") { start = i; break; }
  return log
    .slice(start + 1, end)
    .filter((entry) => ["result", "narrative", "npc"].includes(entry.kind) && entry.text.trim() && !shownText.includes(entry.text.trim()));
}

/** O D20 que acabou de sair (nesta sessão), associado à linha de resultado que ele gerou. */
function useFreshRoll(state: GameState) {
  const rollId = state.lastRoll?.id ?? null;
  const seen = useRef<string | null | undefined>(undefined);
  const [fresh, setFresh] = useState<{ rollId: string; logId: number } | null>(null);
  const lastResult = [...state.log].reverse().find((entry) => entry.kind === "result")?.id ?? 0;
  useEffect(() => {
    const before = seen.current;
    seen.current = rollId;
    if (before === undefined || !rollId || rollId === before) return;
    const timer = window.setTimeout(() => setFresh({ rollId, logId: lastResult }), 0);
    return () => window.clearTimeout(timer);
  }, [rollId, lastResult]);
  return fresh && fresh.rollId === rollId ? { roll: state.lastRoll!, logId: fresh.logId } : null;
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
  const outcome = useMemo(() => lastOutcome(state, line.text), [state, line.text]);
  const freshRoll = useFreshRoll(state);
  const outcomeRoll = freshRoll && outcome.some((entry) => entry.id === freshRoll.logId) ? freshRoll.roll : null;
  const objective = state.objective;
  const art = sceneArtwork(state) as CSSProperties | undefined;
  const finished = state.campaign.status === "finished";
  const dead = !!state.me && !state.me.alive;
  const activeEvent = state.event?.participating ? state.event : null;
  const dangerous = !!state.story.boss?.active || !!activeEvent?.choices.some((choice) => /fug|corr|enfrent|atac/i.test(choice.label));

  return (
    <main className={`story-mode ${dangerous ? "story-mode-danger" : ""}`} aria-label="Modo história">
      {outcome.length > 0 && (
        <section className={`story-outcome ${outcomeRoll ? (outcomeRoll.success ? "is-success" : "is-failure") : ""}`} aria-label="O que aconteceu">
          <span className="story-outcome-kicker">
            O QUE ACONTECEU
            {outcomeRoll && <b>{outcomeRoll.success ? "SUCESSO" : "FALHA"} NO D20 · TIROU {outcomeRoll.finalTotal ?? outcomeRoll.value}, PRECISAVA {outcomeRoll.target}</b>}
          </span>
          {outcome.map((entry) => <p key={entry.id}>{entry.text}</p>)}
        </section>
      )}

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
          {objective ? (
            <em className="story-objective">
              <b>Objetivo:</b> {objective.label}
              <small>{objective.hint}</small>
            </em>
          ) : (
            <em>Cada escolha avança a história</em>
          )}
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
