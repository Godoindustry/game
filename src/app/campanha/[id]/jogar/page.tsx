"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EcgLine, Logo, Spinner, useRequireUser } from "@/client/ui";
import { useGame } from "@/client/game/useGame";
import { MapView } from "@/client/game/MapView";
import { CharacterPanel } from "@/client/game/CharacterPanel";
import { Inventory } from "@/client/game/Inventory";
import { EndScreen, EventCard, Feed, HereCard, PartyList, PendingCard } from "@/client/game/Panels";
import { ObjectiveCompass } from "@/client/game/Compass";
import { ScreenFx } from "@/client/game/ScreenFx";
import { Tutorial, restartTutorial } from "@/client/game/Tutorial";
import { useAudio, useHealthAudio, SFX } from "@/client/game/useAudio";

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
  const [panel, setPanel] = useState<"char" | "bag" | null>(null);
  const [endClosed, setEndClosed] = useState(false);
  const { play, toggle, enabled } = useAudio();

  // Alertas automáticos de saúde (sangue, hipotermia, etc.)
  useHealthAudio(state?.me);

  useEffect(() => {
    if (state?.campaign.status === "lobby") router.replace(`/campanha/${id}/lobby`);
  }, [state?.campaign.status, id, router]);

  // Toca áudio ambiental quando cai a noite
  const isNight = state?.campaign.night;
  useEffect(() => {
    if (isNight) play(SFX.EVENT_NOITE, { vol: 0.4 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNight]);

  // A seleção no mapa vale só até a próxima mensagem do diário (derivado, sem efeito).
  const lastLog = state?.log[state.log.length - 1]?.id;
  const [pick, setPick] = useState<{ id: string | null; log: number | undefined }>({ id: null, log: undefined });
  const selected = pick.log === lastLog ? pick.id : null;
  const setSelected = (locId: string | null) => setPick({ id: locId, log: lastLog });

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
    <div className="game">

      {/* ── HUD superior ──────────────────────────────────────────────── */}
      <header className="hud">
        {/* Voltar */}
        <Link href="/painel" aria-label="Voltar ao painel">
          <Logo size={30} />
        </Link>

        {/* Nome da campanha */}
        <div className="hud-block hide-mobile" style={{ maxWidth: 200, overflow: "hidden" }}>
          <span
            className="label"
            style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}
          >
            {state.campaign.name}
          </span>
          <span className="tiny muted">
            {state.campaign.mode === "solo" ? "Solo" : "Cooperativo"} · rodada {state.campaign.round}
          </span>
        </div>

        <div className="spacer" />

        {/* Relógio do jogo */}
        <div className="hud-block" style={{ alignItems: "center" }} data-tut-id="clock">
          <span className="hud-clock">{state.campaign.clock}</span>
          <span className="tiny muted" style={{ display: "flex", gap: 6 }}>
            <span>DIA {state.campaign.day}</span>
            <span style={{ color: state.campaign.night ? "var(--blue-2)" : "var(--amber)", fontWeight: 500 }}>
              {state.campaign.night ? "◑ Noite" : "○ Dia"}
            </span>
            <span>{state.campaign.temperature}°C</span>
          </span>
        </div>

        {/* Bússola de objetivo */}
        {!finished && !dead && (
          <ObjectiveCompass state={state} onShow={(l) => { setPanel(null); setSelected(l); setTab("acoes"); }} />
        )}

        <div className="spacer" />

        {/* Som e tutorial */}
        <div className="hud-tools">
          <button
            className="hud-icon"
            onClick={toggle}
            aria-pressed={enabled}
            aria-label={enabled ? "Desligar som" : "Ligar som"}
            title={enabled ? "Som ligado" : "Som desligado"}
          >
            {enabled ? "🔊" : "🔇"}
          </button>
          <button className="hud-icon hide-mobile" onClick={restartTutorial} aria-label="Rever tutorial" title="Rever tutorial">
            ?
          </button>
        </div>

        {/* Status salvo */}
        <div className="hud-block hide-mobile" style={{ alignItems: "flex-end" }}>
          {state.campaign.paused && !finished ? (
            <span className="chip chip-amber" style={{ animation: "chip-blink 1.5s ease-in-out infinite" }}>
              ⏸ Pausada
            </span>
          ) : (
            <span className="chip chip-green">● Salvo</span>
          )}
          <span className="hud-save">{saved}</span>
        </div>

        {/* Avatar do personagem */}
        {me && (
          <button
            className={`avatar-btn ${avatarClass(me)}`}
            onClick={() => setPanel("char")}
            aria-label={`Abrir painel de ${me.name}`}
            title={me.name}
            data-tut-id="avatar"
          >
            {me.name.slice(0, 1).toUpperCase()}
            {/* ECG inline */}
            <EcgLine alive={me.alive} injured={isInjured} />
            {/* Dot de status */}
            <span
              className="dot"
              style={{
                background: dotColor,
                animation: isAlert ? "chip-blink 1s ease-in-out infinite" : undefined,
              }}
            />
          </button>
        )}
      </header>

      {/* ── Corpo do jogo ─────────────────────────────────────────────── */}
      <div className="game-body">

        {/* Mapa top-down */}
        <MapView
          state={state}
          selected={selected}
          onSelect={(l) => { setSelected(l); setTab("acoes"); }}
        />

        {/* Painel lateral */}
        <aside className="game-side">
          {/* Abas */}
          <div className="side-tabs" role="tablist">
            {(
              [
                ["acoes",  "Ações"],
                ["diario", "Diário"],
                ["grupo",  state.campaign.mode === "coop" ? "Grupo" : "Status"],
              ] as [Tab, string][]
            ).map(([t, l]) => (
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
                {finished && (
                  <div className="ok-box">
                    Campanha encerrada.{" "}
                    <button className="btn btn-sm" onClick={() => setEndClosed(false)}>
                      Ver resultado
                    </button>
                  </div>
                )}
                {dead && !finished && (
                  <div className="error-box" style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>☠</div>
                    <strong>Você morreu</strong>
                    <div className="tiny" style={{ marginTop: 4, opacity: 0.75 }}>{me?.deathCause}</div>
                    <div className="tiny muted" style={{ marginTop: 6 }}>Acompanhe o grupo pelo diário.</div>
                  </div>
                )}

                {state.pending && (
                  <PendingCard
                    pending={state.pending}
                    offset={offset}
                    onCancel={cancel}
                    busy={busy}
                  />
                )}
                {state.event && !state.pending && (
                  <EventCard event={state.event} onAct={act} busy={busy} />
                )}
                {!finished && !dead && !state.pending && (
                  <HereCard state={state} onAct={act} busy={busy} selected={selected} />
                )}

                {/* Atalhos rápidos */}
                {me && !finished && (
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => setPanel("bag")}
                      style={{ flex: 1 }}
                      data-tut-id="bag"
                    >
                      🎒 Mochila · {me.load.weightKg}kg
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => setPanel("char")}
                      style={{ flex: 1 }}
                    >
                      Personagem
                    </button>
                  </div>
                )}

                {/* Preview das últimas mensagens */}
                <div className="label" style={{ marginTop: 8 }}>Últimas mensagens</div>
                <Feed log={state.log.slice(-4)} clues={[]} />
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

      {/* ── Imersão: filtros de tela e tutorial ─────────────────────────── */}
      <ScreenFx me={me} />
      {!finished && !dead && <Tutorial state={state} panel={panel} selected={selected} />}

      {/* ── Tela de fim ────────────────────────────────────────────────── */}
      {(finished || dead) && !endClosed && (
        <EndScreen state={state} onClose={() => setEndClosed(true)} />
      )}
    </div>
  );
}
