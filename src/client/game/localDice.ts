"use client";
/**
 * D20 rolado no aparelho (DICE_AUTHORITY=client). O resultado aparece no toque, sem esperar a
 * rede; as faces vão junto com a escolha e o servidor aplica as MESMAS regras de rollCheck
 * (src/server/engine/effects.ts) com elas. Se o estado do personagem mudar entre a tela e a
 * resolução (raro), vale o que o servidor calcular — o cartão "O que aconteceu" mostra isso.
 */
import type { GameState } from "./useGame";
import { HAPTIC, vibrate } from "./mobile";

type Choice = NonNullable<GameState["event"]>["choices"][number];
export type ChoiceRoll = NonNullable<Choice["roll"]>;
export type ShownRoll = NonNullable<GameState["lastRoll"]>;

export const LOCAL_ROLL_EVENT = "vale-silente:local-roll";

/** Face 1–20 sem viés (rejeita o resto da divisão). */
function face(): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 20) * 20;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return (buf[0] % 20) + 1;
}

/** Mesmas regras de rollCheck: com desvantagem vale a menor das duas faces. */
export function resolveLocally(roll: ChoiceRoll, faces: [number, number], attribute: string): ShownRoll {
  const value = roll.disadvantage ? Math.min(...faces) : faces[0];
  const crit = value === 20 ? "critical_success" : value <= roll.critFailMax ? "critical_failure" : null;
  const finalTotal = value + roll.modifier;
  return {
    id: `local-${Date.now()}`,
    attribute,
    value,
    target: roll.target,
    modifier: roll.modifier,
    finalTotal,
    success: crit === "critical_success" || (crit !== "critical_failure" && finalTotal >= roll.target),
    advantage: false,
    disadvantage: roll.disadvantage,
    crit,
  };
}

/**
 * Escala de dificuldade do D&D 5e (SRD, "Usando Valores de Habilidade"): a CD em palavras
 * que qualquer jogador de mesa reconhece. Só a regra — nada de API externa.
 */
export function dcLabel(target: number): string {
  if (target <= 5) return "Muito fácil";
  if (target <= 10) return "Fácil";
  if (target <= 15) return "Média";
  if (target <= 20) return "Difícil";
  if (target <= 25) return "Muito difícil";
  return "Quase impossível";
}

/** Face mínima no d20 para passar (20 natural sempre passa; a faixa crítica sempre falha). */
export function faceNeeded(roll: Pick<ChoiceRoll, "target" | "modifier" | "critFailMax">): number {
  return Math.min(20, Math.max(roll.critFailMax + 1, roll.target - roll.modifier));
}

let lastLocal: { value: number; attribute: string; at: number } | null = null;

/** Rola, anuncia para o cartão do D20 e devolve as faces que vão para o servidor. */
export function rollOnDevice(roll: ChoiceRoll): number[] {
  vibrate(HAPTIC.roll);
  const faces: [number, number] = [face(), face()];
  const shown = resolveLocally(roll, faces, roll.attribute);
  lastLocal = { value: shown.value, attribute: shown.attribute, at: Date.now() };
  window.dispatchEvent(new CustomEvent<ShownRoll>(LOCAL_ROLL_EVENT, { detail: shown }));
  return faces;
}

/** O lastRoll que o servidor devolveu é o mesmo dado que o aparelho já mostrou? */
export function isEchoOfLocalRoll(roll: ShownRoll): boolean {
  return !!lastLocal
    && Date.now() - lastLocal.at < 30_000
    && roll.value === lastLocal.value
    && roll.attribute === lastLocal.attribute;
}
