"use client";

import { useState } from "react";
import type { SVGProps } from "react";
import { PART_LABEL, WOUND_LABEL } from "../labels";
import type { GameState } from "./useGame";

type Me = NonNullable<GameState["me"]>;
type BodyPart = "cabeca" | "torso" | "braco_dir" | "braco_esq" | "perna_dir" | "perna_esq";

const BODY_PARTS: { id: BodyPart; short: string }[] = [
  { id: "cabeca", short: "Cabeça" },
  { id: "torso", short: "Torso" },
  { id: "braco_dir", short: "Braço D" },
  { id: "braco_esq", short: "Braço E" },
  { id: "perna_dir", short: "Perna D" },
  { id: "perna_esq", short: "Perna E" },
];

const BODY_SCALE: Record<string, number> = {
  magro: 0.88,
  medio: 1,
  robusto: 1.1,
  acima_do_peso: 1.16,
};

const WOUND_POS: Record<string, [number, number]> = {
  cabeca: [100, 45],
  torso: [100, 136],
  braco_dir: [48, 132],
  braco_esq: [152, 132],
  perna_dir: [78, 275],
  perna_esq: [122, 275],
};

function partTone(me: Me, part: string) {
  const wounds = me.wounds.filter((w) => w.bodyPart === part);
  if (wounds.some((w) => w.bleedingRate > 0)) return "#6d1b2c";
  if (wounds.some((w) => w.severity >= 2)) return "#6a352c";
  if (wounds.length) return "#67523d";
  return "url(#skinShade)";
}

function Clothes({ me, female, backOnly = false }: { me: Me; female: boolean; backOnly?: boolean }) {
  const worn = me.inventory.filter((item) => item.container === "equipped" && item.clothing);
  const slot = (name: string) => worn.find((item) => item.clothing?.slot === name);
  const torso = slot("torso_externo") ?? slot("torso_meio") ?? slot("torso_base");
  const legs = slot("pernas");
  const shoes = slot("pes");
  const backpack = slot("costas");
  const head = slot("cabeca");
  if (backOnly) {
    return backpack ? <g className="silhouette-clothes"><path className="gear-backpack" d="M64 91 Q48 103 51 175 L61 196 L71 183 L70 103 Z M136 91 Q152 103 149 175 L139 196 L129 183 L130 103 Z"><title>{backpack.name}</title></path></g> : null;
  }
  return (
    <g className="silhouette-clothes">
      {torso && (
        female
          ? <path className="garment torso-garment" d="M70 76 Q82 68 90 68 L100 72 L110 68 Q120 68 130 76 C136 103 128 124 132 157 L141 188 Q119 198 100 196 Q81 198 59 188 L68 157 C72 124 64 103 70 76 Z"><title>{torso.name}</title></path>
          : <path className="garment torso-garment" d="M62 74 Q80 65 91 67 L100 72 L109 67 Q120 65 138 74 L134 184 Q116 193 100 192 Q84 193 66 184 Z"><title>{torso.name}</title></path>
      )}
      {legs && <g className="garment leg-garment"><path d="M65 179 Q82 185 97 183 L94 284 L67 284 Q62 231 65 179 Z" /><path d="M103 183 Q118 185 135 179 Q138 231 133 284 L106 284 Z" /><title>{legs.name}</title></g>}
      {shoes && <g className="garment shoe-garment"><path d="M64 323 L94 323 L96 344 Q80 354 55 346 Q55 334 64 323 Z"/><path d="M106 323 L136 323 Q145 334 145 346 Q120 354 104 344 Z"/><title>{shoes.name}</title></g>}
      {head && <path className="garment head-garment" d="M76 37 Q77 8 100 7 Q123 8 124 37 Q113 24 100 23 Q87 24 76 37 Z"><title>{head.name}</title></path>}
    </g>
  );
}

