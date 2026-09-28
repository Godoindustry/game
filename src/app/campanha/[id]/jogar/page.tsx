"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EcgLine, Logo, Spinner, useRequireUser } from "@/client/ui";
import { useGame } from "@/client/game/useGame";
import { CharacterPanel } from "@/client/game/CharacterPanel";
import { Inventory } from "@/client/game/Inventory";
import { EndScreen, Feed, PartyList } from "@/client/game/Panels";
import { ObjectiveCompass } from "@/client/game/Compass";
import { ScreenFx } from "@/client/game/ScreenFx";
import { useAudio, useHealthAudio } from "@/client/game/useAudio";
import { useHorrorAudio } from "@/client/game/horrorAudio";
import { AudioSettings } from "@/client/game/AudioSettings";
import { StoryMode } from "@/client/game/StoryMode";
import { CampaignDirector, D20Overlay, HorrorCinematics, LineageBadge, NarratorVoice } from "@/client/game/Immersion";
import { RoomVoice } from "@/client/game/RoomVoice";
import { SurvivorPortrait } from "@/client/game/Portrait";
import { usePresence } from "@/client/presence";
import { PowerCard } from "@/client/game/PowerCard";
import { ParticipantTransition, SpokenScene } from "@/client/game/StoryDialogue";

type Tab = "acoes" | "diario" | "grupo";

/** Determina a classe CSS do avatar baseado no estado do personagem */
function avatarClass(me: NonNullable<ReturnType<typeof useGame>["state"]>["me"]): string {
  if (!me) return "";
  if (!me.alive)                                              return "avatar-dead";
  if (me.health.health < 15 || me.status.thirst > 90)        return "avatar-danger";
  if (me.wounds.some((w) => w.bleedingRate > 0) || me.health.health < 35) return "avatar-injured";
  if (me.status.fatigue > 75 || me.status.energy < 20)       return "avatar-tired";
  if (me.health.health >= 70 && me.status.thirst < 40 && me.status.hunger < 40) return "avatar-healthy";
  return ""; // padrão (âmbar)
}

