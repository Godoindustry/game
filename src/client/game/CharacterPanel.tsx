"use client";
import { Drawer, EcgLine, Meter, formatMinutes } from "../ui";
import { ATTR_LABEL, PART_LABEL, SLOT_LABEL, WOUND_LABEL } from "../labels";
import type { GameState } from "./useGame";
import { BodySilhouette } from "./BodySilhouette";

type Me = NonNullable<GameState["me"]>;

// ── Helpers de cor ─────────────────────────────────────────────────────────
function tempColor(t: number) {
  if (t < 33)  return "var(--blue)";    // hipotermia
  if (t < 35)  return "var(--blue-2)";  // frio
  if (t < 36)  return "var(--amber)";   // abaixo do normal
  if (t > 38)  return "var(--amber)";   // febril
  if (t > 39)  return "var(--red)";     // febre alta
  return "var(--green)";                // normal
}

// ── Painel de estado visual do personagem (resumo lateral) ────────────────
function VitalSummaryBadge({ me }: { me: Me }) {
  const h = me.health.health;
  const thirst = me.status.thirst;
  const hunger = me.status.hunger;
  const pain   = me.status.pain;
  const bleeding = me.wounds.some((w) => w.bleedingRate > 0);

  let state = "saudável";
  let stateColor = "var(--green)";
  if (!me.alive)           { state = "morto";        stateColor = "var(--faint)"; }
  else if (h < 15)         { state = "crítico";       stateColor = "var(--red)"; }
  else if (bleeding)       { state = "sangrando";     stateColor = "var(--red)"; }
  else if (h < 40)         { state = "ferido";        stateColor = "var(--red-2)"; }
  else if (pain > 70)      { state = "dor intensa";   stateColor = "var(--amber)"; }
  else if (thirst > 80)    { state = "desidratando";  stateColor = "var(--amber)"; }
  else if (hunger > 80)    { state = "faminto";       stateColor = "var(--amber)"; }
  else if (h < 65)         { state = "debilitado";    stateColor = "var(--amber)"; }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 10px", borderRadius: "var(--radius)",
      background: "var(--bg-2)", border: "1px solid var(--line)",
      marginBottom: 2,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: stateColor,
        boxShadow: `0 0 6px ${stateColor}`,
        flexShrink: 0,
        animation: state === "sangrando" || state === "crítico" ? "chip-blink 1s ease-in-out infinite" : undefined,
      }} />
      <span className="small" style={{ fontFamily: "var(--font-head)", textTransform: "uppercase", letterSpacing: "0.1em", color: stateColor }}>
        {state}
      </span>
      <span className="spacer" />
      <span className="mono tiny muted">{Math.round(h)}hp</span>
    </div>
  );
}

