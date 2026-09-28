"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState } from "./useGame";
import { narrateSequence, stopNarration, VOICE_STATUS_EVENT, type VoiceStatus } from "./narrator";

type Roll = GameState["lastRoll"];

const LINEAGE_SIGILS: Record<string, string> = {
  human: "◇",
  vampire: "V",
  werewolf: "W",
  haunted: "†",
  hunter: "⌖",
};

export function sceneArtwork(state: GameState) {
  const boss = state.story.boss;
  if (boss?.active) {
    if (boss.id === "tavares") {
      return {
        backgroundImage: 'url("/art/vale-silente/phase-atlas.png")',
        backgroundPosition: "0% 100%",
        backgroundSize: "200% 200%",
      };
    }
    return {
      backgroundImage: 'url("/art/vale-silente/boss-atlas.png")',
      backgroundPosition: boss.artPosition,
      backgroundSize: "300% 100%",
    };
  }
  const sceneSource = `${state.event?.id ?? ""} ${state.event?.title ?? ""} ${state.event?.body ?? ""}`.toLocaleLowerCase("pt-BR");
  if (/rádio|frequência|iara|celular|23h40|sinal|antena/.test(sceneSource)) {
    return {
      backgroundImage: 'url("/art/vale-silente/voice-scene-atlas.png")',
      backgroundPosition: "100% 0%",
      backgroundSize: "200% 200%",
    };
  }
  if (/fogueira|abrigo|descans|acampamento/.test(sceneSource)) {
    return {
      backgroundImage: 'url("/art/vale-silente/voice-scene-atlas.png")',
      backgroundPosition: "0% 100%",
      backgroundSize: "200% 200%",
    };
  }
  if (/rastro|pegada|carcaça|passos|lama/.test(sceneSource)) {
    return {
      backgroundImage: 'url("/art/vale-silente/voice-scene-atlas.png")',
      backgroundPosition: "0% 0%",
      backgroundSize: "200% 200%",
    };
  }
  if (!state.event) {
    return {
      backgroundImage: 'url("/art/vale-silente/story-chapel.png")',
      backgroundPosition: "center center",
      backgroundSize: "cover",
    };
  }
  if (state.story.phase) {
    return {
      backgroundImage: 'url("/art/vale-silente/phase-atlas.png")',
      backgroundPosition: state.story.phase.artPosition,
      backgroundSize: "200% 200%",
    };
  }
  return undefined;
}

export function SceneCard({ state }: { state: GameState }) {
  const last = [...state.log].reverse().find((entry) => ["event", "narrative", "npc", "ending"].includes(entry.kind));
  const text = state.event?.body ?? last?.text ?? state.here.description;
  const bossActive = !!state.story.boss?.active;
  return (
    <section className={`scene-card ${bossActive ? "scene-card-boss" : ""}`} style={sceneArtwork(state)} aria-label="Cena atual">
      <div className="scene-card-noise" aria-hidden="true" />
      <div className="scene-card-shade" />
      <div className="scene-card-content">
        <div className="scene-kicker"><span /> {bossActive ? "AMEAÇA PRESENTE" : "NARRADOR"} · {state.campaign.night ? "NOITE" : "DIA"} {state.campaign.day}</div>
        <strong>{state.event?.title ?? state.here.name}</strong>
        <p>{text}</p>
      </div>
    </section>
  );
}

