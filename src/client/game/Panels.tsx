"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatMinutes, Spinner } from "../ui";
import { ACTION_LABEL, useNow, type GameState } from "./useGame";
import { useAudio, deathAudioId, SFX } from "./useAudio";

type Act = (type: string, params?: Record<string, unknown>) => void;

// ── Evento / Decisão ────────────────────────────────────────────────────────
export function EventCard({
  event, onAct, busy,
}: {
  event: NonNullable<GameState["event"]>;
  onAct: Act;
  busy: boolean;
}) {
  const isDangerous = event.choices.some((c) => c.label.toLowerCase().includes("corr") || c.label.toLowerCase().includes("fug") || c.label.toLowerCase().includes("enfrent"));

  return (
    <section
      className={`event-card ${isDangerous ? "event-critical" : ""}`}
      aria-live="polite"
      data-tut-id="event"
    >
      <p className="label amber" style={{ marginBottom: 8, fontSize: 10 }}>
        ▶ Evento ativo
      </p>
      <h2 className="event-title">{event.title}</h2>
      <p className="event-body">{event.body}</p>

      {!event.participating ? (
        <div style={{
          padding: "10px 12px", borderRadius: "var(--radius)",
          background: "var(--bg-2)", border: "1px dashed var(--line-2)",
        }}>
          <p className="small muted" style={{ margin: 0 }}>
            Acontecendo com: <strong>{event.participants.join(", ")}</strong>. Você não está no local.
          </p>
        </div>
      ) : (
        <div>
          {event.choices.map((c) => (
            <button
              key={c.id}
              className={`choice ${event.myChoiceId === c.id ? "selected" : ""}`}
              disabled={busy || !c.available}
              onClick={() => onAct("escolha_evento", { choiceId: c.id })}
              title={c.reason ?? undefined}
            >
              <span style={{ flex: 1, textAlign: "left" }}>
                <span style={{ display: "block", fontWeight: 500, fontSize: 14 }}>{c.label}</span>
                {c.reason && (
                  <span className="tiny muted" style={{ display: "block", marginTop: 2 }}>
                    {c.reason}
                  </span>
                )}
              </span>
              <span className="mono tiny muted" style={{ flexShrink: 0 }}>
                {formatMinutes(c.durationMinutes)}
              </span>
            </button>
          ))}
          {event.participants.length > 1 && (
            <p className="tiny muted" style={{ margin: "4px 0 0" }}>
              Decisão em grupo: vence a mais votada; empate, o admin decide. Os testes são individuais.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ── Ação pendente ────────────────────────────────────────────────────────────
export function PendingCard({
  pending, offset, onCancel, busy,
}: {
  pending: NonNullable<GameState["pending"]>;
  offset: number;
  onCancel: () => void;
  busy: boolean;
}) {
  const now  = useNow(true, offset);
  const start = Date.parse(pending.submittedAt);
  const end   = Date.parse(pending.completesAt);
  const pct   = end > start ? Math.min(100, ((now - start) / (end - start)) * 100) : 100;
  const left  = Math.max(0, Math.ceil((end - now) / 1000));
  const done  = left === 0;

  return (
    <section className="pending" aria-live="polite" data-tut-id="pending">
      <div className="row-between" style={{ marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!done && <Spinner />}
          <strong style={{ fontSize: 14 }}>{ACTION_LABEL[pending.type] ?? "Agindo"}…</strong>
        </div>
        <span className="mono small muted">{formatMinutes(pending.durationMinutes)} de jogo</span>
      </div>

      <div className="progress">
        <div style={{ width: `${pct}%` }} />
      </div>

      <div className="row-between small" style={{ marginTop: 4 }}>
        {done ? (
          pending.waitingFor.length ? (
            <span className="muted">
              Aguardando:{" "}
              {pending.waitingFor.map((n, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <strong>{n}</strong>
                </span>
              ))}
            </span>
          ) : (
            <span className="row muted">
              <Spinner /> Resolvendo…
            </span>
          )
        ) : (
          <span className="mono" style={{ color: left < 10 ? "var(--amber)" : "var(--muted)" }}>
            {left}s
          </span>
        )}
        {!done && (
          <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
        )}
      </div>
    </section>
  );
}

// ── Local atual e ações ────────────────────────────────────────────────────
export function HereCard({
  state, onAct, busy, selected,
}: {
  state: GameState;
  onAct: Act;
  busy: boolean;
  selected: string | null;
}) {
  const { here, map } = state;
  const [msg, setMsg] = useState("");
  const sel = selected && selected !== here.locationId
    ? map.locations.find((l) => l.id === selected)
    : null;
  const travelSel = sel ? map.travel.find((t) => t.to === sel.id) : null;

  return (
    <div className="stack">
      {/* Local selecionado no mapa */}
      {sel && (
        <section className="panel panel-tight stack" style={{ gap: 8, borderColor: "rgba(232,160,32,.4)" }}>
          <div className="row-between">
            <strong style={{ fontSize: 15 }}>{sel.name}</strong>
            {sel.danger >= 3 && <span className="chip chip-red chip-pulse">⚠ Perigo</span>}
          </div>
          <span className="small muted">{sel.description}</span>
          {travelSel ? (
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !travelSel.available}
              title={travelSel.reason ?? undefined}
              onClick={() => onAct("mover", { to: sel.id })}
            >
              → Caminhar até lá · ~{formatMinutes(travelSel.estimatedMinutes)}
            </button>
          ) : (
            <span className="tiny muted">Sem caminho direto conhecido daqui.</span>
          )}
        </section>
      )}

      {/* Localização atual */}
      <section className="stack" style={{ gap: 6 }}>
        <div className="row-between">
          <div>
            <p className="label amber" style={{ margin: "0 0 2px" }}>Você está em</p>
            <strong style={{ fontSize: 17, display: "block" }}>{here.name}</strong>
          </div>
          <div className="row" style={{ gap: 5 }}>
            {here.fire  && <span className="chip chip-amber">🔥 Fogo</span>}
            {here.water && <span className="chip chip-blue">💧 Água</span>}
          </div>
        </div>
        <span className="small muted">{here.description}</span>
      </section>

      {/* Grade de ações */}
      {here.actions.length > 0 && (
        <div className="action-grid" data-tut-id="actions">
          {here.actions
            .filter(
              (a) =>
                a.available ||
                !["tomar_analgesico", "acender_fogueira", "montar_abrigo", "coletar_lenha"].includes(a.type)
            )
            .map((a) => (
              <button
                key={a.label}
                className="action-btn"
                disabled={busy || !a.available}
                title={a.reason ?? undefined}
                onClick={() => onAct(a.type, a.params)}
              >
                <span className="t">{a.label}</span>
                <span className="d">{a.available ? formatMinutes(a.minutes) : a.reason}</span>
              </button>
            ))}
        </div>
      )}

      {/* Caminhos disponíveis */}
      {map.travel.length > 0 && here.actions.length > 0 && (
        <section className="stack" style={{ gap: 5 }}>
          <div className="label">Caminhos</div>
          {map.travel.map((t) => (
            <button
              key={t.to}
              className="choice"
              style={{ marginBottom: 0 }}
              disabled={busy || !t.available}
              title={t.reason ?? undefined}
              onClick={() => onAct("mover", { to: t.to })}
            >
              <span>→ {t.name}</span>
              <span className="mono tiny muted">~{formatMinutes(t.estimatedMinutes)}</span>
            </button>
          ))}
        </section>
      )}

      {/* Conversa com NPC */}
      {here.npc && here.actions.length > 0 && (
        <form
          className="panel panel-tight stack"
          style={{ gap: 8, borderColor: "rgba(160,142,200,.5)" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!msg.trim()) return;
            onAct("conversar", { message: msg.trim() });
            setMsg("");
          }}
        >
          <div className="row-between">
            <div>
              <span className="label violet" style={{ display: "block", marginBottom: 2 }}>NPC</span>
              <strong style={{ fontSize: 15 }}>{here.npc.name}</strong>
            </div>
            <span className="tiny muted">5 min por fala</span>
          </div>
          <input
            className="input"
            maxLength={300}
            placeholder="O que você diz?"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
          />
          <button className="btn btn-sm" disabled={busy || !msg.trim()}>
            Falar
          </button>
        </form>
      )}
    </div>
  );
}

// ── Diário / Feed ───────────────────────────────────────────────────────────
export function Feed({
  log, clues,
}: {
  log: GameState["log"];
  clues: GameState["clues"];
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Em navegadores recentes scrollIntoView() retorna uma Promise: não pode ser o retorno do efeito
    // (o React tentaria chamá-la como limpeza e a tela do jogo quebra).
    void end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [log.length]);

  return (
    <div className="stack">
      {clues.length > 0 && (
        <details className="panel panel-tight" style={{ borderColor: "rgba(90,170,212,0.35)" }}>
          <summary
            className="label"
            style={{ cursor: "pointer", color: "var(--blue-2)", letterSpacing: "0.12em" }}
          >
            🔎 Pistas encontradas ({clues.length})
          </summary>
          <div className="stack" style={{ marginTop: 12, gap: 8 }}>
            {clues.map((c) => (
              <div key={c.key} style={{ paddingLeft: 8, borderLeft: "2px solid var(--blue)" }}>
                <strong className="small" style={{ color: "var(--blue-2)" }}>{c.title}</strong>
                <div className="small muted" style={{ marginTop: 2 }}>{c.text}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="feed">
        {log.map((l, idx) => (
          <div
            key={l.id}
            className={`msg msg-${l.kind} ${idx === log.length - 1 ? "msg-new" : ""}`}
          >
            <div className="msg-meta">DIA {l.day} · {l.clock}</div>
            {l.text}
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}

// ── Grupo ───────────────────────────────────────────────────────────────────
const PARTY_COLORS_HEX = ["#e8a020", "#5aaad4", "#7ecb85", "#a08ec8"];

export function PartyList({ state }: { state: GameState }) {
  const locName = (id: string) =>
    state.map.locations.find((l) => l.id === id)?.name ?? "?";

  return (
    <div className="stack">
      {state.party.map((p, i) => {
        const color = PARTY_COLORS_HEX[i % 4];
        const hp = p.health;
        const hpColor = hp < 30 ? "var(--red)" : hp < 60 ? "var(--amber)" : "var(--green)";
        return (
          <div
            key={p.characterId}
            className="panel panel-tight"
            style={{
              borderColor: p.isMe ? `${color}55` : undefined,
              background: p.isMe
                ? `linear-gradient(160deg, ${color}08, var(--panel))`
                : undefined,
            }}
          >
            <div className="row-between" style={{ flexWrap: "nowrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {/* Indicador de cor do jogador */}
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: p.alive ? color : "var(--faint)",
                  flexShrink: 0,
                  boxShadow: p.alive ? `0 0 6px ${color}` : undefined,
                }} />
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600 }}>
                    {p.name}
                    {p.isMe && <span className="tiny faint" style={{ marginLeft: 5 }}>(você)</span>}
                  </div>
                  <div className="tiny muted">
                    {p.player} · {p.alive ? locName(p.locationId) : `morto — ${p.deathCause}`}
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 5, flexShrink: 0 }}>
                <span className={`chip ${p.online ? "chip-green" : ""}`} style={{ fontSize: 10 }}>
                  {p.online ? "● online" : "offline"}
                </span>
                {p.alive && (
                  <span className={`chip ${p.acted ? "chip-amber" : ""}`} style={{ fontSize: 10 }}>
                    {p.acted ? "agiu" : "…"}
                  </span>
                )}
                {p.alive && (
                  <span
                    className="chip mono"
                    style={{ fontSize: 10, color: hpColor, borderColor: `${hpColor}55` }}
                  >
                    {p.health}♥
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {state.campaign.mode === "coop" && (
        <p className="tiny muted" style={{ margin: 0, paddingTop: 4 }}>
          A rodada avança quando todos agem. Quem não responder no prazo faz uma ação segura automaticamente.
        </p>
      )}
    </div>
  );
}

// ── Tela de Fim ─────────────────────────────────────────────────────────────
export function EndScreen({
  state, onClose,
}: {
  state: GameState;
  onClose: () => void;
}) {
  const e   = state.ending;
  const me  = state.me;
  const died    = me && !me.alive;
  const victory = e?.type === "victory" && !died;
  const title   = e ? (died ? "Você morreu" : e.title) : "Você morreu";

  const { play } = useAudio(0.6);

  useEffect(() => {
    // Voz expresiva ElevenLabs — escolhe baseado na causa da morte
    if (victory) {
      play(SFX.VICTORY, { vol: 0.6 });
    } else {
      play(deathAudioId(me?.deathCause ?? undefined), { vol: 0.6 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`end-screen ${victory ? "end-victory" : "end-defeat"}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="end-card stack-lg">
        {/* Subtítulo */}
        <p className="label" style={{ margin: 0, letterSpacing: "0.2em" }}>
          {victory
            ? "▶ RESGATE CONFIRMADO"
            : died
            ? `◼ ${me?.deathCause?.toUpperCase() ?? "CAUSA DESCONHECIDA"}`
            : "◼ FIM DA LINHA"}
        </p>

        {/* Título principal */}
        <h1 className="end-title">{title}</h1>

        {/* Texto narrativo */}
        <p style={{ margin: 0, color: "#b8c4be", fontSize: 15, lineHeight: 1.6 }}>
          {e?.text ?? "Seu grupo segue sem você. Você pode acompanhar o diário."}
        </p>

        {/* Estatísticas */}
        {e && (
          <div className="grid-3" style={{ gap: 12 }}>
            <div className="panel panel-tight" style={{ textAlign: "center" }}>
              <div className="label" style={{ marginBottom: 4 }}>Pontuação</div>
              <div className="mono amber2" style={{ fontSize: 32, fontWeight: 700 }}>{e.score}</div>
            </div>
            <div className="panel panel-tight" style={{ textAlign: "center" }}>
              <div className="label" style={{ marginBottom: 4 }}>Sobreviveu</div>
              <div className="mono" style={{ fontSize: 28 }}>{formatMinutes(e.survivedMinutes)}</div>
            </div>
            <div className="panel panel-tight" style={{ textAlign: "center" }}>
              <div className="label" style={{ marginBottom: 4 }}>Pistas</div>
              <div className="mono" style={{ fontSize: 32 }}>
                <span style={{ color: "var(--blue-2)" }}>{e.cluesFound}</span>
                <span className="muted" style={{ fontSize: 18 }}>/{e.totalClues}</span>
              </div>
            </div>
          </div>
        )}

        {/* Ações */}
        <div className="row" style={{ justifyContent: "center", gap: 12 }}>
          <button className="btn" onClick={onClose}>Ler o diário</button>
          <Link className="btn btn-primary" href="/painel">Voltar ao painel</Link>
        </div>
      </div>
    </div>
  );
}
