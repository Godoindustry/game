/**
 * Encontros noturnos com as criaturas do vale (morcegos-vampiro e almas).
 *
 * O cliente só avisa "uma criatura me alcançou no escuro"; quem decide se houve
 * ataque e o que ele custa é esta regra, com limites do servidor:
 *  - só à noite; nunca onde há fogueira acesa (elas fogem do fogo);
 *  - no máximo um encontro a cada 30 minutos de jogo por personagem.
 * Mordidas acumulam a doença "mordida" (sede escura). Na terceira, o personagem vira um deles.
 */
import type { CharacterState, GameContent, WorldState } from "./types";
import type { Rng } from "./rng";
import { clamp, fireActive, initialBleeding, isNight, isSheltered, kill } from "./physiology";

export type CreatureKind = "morcego" | "alma";
export const ENCOUNTER_COOLDOWN_MINUTES = 30;
export const BITE_DURATION_MINUTES = 24 * 60;
export const TURN_AT_LEVEL = 3;

export interface EncounterResult {
  happened: boolean;
  reason: "dia" | "fogo" | "espera" | "morto" | null;
  bitten: boolean;
  level: number;
  died: boolean;
  lines: string[];
}

const cooldownKey = (charId: string) => `vamp_${charId}`;

export function nightEncounter(
  char: CharacterState,
  world: WorldState,
  content: GameContent,
  kind: CreatureKind,
  rng: Rng,
  genId: () => string,
): EncounterResult {
  const none = (reason: EncounterResult["reason"]): EncounterResult => ({ happened: false, reason, bitten: false, level: 0, died: false, lines: [] });
  if (!char.alive) return none("morto");
  if (!isNight(content, world.minute)) return none("dia");
  const loc = char.status.locationId;
  if (fireActive(world, loc)) return none("fogo");
  const last = Number(world.flags[cooldownKey(char.id)] ?? -1e9);
  if (world.minute - last < ENCOUNTER_COOLDOWN_MINUTES) return none("espera");
  world.flags[cooldownKey(char.id)] = world.minute;

  const s = char.status;
  const lines: string[] = [];

  if (kind === "alma") {
    s.stress = clamp(s.stress + 16, 0, 100);
    s.bodyTemp = Math.round((s.bodyTemp - 0.5) * 100) / 100;
    lines.push("Um frio atravessa você de lado a lado. Por um instante, você não sente o próprio coração — e ouve alguém sussurrar seu nome de dentro da névoa.");
    return { happened: true, reason: null, bitten: false, level: currentLevel(char), died: false, lines };
  }

  s.stress = clamp(s.stress + 10, 0, 100);
  const dodge = 25 + (char.attrs.agilidade - 3) * 9 + (isSheltered(world, content, loc) ? 15 : 0);
  if (rng() * 100 < dodge) {
    lines.push("Asas de couro rasgam o ar. Você se joga no chão a tempo — os dentes passam a um dedo do seu pescoço.");
    return { happened: true, reason: null, bitten: false, level: currentLevel(char), died: false, lines };
  }

  const b = applyBite(char, world.minute, genId);
  lines.push(...b.lines);
  return { happened: true, reason: null, bitten: true, level: b.level, died: b.died, lines };
}

/** Mordida: ferida no pescoço + a doença que acumula. Usada pelas criaturas e pelos eventos. */
export function applyBite(char: CharacterState, minute: number, genId: () => string): { level: number; died: boolean; lines: string[] } {
  const s = char.status;
  const lines: string[] = [];
  char.wounds.push({
    id: genId(), bodyPart: "cabeca", type: "laceracao", severity: 1, bleedingRate: initialBleeding("laceracao", 1),
    bandaged: false, disinfected: false, splinted: false, createdAtMinute: minute, healed: false,
  });
  let bite = char.health.diseases.find((d) => d.key === "mordida");
  if (!bite) {
    bite = { key: "mordida", startedAt: minute, until: minute + BITE_DURATION_MINUTES, level: 0 };
    char.health.diseases.push(bite);
  }
  bite.level = (bite.level ?? 0) + 1;
  bite.until = minute + BITE_DURATION_MINUTES;
  s.stress = clamp(s.stress + 12, 0, 100);

  if (bite.level >= TURN_AT_LEVEL) {
    lines.push("Os dentes encontram o mesmo lugar pela terceira vez. O frio não passa mais. Você sente fome — e não é de comida.");
    kill(char, "Mordido pela terceira vez. Algo novo acordou no seu lugar.", minute);
    return { level: bite.level, died: true, lines };
  }
  lines.push(
    bite.level === 1
      ? "Algo desce da escuridão e crava os dentes no seu pescoço. Some antes que você consiga gritar. Duas marcas pequenas, quentes — e uma sede que água não mata."
      : "De novo. Os dentes acham as mesmas marcas. Sua visão escurece nas bordas e a luz da lanterna parece forte demais. Só o fogo afasta essas coisas.",
  );
  return { level: bite.level, died: false, lines };
}

function currentLevel(char: CharacterState) {
  return char.health.diseases.find((d) => d.key === "mordida")?.level ?? 0;
}