export default function PlayPage() {
  const user = useRequireUser();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { state, busy, fatal, offset, submit, cancel } = useGame(id);
  const [tab, setTab] = useState<Tab>("acoes");
  const [panel, setPanel] = useState<"char" | "bag" | "map" | null>(null);
  const [endClosed, setEndClosed] = useState(false);
  const { toggle, enabled } = useAudio();
  // Trilha de terror: chefes, despertar, noite, morte, mordida e compulsões.
  useHorrorAudio(state, enabled);

  // Amigos veem "Em partida" enquanto esta tela estiver aberta.
  usePresence(user ? "playing" : null, id);

  // Alertas automáticos de saúde (sangue, hipotermia, etc.)
  useHealthAudio(state?.me);

  useEffect(() => {
    if (state?.campaign.status === "lobby") router.replace(`/campanha/${id}/lobby`);
  }, [state?.campaign.status, id, router]);

  // ── Erro fatal ────────────────────────────────────────────────────────────
  if (fatal) {
    return (
      <div className="container page stack" style={{ maxWidth: 480 }}>
        <div className="error-box">
          <strong>Falha de conexão</strong>
          <div style={{ marginTop: 4 }}>{fatal}</div>
        </div>
        <Link className="btn" href="/painel">Voltar ao painel</Link>
      </div>
    );
  }

  // ── Carregando ────────────────────────────────────────────────────────────
  if (!user || !state) {
    return (
      <div
        className="container page row"
        style={{ justifyContent: "center", minHeight: "60vh", gap: 12 }}
      >
        <Spinner />
        <div>
          <div style={{ fontFamily: "var(--font-head)", letterSpacing: "0.1em", fontSize: 14 }}>
            SINTONIZANDO
          </div>
          <div className="tiny muted">Carregando estado da campanha…</div>
        </div>
      </div>
    );
  }

  const me = state.me;
  const act = (type: string, params: Record<string, unknown> = {}) => {
    void submit(type, params).then((ok) => ok && setPanel(null));
  };
  const finished  = state.campaign.status === "finished";
  const dead      = !!me && !me.alive;
  const isInjured = !!me && me.wounds.length > 0;
  const isAlert   = !!me && (
    me.wounds.some((w) => w.bleedingRate > 0) ||
    me.status.thirst > 75 ||
    me.status.bodyTemp < 35 ||
    me.health.health < 30
  );

  // Cor do dot de status no avatar
  const dotColor = !me
    ? "var(--faint)"
    : !me.alive
    ? "var(--faint)"
    : me.health.health < 30 || me.wounds.some((w) => w.bleedingRate > 0)
    ? "var(--red)"
    : me.health.health < 60 || me.status.thirst > 70
    ? "var(--amber)"
    : "var(--green)";

  const saved = new Date(state.campaign.savedAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className="game game-immersive">

      {/* ── HUD superior ──────────────────────────────────────────────── */}
      <header className="hud">
        {/* Voltar */}
        <Link href="/painel" aria-label="Voltar ao painel">
          <Logo size={26} />
        </Link>

        {/* Info da campanha - compacto */}
        <div className="hud-block hide-mobile" style={{ maxWidth: 180, overflow: "hidden" }}>
          <span className="label" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
            {state.campaign.name}
          </span>
          <span className="tiny muted">
            {state.campaign.mode === "solo" ? "Solo" : "Coop"} · R{state.campaign.round}
          </span>
        </div>

        <div className="spacer" />

        {/* Relógio principal - destaque */}
        <div className="hud-block" style={{ alignItems: "center" }} data-tut-id="clock">
          <span className="hud-clock">{state.campaign.clock}</span>
          <span className="tiny muted" style={{ display: "flex", gap: 8 }}>
            <span>DIA {state.campaign.day}</span>
            <span style={{ color: state.campaign.night ? "var(--blue-2)" : "var(--amber)", fontWeight: 500 }}>
              {state.campaign.night ? "● Noite" : "● Dia"}
            </span>
          </span>
        </div>

        <div className="spacer" />

        {/* Controles essenciais apenas */}
        <div className="hud-tools" style={{ gap: 6 }}>
          <NarratorVoice state={state} />
          <button
            className="hud-icon"
            onClick={toggle}
            aria-pressed={enabled}
            aria-label={enabled ? "Desligar som" : "Ligar som"}
            title={enabled ? "Som ligado" : "Som desligado"}
          >
            {enabled ? "🔊" : "🔇"}
          </button>
        </div>

        {/* Status salvo - minimal */}
        <div className="hud-block hide-mobile" style={{ alignItems: "flex-end" }}>
          <span className={`chip ${state.campaign.paused && !finished ? "chip-amber" : "chip-green"}`} style={{ fontSize: 10 }}>
            {state.campaign.paused && !finished ? "⏸ Pausada" : "● Salvo"}
          </span>
          <span className="hud-save">{saved}</span>
        </div>

        {/* Avatar - sem ECG inline, sem pulso no dot */}
        {me && (
          <button
            className={`avatar-btn ${avatarClass(me)}`}
            onClick={() => setPanel("char")}
            aria-label={`Abrir painel de ${me.name}`}
            title={me.name}
            data-tut-id="avatar"
          >
            <SurvivorPortrait id={me.id} name={me.name} />
            <span className="dot" style={{ background: dotColor }} />
          </button>
        )}
      </header>

      {/* ── Corpo do jogo ─────────────────────────────────────────────── */}
      <div className="game-body">

        {/* Modo história: cena narrada + decisões e D20, sem movimentação livre. */}
        <StoryMode
          state={state}
          busy={busy}
          offset={offset}
          onAct={act}
          onCancel={cancel}
          selected={panel === "map" ? null : panel}
        />

        {/* Painel lateral */}
        <aside className="game-side">
          {/* Abas */}
          <div className="side-tabs" role="tablist">
            {([
              ["acoes", "Ações"],
              ["diario", "Diário"],
              ["grupo", state.campaign.mode === "coop" ? "Grupo" : "Status"],
            ] as [Tab, string][]).map(([t, l]) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Conteúdo da aba */}
          <div className="side-scroll">

            {/* ABA: Ações */}
            {tab === "acoes" && (
              <div className="stack">
                {me && me.alive && !finished && <PowerCard me={me} acts={state.acts} busy={busy || !!state.pending} onAct={act} />}

                {(finished || dead) && (
                  <div className={finished ? "ok-box" : "error-box"} style={{ textAlign: dead && !finished ? "center" : undefined }}>
                    {dead && !finished && <div style={{ fontSize: 18, marginBottom: 4 }}>☠</div>}
                    {dead && !finished
                      ? <strong>Você morreu{me?.deathCause ? ` — ${me.deathCause}` : ""}</strong>
                      : "Campanha encerrada."}{" "}
                    <button className="btn btn-sm" onClick={() => setEndClosed(false)}>
                      Ver resultado
                    </button>
                    {dead && !finished && <div className="tiny muted" style={{ marginTop: 6 }}>Acompanhe o grupo pelo diário.</div>}
                  </div>
                )}

                {/* Atalhos rápidos */}
                {me && !finished && (
                  <div className="action-grid" data-tut-id="actions" style={{ marginTop: 4 }}>
                    <button className="action-btn" onClick={() => setPanel("bag")} data-tut-id="bag">
                      <span className="t">🎒 Mochila</span>
                      <span className="d">{me.load.weightKg}kg</span>
                    </button>
                    <button className="action-btn" onClick={() => setPanel("char")}>
                      <span className="t">Personagem</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ABA: Diário */}
            {tab === "diario" && <Feed log={state.log} clues={state.clues} />}

            {/* ABA: Grupo / Status */}
            {tab === "grupo" && <PartyList state={state} />}
          </div>
        </aside>
      </div>

      {/* ── Painéis flutuantes ─────────────────────────────────────────── */}
      {panel === "char" && me && (
        <CharacterPanel
          me={me}
          busy={busy || !!state.pending}
          onClose={() => setPanel(null)}
          onOpenBag={() => setPanel("bag")}
          onAct={act}
        />
      )}
      {panel === "bag" && me && (
        <Inventory
          me={me}
          ground={state.here.ground}
          busy={busy || !!state.pending}
          onClose={() => setPanel(null)}
          onAct={act}
        />
      )}

      {/* Rotas narrativas: escolhem um destino, sem mapa visto de cima. */}
      {panel === "map" && (
        <div className="world-map-modal story-route-modal" role="dialog" aria-modal="true" aria-label="Rotas da história">
          <div className="world-map-bar">
            <span className="label">Rotas da história</span>
            <button className="btn btn-sm" onClick={() => setPanel(null)}>Fechar</button>
          </div>
          <div className="story-route-content">
            <header>
              <span>LOCAL ATUAL</span>
              <h2>{state.here.name}</h2>
              <p>{state.here.description}</p>
            </header>
            <div className="story-route-list">
              {state.map.travel.map((route, index) => {
                const location = state.map.locations.find((item) => item.id === route.to);
                return (
                  <button
                    key={route.to}
                    className="story-route-choice"
                    disabled={busy || !route.available}
                    title={route.reason ?? undefined}
                    onClick={() => { act("mover", { to: route.to }); setPanel(null); }}
                  >
                    <span className="story-route-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="story-route-copy">
                      <b>{route.name}</b>
                      <small>{location?.description ?? route.reason ?? "O caminho desaparece na névoa."}</small>
                    </span>
                    <span className="story-route-meta">
                      {location && location.danger >= 3 && <em>PERIGO</em>}
                      <i>~{route.estimatedMinutes} min</i>
                    </span>
                  </button>
                );
              })}
              {state.map.travel.length === 0 && <p className="muted">Nenhuma rota está aberta nesta cena.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── Imersão: filtros de tela ────────────────────────────────────── */}
      <ScreenFx me={me} />

      {/* ── Tela de fim ────────────────────────────────────────────────── */}
      {(finished || dead) && !endClosed && (
        <EndScreen state={state} onClose={() => setEndClosed(true)} />
      )}
      <SpokenScene state={state} />
      <ParticipantTransition state={state} />
      <HorrorCinematics state={state} />
      <D20Overlay roll={state.lastRoll} />
    </div>
  );
}