// ── Painel principal ──────────────────────────────────────────────────────
export function CharacterPanel({
  me, onClose, onOpenBag, onAct, busy,
}: {
  me: Me;
  onClose: () => void;
  onOpenBag: () => void;
  onAct: (type: string, params: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const s = me.status;
  const h = me.health;
  const equipped = me.inventory.filter((i) => i.container === "equipped");
  const load = me.load;
  const isInjured = me.wounds.length > 0;

  return (
    <Drawer
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {me.name}
          <EcgLine alive={me.alive} injured={isInjured} />
        </div>
      }
      onClose={onClose}
    >
      <div className="stack-lg">

        {/* Morto */}
        {!me.alive && (
          <div className="error-box" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>☠</div>
            <strong>Personagem morto</strong>
            <div className="tiny" style={{ marginTop: 4, opacity: 0.75 }}>Causa: {me.deathCause}</div>
          </div>
        )}

        {/* Estado geral */}
        <VitalSummaryBadge me={me} />

        <section className={`character-lineage character-lineage-${me.lineage.key}`}>
          <div className="character-lineage-art" aria-hidden="true" />
          <div>
            <span>LINHAGEM</span>
            <strong>{me.lineage.label}</strong>
            <p>{me.lineage.description}</p>
            {!me.lineage.revealed && me.lineage.progress > 0 && (
              <div className="lineage-progress" aria-label={`Marca sobrenatural ${me.lineage.progress} de ${me.lineage.max}`}>
                {Array.from({ length: me.lineage.max }, (_, i) => <i key={i} className={i < me.lineage.progress ? "filled" : ""} />)}
              </div>
            )}
          </div>
        </section>

        {/* Sinais vitais */}
        <section className="stack-sm">
          <div className="label" style={{ marginBottom: 4 }}>Sinais vitais</div>
          <Meter label="Saúde"       value={h.health} />
          <Meter label="Sede"        value={s.thirst}   invert />
          <Meter label="Fome"        value={s.hunger}   invert />
          <Meter label="Energia"     value={s.energy} />
          <Meter label="Sono"        value={s.fatigue}  invert />
          <Meter label="Dor"         value={s.pain}     invert />
          <Meter label="Estresse"    value={s.stress}   invert />
          <Meter
            label="Temperatura"
            value={Math.max(0, s.bodyTemp - 30)}
            max={10}
            color={tempColor(s.bodyTemp)}
            display={`${s.bodyTemp.toFixed(1)}°C`}
          />
          <Meter label="Umidade"     value={s.wetness}  invert color="var(--blue)" />
          <Meter label="Infecção"    value={h.infection} invert />
          <Meter label="Mobilidade"  value={h.mobility} />

          {/* Chips de condições especiais */}
          <div className="row" style={{ marginTop: 4, gap: 6, flexWrap: "wrap" }}>
            {h.diseases.map((d) => (
              <span key={d.key} className="chip chip-red chip-pulse">{d.label}</span>
            ))}
            {h.painkillerActive && (
              <span className="chip chip-green">Analgésico ativo</span>
            )}
            {s.awakeMinutes > 18 * 60 && (
              <span className="chip chip-amber">
                Acordado há {formatMinutes(s.awakeMinutes)}
              </span>
            )}
            {s.wetness > 60 && (
              <span className="chip chip-blue">Encharcado</span>
            )}
            {s.bodyTemp < 35 && (
              <span className="chip chip-blue chip-pulse">Hipotermia</span>
            )}
          </div>
        </section>

        <hr className="divider" />

        {/* Corpo e ferimentos */}
        <section className="stack-sm">
          <div className="body-section-heading">
            <span>
              <small>MAPA DE SAÚDE</small>
              <strong>Corpo e ferimentos</strong>
            </span>
            <i className={me.wounds.some((wound) => wound.bleedingRate > 0) ? "is-critical" : me.wounds.length ? "is-wounded" : ""}>
              {me.wounds.length ? `${me.wounds.length} ${me.wounds.length === 1 ? "FERIMENTO" : "FERIMENTOS"}` : "CORPO ÍNTEGRO"}
            </i>
          </div>
          <div className="body-grid">
            <BodySilhouette me={me} />
            <div className="stack-sm">
              {me.wounds.length === 0 && (
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: 6, padding: "16px 8px",
                  color: "var(--green)", opacity: 0.7,
                }}>
                  <span style={{ fontSize: 20 }}>✓</span>
                  <span className="tiny">Sem ferimentos</span>
                </div>
              )}
              {me.wounds.map((w) => (
                <div key={w.id} className={`panel panel-tight stack-sm wound-card ${w.bleedingRate > 0 ? "is-bleeding" : w.severity >= 2 ? "is-severe" : ""}`}>
                  <div className="row-between wound-card-head">
                    <strong className="small">{WOUND_LABEL[w.type]} · {PART_LABEL[w.bodyPart]}</strong>
                    <span className={`chip ${w.severity >= 2 ? "chip-red" : "chip-amber"}`}>
                      grav. {w.severity}
                    </span>
                  </div>
                  <div className="row tiny wound-card-status">
                    {w.bleedingRate > 0 && (
                      <span className="chip chip-red chip-pulse">⚡ sangrando</span>
                    )}
                    {w.bandaged   && <span className="chip chip-green">enfaixado</span>}
                    {w.splinted   && <span className="chip chip-green">imobilizado</span>}
                    {w.disinfected && <span className="chip chip-green">limpo</span>}
                  </div>
                  {w.care.length > 0 ? (
                    <div className="wound-care-list">
                      {w.care.map((opt) => (
                        <div key={opt.material} className={`wound-care-option care-${opt.material} ${opt.available ? "" : "is-unavailable"}`}>
                          <button
                            className={`wound-care-button ${opt.material === "atadura" && w.bleedingRate > 0 ? "is-urgent" : ""}`}
                            data-tut-id={opt.material === "atadura" && w.bleedingRate > 0 ? "treat" : undefined}
                            disabled={busy || !opt.available}
                            title={opt.reason ?? opt.hint}
                            onClick={() => onAct("tratar_ferimento", { woundId: w.id, material: opt.material })}
                          >
                            <span className="wound-care-icon" aria-hidden="true">{opt.material === "atadura" ? "+" : "◇"}</span>
                            <span className="wound-care-copy">
                              <b>{opt.label}</b>
                              <small>{opt.material === "atadura" ? "ATADURA" : "ANTISSÉPTICO"}</small>
                            </span>
                            <span className="wound-care-time">{opt.available ? `${opt.minutes} MIN` : "INDISP."}</span>
                          </button>
                          <span className="wound-care-hint">{opt.available ? opt.hint : opt.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="wound-care-complete"><i aria-hidden="true">✓</i> Já cuidado. Agora só o tempo cura.</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* Roupas e equipamento */}
        <section className="stack-sm">
          <div className="row-between" style={{ marginBottom: 4 }}>
            <div className="label">Roupas e equipamento</div>
            <button className="btn btn-sm btn-primary" onClick={onOpenBag} data-tut-id="bag">
              Mochila
            </button>
          </div>
          {equipped.length === 0 && (
            <span className="small muted">Sem itens equipados.</span>
          )}
          {equipped.map((i) => (
            <div key={i.id} className="row-between small" style={{
              borderBottom: "1px solid var(--line)", paddingBottom: 7, paddingTop: 3,
            }}>
              <span style={{ fontWeight: 500 }}>{i.name}</span>
              <span className="muted tiny">
                {SLOT_LABEL[i.clothing?.slot ?? ""] ?? ""}
                {i.clothing && i.clothing.warmth > 0 && ` · ${i.clothing.warmth}°`}
              </span>
            </div>
          ))}

          {/* Carga */}
          <div style={{ marginTop: 4 }}>
            <Meter
              label="Carga"
              value={load.weightKg}
              max={load.maxKg}
              display={`${load.weightKg}kg`}
              invert
              color={
                load.weightKg > load.comfortableKg
                  ? "var(--red)"
                  : load.weightKg > load.comfortableKg * 0.7
                  ? "var(--amber)"
                  : "var(--green)"
              }
            />
            <span className="tiny muted" style={{ display: "block", marginTop: 4 }}>
              Confortável até {load.comfortableKg} kg · máximo {load.maxKg} kg
              {load.encumbrance > 1 && (
                <span className="amber2"> · ritmo ×{load.encumbrance}</span>
              )}
            </span>
          </div>
        </section>

        <hr className="divider" />

        {/* Atributos */}
        <section className="stack-sm">
          <div className="label" style={{ marginBottom: 4 }}>Atributos</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 8px" }}>
            {Object.entries(me.attributes).map(([k, v]) => (
              <div key={k} className="row-between small" style={{ flexWrap: "nowrap" }}>
                <span className="muted">{ATTR_LABEL[k]?.label ?? k}</span>
                <span className="mono" style={{
                  color: v >= 8 ? "var(--green)" : v >= 5 ? "var(--text)" : "var(--muted)",
                  fontWeight: v >= 8 ? 600 : 400,
                }}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </section>

        <p className="disclaimer">
          Saúde, ferimentos e tratamentos são mecânicas de jogo — não use como orientação médica real.
        </p>
      </div>
    </Drawer>
  );
}