export function CampaignDirector({ state, onOpenMap }: { state: GameState; onOpenMap: () => void }) {
  const { story } = state;
  const phase = story.phase;
  if (!phase) return null;
  const boss = story.boss;
  const span = story.targetRealMinutes;

  return (
    <section className="campaign-director" aria-label="Progresso da campanha">
      <div className="campaign-phase-art" style={{ backgroundPosition: phase.artPosition }} aria-hidden="true" />
      <div className="campaign-phase-body">
        <div className="campaign-phase-heading">
          <span>ATO {phase.index} / {phase.total}</span>
          <button type="button" onClick={onOpenMap}>ROTAS</button>
        </div>
        <strong>{phase.title}</strong>
        <em>{phase.subtitle}</em>
        <p>{phase.briefing}</p>

        <div className="campaign-progress" aria-label={`${story.progress}% da campanha`}>
          <i style={{ width: `${story.progress}%` }} />
        </div>
        <div className="campaign-progress-copy">
          <span>{phase.completedMilestones}/{phase.milestones.length} objetivos do ato</span>
          <span>Sessão-alvo {span[0]}–{span[1]} min</span>
        </div>

        <div className="campaign-milestones">
          {phase.milestones.map((milestone) => (
            <span key={milestone.id} className={milestone.done ? "is-done" : ""}>
              <i aria-hidden="true">{milestone.done ? "✓" : "◇"}</i>{milestone.label}
            </span>
          ))}
        </div>

        <div className="campaign-act-track" aria-label="Atos da campanha">
          {story.acts.map((act) => (
            <span key={act.id} className={`act-${act.status}`} title={`${act.index}. ${act.title}`}>
              {act.index}
            </span>
          ))}
        </div>
      </div>

      {boss?.introduced && (
        <div className={`boss-threat boss-threat-${boss.id}`}>
          <div
            className="boss-threat-art"
            style={boss.id === "tavares"
              ? { backgroundImage: 'url("/art/vale-silente/phase-atlas.png")', backgroundSize: "200% 200%", backgroundPosition: "0% 100%" }
              : { backgroundPosition: boss.artPosition }}
            aria-hidden="true"
          />
          <div className="boss-threat-copy">
            <span>{boss.active ? "CONFRONTO ATIVO" : boss.resolved ? "AMEAÇA RESOLVIDA" : "CHEFE À ESPREITA"}</span>
            <strong>{boss.title}</strong>
            <em>{boss.epithet}</em>
            <div className="boss-stage-pips" aria-label={`Estágio ${boss.stage} de ${boss.stages}`}>
              {Array.from({ length: boss.stages }, (_, index) => <i key={index} className={index < boss.stage ? "filled" : ""} />)}
            </div>
            <small>{boss.stageLabel}</small>
          </div>
        </div>
      )}
    </section>
  );
}

export function LineageBadge({ me }: { me: NonNullable<GameState["me"]> }) {
  const lineage = me.lineage;
  const supernatural = lineage.key !== "human";
  return (
    <div className={`lineage-badge lineage-${lineage.key}`} title={lineage.description}>
      <span className="lineage-sigil" aria-hidden="true">{LINEAGE_SIGILS[lineage.key] ?? "◇"}</span>
      <span>
        <small>LINHAGEM</small>
        <b>{lineage.label}</b>
      </span>
      {!supernatural && lineage.progress > 0 && <i>{lineage.progress}/{lineage.max}</i>}
    </div>
  );
}

type CinematicReveal =
  | { kind: "act"; key: string }
  | { kind: "boss"; key: string };

