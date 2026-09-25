"use client";
import { Drawer, EcgLine, Meter, formatMinutes } from "../ui";
import { ATTR_LABEL, PART_LABEL, SLOT_LABEL, WOUND_LABEL } from "../labels";
import type { GameState } from "./useGame";

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

function partColor(me: Me, part: string): string {
  const wounds = me.wounds.filter((x) => x.bodyPart === part);
  if (!wounds.length) return "var(--line-2)";
  if (wounds.some((x) => x.bleedingRate > 0)) return "var(--red)";
  const worst = Math.max(...wounds.map((x) => x.severity));
  return worst >= 2 ? "#c0541a" : "var(--amber)";
}

function partStroke(me: Me, part: string): string {
  const wounds = me.wounds.filter((x) => x.bodyPart === part);
  if (!wounds.length) return "var(--line-3)";
  if (wounds.some((x) => x.bleedingRate > 0)) return "#ff4444";
  return "var(--amber)";
}

// ── Diagrama corporal aprimorado ──────────────────────────────────────────
function BodyDiagram({ me }: { me: Me }) {
  const hurtParts = new Set(me.wounds.map((w) => w.bodyPart));
  return (
    <svg
      className="body-svg"
      viewBox="0 0 60 124"
      width="108"
      aria-label="Condição dos membros do personagem"
    >
      {/* Cabeça */}
      <circle
        cx="30" cy="11" r="9.5"
        fill={partColor(me, "cabeca")} stroke={partStroke(me, "cabeca")}
        strokeWidth="1"
      />
      {/* Olhos — fechados se estiver crítico */}
      <line x1="26" y1="10.5" x2="28" y2="10.5" stroke="var(--bg)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="32" y1="10.5" x2="34" y2="10.5" stroke="var(--bg)" strokeWidth="1.2" strokeLinecap="round" />

      {/* Tronco */}
      <rect
        x="18" y="23" width="24" height="38" rx="4"
        fill={partColor(me, "torso")} stroke={partStroke(me, "torso")}
        strokeWidth="1"
      />
      {/* Detalhe: símbolo de coração no tronco se saudável */}
      {!hurtParts.has("torso") && (
        <text x="30" y="41" textAnchor="middle" fontSize="8" fill="var(--faint)">♥</text>
      )}
      {/* Indicador de sangramento no tronco */}
      {me.wounds.filter(w => w.bodyPart === "torso" && w.bleedingRate > 0).length > 0 && (
        <text x="30" y="41" textAnchor="middle" fontSize="8" fill="var(--red)">●</text>
      )}

      {/* Braço direito (esquerda visual) */}
      <rect
        x="5.5" y="24" width="11" height="36" rx="4"
        fill={partColor(me, "braco_dir")} stroke={partStroke(me, "braco_dir")}
        strokeWidth="1"
      />
      {/* Braço esquerdo (direita visual) */}
      <rect
        x="43.5" y="24" width="11" height="36" rx="4"
        fill={partColor(me, "braco_esq")} stroke={partStroke(me, "braco_esq")}
        strokeWidth="1"
      />

      {/* Cintura */}
      <rect x="18" y="60" width="24" height="6" rx="2" fill="var(--panel-2)" stroke="var(--line)" strokeWidth="0.8" />

      {/* Perna direita (esquerda visual) */}
      <rect
        x="18" y="67" width="11" height="52" rx="4"
        fill={partColor(me, "perna_dir")} stroke={partStroke(me, "perna_dir")}
        strokeWidth="1"
      />
      {/* Perna esquerda (direita visual) */}
      <rect
        x="31" y="67" width="11" height="52" rx="4"
        fill={partColor(me, "perna_esq")} stroke={partStroke(me, "perna_esq")}
        strokeWidth="1"
      />

      {/* Indicador de sangramento nas pernas */}
      {me.wounds.filter(w => w.bodyPart === "perna_dir" && w.bleedingRate > 0).map((_, i) => (
        <circle key={i} cx="23" cy={85 + i * 10} r="1.5" fill="var(--red)" opacity="0.8" />
      ))}
      {me.wounds.filter(w => w.bodyPart === "perna_esq" && w.bleedingRate > 0).map((_, i) => (
        <circle key={i} cx="37" cy={85 + i * 10} r="1.5" fill="var(--red)" opacity="0.8" />
      ))}

      {/* Legenda de cores */}
      <g transform="translate(0, 122)">
        <circle cx="6" cy="-2" r="2" fill="var(--green)" />
        <circle cx="16" cy="-2" r="2" fill="var(--amber)" />
        <circle cx="26" cy="-2" r="2" fill="var(--red)" />
      </g>
    </svg>
  );
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
          <div className="label" style={{ marginBottom: 4 }}>Corpo e ferimentos</div>
          <div className="body-grid">
            <BodyDiagram me={me} />
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
                <div key={w.id} className="panel panel-tight stack-sm" style={{
                  gap: 6,
                  borderColor: w.bleedingRate > 0 ? "rgba(214,60,60,0.45)" : w.severity >= 2 ? "rgba(214,60,60,0.25)" : "rgba(232,160,32,0.3)",
                }}>
                  <div className="row-between" style={{ flexWrap: "nowrap" }}>
                    <strong className="small">{WOUND_LABEL[w.type]} · {PART_LABEL[w.bodyPart]}</strong>
                    <span className={`chip ${w.severity >= 2 ? "chip-red" : "chip-amber"}`}>
                      grav. {w.severity}
                    </span>
                  </div>
                  <div className="row tiny" style={{ gap: 4 }}>
                    {w.bleedingRate > 0 && (
                      <span className="chip chip-red chip-pulse">⚡ sangrando</span>
                    )}
                    {w.bandaged   && <span className="chip chip-green">enfaixado</span>}
                    {w.splinted   && <span className="chip chip-green">imobilizado</span>}
                    {w.disinfected && <span className="chip chip-green">limpo</span>}
                  </div>
                  <button
                    className={`btn btn-sm ${w.bleedingRate > 0 ? "btn-critical" : ""}`}
                    data-tut-id={w.bleedingRate > 0 ? "treat" : undefined}
                    disabled={busy || !w.treat.available}
                    title={w.treat.reason ?? undefined}
                    onClick={() => onAct("tratar_ferimento", { woundId: w.id })}
                  >
                    Tratar {w.treat.available ? `· ${w.treat.minutes} min` : ""}
                  </button>
                  {!w.treat.available && w.treat.reason && (
                    <span className="tiny muted">{w.treat.reason}</span>
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