function WoundMarks({ me }: { me: Me }) {
  return (
    <g className="silhouette-wounds">
      {me.wounds.map((wound, index) => {
        const [x, y] = WOUND_POS[wound.bodyPart] ?? [100, 140];
        const dx = (index % 3) * 5 - 5;
        const dy = (index % 2) * 7 - 3;
        return (
          <g key={wound.id} transform={`translate(${x + dx} ${y + dy})`} className={wound.bleedingRate > 0 ? "is-bleeding" : ""}>
            <circle r={wound.severity >= 2 ? 10 : 7} />
            <path d="M-5 -5 L5 5 M-1 -7 L7 1" />
            {wound.bandaged && <rect x="-9" y="-4" width="18" height="8" rx="2" className="bandage" />}
          </g>
        );
      })}
    </g>
  );
}

export function BodySilhouette({ me }: { me: Me }) {
  const female = me.profile.sex === "feminino";
  const scale = BODY_SCALE[me.profile.bodyType] ?? 1;
  const deadClass = me.alive ? "" : " silhouette-dead";
  const firstWound = me.wounds[0]?.bodyPart as BodyPart | undefined;
  const [selected, setSelected] = useState<BodyPart>(firstWound ?? "torso");
  const selectedWounds = me.wounds.filter((wound) => wound.bodyPart === selected);
  const bleeding = selectedWounds.some((wound) => wound.bleedingRate > 0);

  const zone = (part: BodyPart): SVGProps<SVGGElement> => ({
    className: `body-zone ${selected === part ? "is-selected" : ""} ${me.wounds.some((wound) => wound.bodyPart === part) ? "has-wound" : ""}`,
    role: "button",
    tabIndex: 0,
    "aria-label": `Ver ${PART_LABEL[part] ?? part}`,
    onClick: () => setSelected(part),
    onFocus: () => setSelected(part),
    onKeyDown: (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setSelected(part);
    },
  });

  return (
    <div className={`human-silhouette ${female ? "silhouette-female" : "silhouette-male"}${deadClass}`}>
      <svg viewBox="0 0 200 365" role="img" aria-label={`Silhueta ${female ? "feminina" : "masculina"} de ${me.name} com roupas e ferimentos`}>
        <defs>
          <linearGradient id="skinShade" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#857568" />
            <stop offset=".52" stopColor="#5e5049" />
            <stop offset="1" stopColor="#342b2c" />
          </linearGradient>
          <linearGradient id="clothShade" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#3c4140" />
            <stop offset=".55" stopColor="#242928" />
            <stop offset="1" stopColor="#111515" />
          </linearGradient>
          <linearGradient id="bodyRim" x1="0" x2="1">
            <stop offset="0" stopColor="#d1b89b" stopOpacity=".1" />
            <stop offset=".5" stopColor="#fff0d7" stopOpacity=".42" />
            <stop offset="1" stopColor="#7d2336" stopOpacity=".08" />
          </linearGradient>
          <filter id="bodyShadow"><feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#000" floodOpacity=".75" /></filter>
        </defs>
        <ellipse className="silhouette-floor" cx="100" cy="348" rx="63" ry="10" />
        <g transform={`translate(${100 - 100 * scale} 0) scale(${scale} 1)`} filter="url(#bodyShadow)">
          <Clothes me={me} female={female} backOnly />
          <g className="silhouette-body">
            <g {...zone("cabeca")}>
              <ellipse className="body-part head" cx="100" cy="42" rx={female ? 22 : 23} ry="29" fill={partTone(me, "cabeca")} />
              <path className="silhouette-hair" d={female ? "M77 43 Q72 8 100 7 Q130 9 124 52 L117 31 Q99 18 81 33 L80 67 Q73 58 77 43 Z" : "M77 39 Q79 8 101 8 Q121 9 124 37 Q110 23 94 24 Q83 25 77 39 Z"} />
              <g className="body-face" aria-hidden="true">
                <path d="M87 42 Q92 39 96 42 M104 42 Q109 39 114 42" />
                <path d="M100 43 L98 52 L102 53 M93 59 Q100 62 107 59" />
              </g>
            </g>
            <g {...zone("torso")}>
              <path className="silhouette-neck" d="M88 66 L112 66 L116 84 L84 84 Z" fill={partTone(me, "torso")} />
              {female ? (
                <path className="body-part torso" d="M70 77 Q82 68 91 70 L100 75 L109 70 Q118 68 130 77 C138 104 127 126 132 155 Q137 176 144 190 Q121 205 100 202 Q79 205 56 190 Q63 176 68 155 C73 126 62 104 70 77 Z" fill={partTone(me, "torso")} />
              ) : (
                <path className="body-part torso" d="M60 78 Q77 66 91 70 L100 75 L109 70 Q123 66 140 78 L132 185 Q116 201 100 200 Q84 201 68 185 Z" fill={partTone(me, "torso")} />
              )}
              <g className="body-contours" aria-hidden="true">
                <path d="M78 86 Q100 97 122 86 M100 96 L100 174 M80 171 Q100 181 120 171" />
              </g>
            </g>
            <g {...zone("braco_dir")}>
              <path className="body-part arm arm-right" d="M66 80 Q49 79 41 100 Q31 137 28 183 Q27 207 37 222 Q48 220 49 205 L52 159 L65 116 Z" fill={partTone(me, "braco_dir")} />
              <ellipse className="body-part hand" cx="37" cy="225" rx="10" ry="14" fill={partTone(me, "braco_dir")} />
            </g>
            <g {...zone("braco_esq")}>
              <path className="body-part arm arm-left" d="M134 80 Q151 79 159 100 Q169 137 172 183 Q173 207 163 222 Q152 220 151 205 L148 159 L135 116 Z" fill={partTone(me, "braco_esq")} />
              <ellipse className="body-part hand" cx="163" cy="225" rx="10" ry="14" fill={partTone(me, "braco_esq")} />
            </g>
            <g {...zone("perna_dir")}>
              <path className="body-part leg leg-right" d="M62 182 Q80 190 98 187 L94 272 L91 332 Q78 342 64 331 L61 270 Q55 221 62 182 Z" fill={partTone(me, "perna_dir")} />
              <path className="joint-line" d="M64 264 Q78 270 94 264" />
            </g>
            <g {...zone("perna_esq")}>
              <path className="body-part leg leg-left" d="M102 187 Q120 190 138 182 Q145 221 139 270 L136 331 Q122 342 109 332 L106 272 Z" fill={partTone(me, "perna_esq")} />
              <path className="joint-line" d="M106 264 Q122 270 138 264" />
            </g>
          </g>
          <Clothes me={me} female={female} />
          <WoundMarks me={me} />
        </g>
      </svg>
      <div className="silhouette-meta">
        <span>{female ? "Feminina" : "Masculina"}</span>
        <b>{me.profile.heightCm} cm · {me.profile.weightKg} kg</b>
      </div>
      <div className={`body-inspector ${bleeding ? "is-bleeding" : ""}`} aria-live="polite">
        <span>ÁREA SELECIONADA</span>
        <strong>{PART_LABEL[selected] ?? selected}</strong>
        {selectedWounds.length === 0 ? (
          <p>Sem ferimentos registrados.</p>
        ) : (
          <div className="body-inspector-wounds">
            {selectedWounds.map((wound) => (
              <i key={wound.id}>
                {WOUND_LABEL[wound.type] ?? wound.type} · grav. {wound.severity}
                {wound.bleedingRate > 0 ? " · sangrando" : wound.bandaged ? " · enfaixado" : ""}
              </i>
            ))}
          </div>
        )}
      </div>
      <div className="body-part-nav" aria-label="Selecionar região do corpo">
        {BODY_PARTS.map((part) => (
          <button
            key={part.id}
            type="button"
            className={selected === part.id ? "is-active" : ""}
            onClick={() => setSelected(part.id)}
          >
            {part.short}
            {me.wounds.some((wound) => wound.bodyPart === part.id) && <i aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}
