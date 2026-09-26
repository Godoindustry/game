"use client";
/**
 * MapView — mapa top-down do Vale Silente.
 * Visão radar: grade topográfica, névoa de guerra, marcadores táticos, personagens.
 */
import { useNow, type GameState } from "./useGame";
import { dayPhase } from "./Scene";
import { PixelCanvas } from "./PixelCanvas";

const H = (941 / 1672) * 100; // altura proporcional do viewBox (100×H)
// Cores de identificação dos jogadores (evita vermelho — reservado para perigo)
const PARTY_COLORS = ["#e8a020", "#5aaad4", "#7ecb85", "#a08ec8"];

export function MapView({
  state,
  selected,
  onSelect,
  offset = 0,
}: {
  state: GameState;
  selected: string | null;
  onSelect: (id: string) => void;
  offset?: number;
}) {
  const { map, party } = state;
  const here = state.here.locationId;
  const night = state.campaign.night;
  const temp = state.campaign.temperature;
  const phase = dayPhase(state.campaign.clock);
  const rain = state.campaign.weather === "chuva";

  const pos = (id: string) => {
    const l = map.locations.find((x) => x.id === id);
    return l ? { x: l.x, y: (l.y / 100) * H } : null;
  };
  const reachable = new Set(map.travel.map((t) => t.to));

  // Caminhada em andamento: o marcador avança pela trilha no ritmo da espera real.
  const pend = state.pending;
  const travelTo = pend?.type === "mover" && pend.target ? pos(pend.target) : null;
  const now = useNow(!!travelTo, offset);
  let travelPct = 0;
  if (travelTo && pend) {
    const t0 = Date.parse(pend.submittedAt);
    const t1 = Date.parse(pend.completesAt);
    travelPct = t1 > t0 ? Math.min(1, Math.max(0, (now - t0) / (t1 - t0))) : 1;
  }
  const hereXY = pos(here);
  const meXY = (from: { x: number; y: number }) =>
    travelTo ? { x: from.x + (travelTo.x - from.x) * travelPct, y: from.y + (travelTo.y - from.y) * travelPct } : from;
  // Centro da "lanterna" noturna, em % da imagem.
  const light = hereXY ? meXY(hereXY) : null;

  return (
    <div className={`map-wrap map-phase-${phase}`} data-tut-id="map">
      <div className="map-stage">
        <div className="map-inner">

          {/* Imagem base do mapa, redesenhada em pixel art (1/4 da resolução) */}
          <PixelCanvas
            className="map-img"
            src={map.image}
            width={418}
            height={235}
            phase={phase}
            label="Mapa do Vale Silente visto de cima"
          />

          {/* Grade topográfica */}
          <div className="map-grid" />

          {/* Luz do horário: amanhecer, dia, entardecer */}
          <div className="map-grade" />

          {/* Noite: tudo escuro, menos o raio da sua lanterna */}
          <div
            className="map-night"
            style={{
              opacity: night ? 1 : 0,
              ["--lx" as string]: `${light?.x ?? 50}%`,
              ["--ly" as string]: `${((light?.y ?? H / 2) / H) * 100}%`,
            }}
          />

          {/* Névoa viva e chuva */}
          <div className="map-fog map-fog-a" />
          <div className="map-fog map-fog-b" />
          {rain && <div className="map-rain" />}

          {/* SVG de sobreposição: névoa, trilhas, marcadores */}
          <svg
            className="map-svg"
            viewBox={`0 0 100 ${H}`}
            role="group"
            aria-label="Locais do mapa"
          >
            <defs>
              {/* Desfoque para névoa suave */}
              <filter id="fog-blur" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="2.8" />
              </filter>
              {/* Brilho para marcadores ativos */}
              <filter id="glow-amber" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="1.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-red" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {/* Máscara de névoa de guerra */}
              <mask id="fog-of-war">
                <rect x="0" y="0" width="100" height={H} fill="white" />
                {map.locations.map((l) => (
                  <circle
                    key={l.id}
                    cx={l.x}
                    cy={(l.y / 100) * H}
                    r={l.visited ? 13 : 6}
                    fill="black"
                    filter="url(#fog-blur)"
                  />
                ))}
              </mask>

              {/* Gradiente para trilhas ativas */}
              <linearGradient id="trail-active" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="var(--amber-2)" stopOpacity="0.6" />
              </linearGradient>

              {/* Brilho de fogueira */}
              <radialGradient id="fire-glow">
                <stop offset="0%" stopColor="#ffd27a" stopOpacity="0.95" />
                <stop offset="35%" stopColor="#ff8a1e" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#ff5a00" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Camada de névoa de guerra */}
            <rect
              x="0" y="0" width="100" height={H}
              fill="#040806"
              opacity="0.84"
              mask="url(#fog-of-war)"
            />

            {/* Trilhas / caminhos */}
            {map.links.map((k) => {
              const a = pos(k.from);
              const b = pos(k.to);
              if (!a || !b) return null;
              const active =
                (k.from === here && reachable.has(k.to)) ||
                (k.to === here && reachable.has(k.from));
              return (
                <g key={`${k.from}-${k.to}`}>
                  {/* Trilha de fundo (mais grossa, menos opaca) */}
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={active ? "var(--amber)" : "var(--text)"}
                    strokeOpacity={active ? 0.15 : 0.06}
                    strokeWidth={active ? 0.8 : 0.5}
                  />
                  {/* Trilha principal tracejada */}
                  <line
                    className={active ? "trail-active" : undefined}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={active ? "var(--amber)" : "#dde5df"}
                    strokeOpacity={active ? 0.85 : 0.28}
                    strokeWidth={active ? 0.28 : 0.18}
                    strokeDasharray={active ? "1.2 0.6" : "0.8 1"}
                  />
                  {/* Duração da trilha */}
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 0.7}
                    textAnchor="middle"
                    style={{
                      fontSize: 1.15,
                      fill: active ? "var(--amber-2)" : "var(--muted)",
                      fontFamily: "var(--font-mono)",
                      paintOrder: "stroke",
                      stroke: "rgba(0,0,0,0.9)",
                      strokeWidth: 0.4,
                      opacity: active ? 1 : 0.7,
                    }}
                  >
                    {k.minutes}′
                  </text>
                </g>
              );
            })}

            {/* Locais do mapa */}
            {map.locations.map((l) => {
              const y = (l.y / 100) * H;
              const isHere = l.id === here;
              const isSel = l.id === selected;
              const isReach = reachable.has(l.id);
              const isDanger = l.danger >= 3;

              const dotColor = isHere
                ? "var(--amber)"
                : isReach
                ? "var(--amber-2)"
                : l.visited
                ? "var(--text)"
                : "var(--muted)";

              const labelColor = isHere
                ? "var(--amber-2)"
                : isReach
                ? "var(--amber)"
                : l.visited
                ? "#c8d4cc"
                : "var(--faint)";

              return (
                <g
                  key={l.id}
                  className="marker"
                  onClick={() => onSelect(l.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${l.name}${isHere ? " (você está aqui)" : ""}${isDanger ? " — área de perigo" : ""}`}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") && onSelect(l.id)
                  }
                  filter={isHere ? "url(#glow-amber)" : isDanger ? "url(#glow-red)" : undefined}
                >
                  {/* Anel de pulsação — posição atual */}
                  {isHere && (
                    <>
                      <circle className="pulse" cx={l.x} cy={y} r={2.2} fill="none" stroke="var(--amber)" strokeWidth="0.3" />
                      <circle className="pulse" cx={l.x} cy={y} r={2.2} fill="none" stroke="var(--amber-2)" strokeWidth="0.2" style={{ animationDelay: "0.5s" }} />
                    </>
                  )}

                  {/* Seleção */}
                  {isSel && !isHere && (
                    <circle cx={l.x} cy={y} r={2.8} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.18" strokeDasharray="0.7 0.5" />
                  )}

                  {/* Círculo do local */}
                  <circle
                    cx={l.x} cy={y}
                    r={isHere ? 1.5 : 1.05}
                    fill={isHere ? "var(--amber)" : "var(--bg)"}
                    stroke={dotColor}
                    strokeWidth={isHere ? 0 : 0.35}
                  />

                  {/* Ícone de perigo */}
                  {isDanger && (
                    <text
                      x={l.x - 3.8} y={y - 1.4}
                      style={{
                        fontSize: 2, fill: "var(--red-2)",
                        paintOrder: "stroke", stroke: "rgba(0,0,0,0.8)", strokeWidth: 0.3,
                      }}
                    >
                      ⚠
                    </text>
                  )}

                  {/* Fogueira: brilho que tremula */}
                  {l.fire && (
                    <g className="map-fire" style={{ pointerEvents: "none" }}>
                      <circle cx={l.x} cy={y} r={5.5} fill="url(#fire-glow)" />
                      <circle cx={l.x + 1.9} cy={y - 1.1} r={0.45} fill="#ffcf6a" />
                    </g>
                  )}

                  {/* Rótulo do local */}
                  <text
                    x={l.x}
                    y={y + 3.4}
                    textAnchor="middle"
                    style={{
                      fontSize: 1.55,
                      fontFamily: "var(--font-head)",
                      textTransform: "uppercase",
                      letterSpacing: 0.07,
                      fill: labelColor,
                      paintOrder: "stroke",
                      stroke: "rgba(0,0,0,0.95)",
                      strokeWidth: 0.5,
                      fontWeight: isHere || isReach ? "bold" : "normal",
                    }}
                  >
                    {l.visited ? l.name : `${l.name} ?`}
                  </text>
                </g>
              );
            })}

            {/* Caminhada em andamento: trilha acesa até o destino */}
            {travelTo && hereXY && (
              <g style={{ pointerEvents: "none" }}>
                <line
                  x1={hereXY.x} y1={hereXY.y} x2={travelTo.x} y2={travelTo.y}
                  stroke="var(--amber-2)" strokeOpacity={0.9} strokeWidth={0.35}
                  strokeDasharray="0.6 0.6" className="trail-active"
                />
                <circle cx={travelTo.x} cy={travelTo.y} r={2.2} fill="none" stroke="var(--amber-2)" strokeWidth={0.2} className="pulse" />
              </g>
            )}

            {/* Marcadores dos jogadores */}
            {party.map((p, i) => {
              const base = pos(p.locationId);
              if (!base || !p.alive) return null;
              const a = p.isMe ? meXY(base) : base;
              const col = PARTY_COLORS[i % 4];
              return (
                <g key={p.characterId}>
                  {/* Sombra do marcador */}
                  <circle
                    cx={a.x + 1.6 + i * 1.1}
                    cy={a.y - 1.2}
                    r={0.8}
                    fill="rgba(0,0,0,0.5)"
                    transform="translate(0, 0.3)"
                  />
                  {/* Marcador principal */}
                  <circle
                    cx={a.x + 1.6 + i * 1.1}
                    cy={a.y - 1.2}
                    r={0.65}
                    fill={col}
                    stroke="#000"
                    strokeWidth={0.2}
                  >
                    <title>{p.name}{p.isMe ? " (você)" : ""}</title>
                  </circle>
                  {/* Ponto do isMe */}
                  {p.isMe && (
                    <circle
                      cx={a.x + 1.6 + i * 1.1}
                      cy={a.y - 1.2}
                      r={0.25}
                      fill="#000"
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Vignetagem nas bordas */}
          <div className="map-vignette" />

          {/* Scanlines */}
          <div className="map-scan" />

          {/* Informações de status sobrepostas */}
          <div className="map-status">
            <div>DIA {state.campaign.day} · {state.campaign.clock}</div>
            <div style={{ color: night ? "var(--blue-2)" : "var(--amber-2)" }}>
              {night ? "◑ NOITE" : "○ DIA"} · {temp}°C
            </div>
            {state.campaign.paused && (
              <div style={{ color: "var(--amber)", animation: "chip-blink 1.5s ease-in-out infinite" }}>
                ⏸ PAUSADA
              </div>
            )}
          </div>

          {/* Bússola */}
          <div className="map-compass">N ↑</div>

          {/* Legenda de cores dos jogadores */}
          {party.filter((p) => p.alive).length > 1 && (
            <div className="map-legend">
              {party.filter((p) => p.alive).map((p, i) => (
                <div
                  key={p.characterId}
                  className="chip"
                  style={{
                    borderColor: PARTY_COLORS[i % 4],
                    color: PARTY_COLORS[i % 4],
                    background: "rgba(0,0,0,0.7)",
                    fontSize: 10,
                    padding: "2px 7px",
                  }}
                >
                  ● {p.name.split(" ")[0]}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