/** Revelações breves e não interativas: preservam o ritmo sem bloquear decisões. */
export function HorrorCinematics({ state }: { state: GameState }) {
  const [reveal, setReveal] = useState<CinematicReveal | null>(null);
  const phase = state.story.phase;
  const boss = state.story.boss;
  const lastPhase = useRef<string | null>(null);
  const lastBoss = useRef<string | null>(null);

  useEffect(() => {
    const bossKey = boss?.active ? `${boss.id}:${boss.stage}` : null;
    const phaseKey = phase?.id ?? null;
    const storageKey = bossKey
      ? `vale-cinematic:${state.campaign.id}:boss:${bossKey}`
      : phaseKey
        ? `vale-cinematic:${state.campaign.id}:act:${phaseKey}`
        : null;
    const changedBoss = !!bossKey && bossKey !== lastBoss.current;
    const changedPhase = !!phaseKey && phaseKey !== lastPhase.current;
    lastBoss.current = bossKey;
    lastPhase.current = phaseKey;
    if (!storageKey || (!changedBoss && !changedPhase)) return;
    if (window.sessionStorage.getItem(storageKey)) return;

    window.sessionStorage.setItem(storageKey, "shown");
    let hideTimer: number | undefined;
    const showTimer = window.setTimeout(() => {
      setReveal(bossKey ? { kind: "boss", key: bossKey } : { kind: "act", key: phaseKey! });
      hideTimer = window.setTimeout(() => setReveal(null), bossKey ? 5200 : 4400);
    }, 0);
    return () => {
      window.clearTimeout(showTimer);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [boss?.active, boss?.id, boss?.stage, phase?.id, state.campaign.id]);

  if (!reveal) return null;
  const isBoss = reveal.kind === "boss" && boss;
  const artStyle = isBoss
    ? boss.id === "tavares"
      ? { backgroundImage: 'url("/art/vale-silente/phase-atlas.png")', backgroundPosition: "0% 100%", backgroundSize: "200% 200%" }
      : { backgroundImage: 'url("/art/vale-silente/boss-atlas.png")', backgroundPosition: boss.artPosition, backgroundSize: "300% 100%" }
    : { backgroundImage: 'url("/art/vale-silente/phase-atlas.png")', backgroundPosition: phase?.artPosition ?? "0% 0%", backgroundSize: "200% 200%" };

  return (
    <div className={`horror-cinematic horror-cinematic-${reveal.kind}`} role="status" aria-live="polite">
      <div className="horror-cinematic-art" style={artStyle} aria-hidden="true" />
      <div className="horror-cinematic-rain" aria-hidden="true" />
      <div className="horror-cinematic-vignette" aria-hidden="true" />
      <div className="horror-cinematic-copy">
        <span>{isBoss ? `CONFRONTO · ESTÁGIO ${boss.stage}/${boss.stages}` : `ATO ${phase?.index}/${phase?.total}`}</span>
        <strong>{isBoss ? boss.title : phase?.title}</strong>
        <em>{isBoss ? boss.epithet : phase?.subtitle}</em>
        <i aria-hidden="true" />
        <small>{isBoss ? boss.stageLabel : phase?.briefing}</small>
      </div>
    </div>
  );
}

export function NarratorVoice({ state }: { state: GameState }) {
  const [enabled, setEnabled] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({ available: true, message: null });
  const campaign = useRef(state.campaign.id);
  const spoken = useRef<number | null>(null);
  const lines = state.log.filter((entry) => ["event", "narrative", "npc", "ending", "death"].includes(entry.kind));
  const lineKey = lines.map((entry) => entry.id).join("|");

  useEffect(() => {
    const onStatus = (event: Event) => setVoiceStatus((event as CustomEvent<VoiceStatus>).detail);
    window.addEventListener(VOICE_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(VOICE_STATUS_EVENT, onStatus);
  }, []);

  // Na primeira carga fala apenas a linha atual. Se chegarem várias juntas, toca em ordem
  // e o carregador já prepara a próxima enquanto a atual está sendo reproduzida.
  useEffect(() => {
    if (campaign.current !== state.campaign.id) {
      campaign.current = state.campaign.id;
      spoken.current = null;
    }
    if (!lines.length) return;
    const latestId = lines[lines.length - 1].id;
    const pending = spoken.current === null
      ? [lines[lines.length - 1]]
      : lines.filter((entry) => entry.id > spoken.current!);
    spoken.current = latestId;
    if (enabled && pending.length) narrateSequence(state.campaign.id, pending.map((entry) => ({ logId: entry.id })));
    return () => stopNarration();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, state.campaign.id, lineKey]);

  const toggle = () => {
    if (enabled) stopNarration();
    else spoken.current = null;
    setEnabled((value) => !value);
  };

  return (
    <div className="narrator-control">
      <button
        className={`hud-icon narrator-toggle ${enabled ? "is-live" : ""} ${voiceStatus.available ? "" : "has-error"}`}
        onClick={toggle}
        aria-pressed={enabled}
        title={voiceStatus.message ?? "Voz dinâmica Gemini"}
      >
        <span aria-hidden="true">◖</span>
        <span className="hide-mobile">{voiceStatus.available ? "Narrador" : "Voz indisponível"}</span>
      </button>
      {voiceStatus.message && <span className="voice-unavailable" role="status">{voiceStatus.message}</span>}
    </div>
  );
}

export function D20Overlay({ roll }: { roll: Roll }) {
  const initial = useRef<string | null | undefined>(undefined);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (initial.current === undefined) {
      initial.current = roll?.id ?? null;
      return;
    }
    if (!roll || initial.current === roll.id) return;
    initial.current = roll.id;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [roll]);

  if (!visible || !roll) return null;

  const advLabel = roll.advantage ? "VANTAGEM" : roll.disadvantage ? "DESVANTAGEM" : "";
  const sign = (roll.modifier ?? 0) >= 0 ? "+" : "";

  return (
    <div className={`dice-reveal ${roll.success ? "dice-success" : "dice-failure"} ${roll.crit ? "dice-critical" : ""}`} role="status" aria-live="polite">
      <div className="dice-smoke" />
      <div className="d20-stage">
        <div className="d20-die"><span>{roll.value}</span></div>
      </div>
      <div className="dice-copy">
        <small style={{ color: "var(--amber)" }}>TESTE DE {roll.attribute.replaceAll("_", " ").toUpperCase()}</small>
        {advLabel && <span className="label violet" style={{ margin: "2px auto", display: "inline-block" }}>{advLabel}</span>}
        <strong style={{ fontSize: 24, marginTop: 4 }}>
          {roll.crit === "critical_success" ? "SUCESSO CRÍTICO!" : roll.crit === "critical_failure" ? "FALHA CRÍTICA" : roll.success ? "SUCESSO" : "FALHA"}
        </strong>
        <span className="mono" style={{ fontSize: 13, marginTop: 2 }}>
          {roll.modifier !== undefined ? (
            <>D20 <b>{roll.value}</b> {sign}{roll.modifier} = <b style={{ fontSize: 15, color: "var(--fg)" }}>{roll.finalTotal}</b> vs CD {roll.target}</>
          ) : (
            <>D20 {roll.value} · CD {roll.target}</>
          )}
        </span>
      </div>
    </div>
  );
}
