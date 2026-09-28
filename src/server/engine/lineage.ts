/**
 * Linhagens (raças) que o personagem pode despertar no meio do jogo.
 *
 *  - Vampiro: três mordidas das criaturas aladas (menos nos modos mais duros).
 *  - Lobisomem: a marca lunar (eventos com a fera).
 *  - Assombrado: o toque repetido das almas na névoa — passa a ouvir os mortos.
 *
 * Cada linhagem mexe nos testes de D20 por atributo, de dia e de noite: poder com preço.
 * O motor lê só `lineageOf()` e `lineageCheckModifier()`; a origem de cada uma está nas doenças
 * ("mordida" nível máximo, "licantropia", "assombro" nível máximo).
 */
import type { AttributeKey, CharacterState } from "./types";
import { rulesFor } from "./difficulty";

export const VAMPIRE_LEVEL = 3;
export const HAUNT_LEVEL = 3;

export type LineageKey = "human" | "vampire" | "werewolf" | "haunted" | "hunter";

export interface LineageInfo {
  key: LineageKey;
  label: string;
  description: string;
  powers: string[];
  weaknesses: string[];
}

export const LINEAGES: Record<LineageKey, LineageInfo> = {
  human: {
    key: "human",
    label: "Humano",
    description: "Sua verdadeira linhagem ainda não despertou.",
    powers: [],
    weaknesses: [],
  },
  vampire: {
    key: "vampire",
    label: "Vampiro",
    description: "A noite reconhece você. Sangue e fogo agora têm outro significado.",
    powers: ["À noite: +15% em força, agilidade, percepção, furtividade e comunicação", "As criaturas aladas não mordem mais você"],
    weaknesses: ["De dia: −10% em testes físicos (a luz pesa)", "A sede escura nunca passa por completo"],
  },
  werewolf: {
    key: "werewolf",
    label: "Lobisomem",
    description: "A lua ampliou seus sentidos. A fera é poder — e preço.",
    powers: ["À noite: +20% em força, resistência, percepção e orientação", "De dia: +5% em percepção"],
    weaknesses: ["À noite: −10% em controle emocional e comunicação (a fera fala primeiro)"],
  },
  haunted: {
    key: "haunted",
    label: "Assombrado",
    description: "Os mortos do vale falam com você. Nem sempre é um presente.",
    powers: ["À noite: +15% em percepção e inteligência", "As almas não roubam mais o seu calor"],
    weaknesses: ["−5% em comunicação (os vivos sentem o frio em você)", "O toque das almas ainda assusta"],
  },
  hunter: {
    key: "hunter",
    label: "Caçador",
    description: "Você resistiu ao chamado. Continua humano — mas agora enxerga o que caça você.",
    powers: ["De dia: +10% em percepção e controle emocional", "À noite: +5% em controle emocional", "+20% para desviar das criaturas aladas"],
    weaknesses: ["Nenhum poder da noite: só fé, teimosia e luz"],
  },
};

export function lineageOf(char: Pick<CharacterState, "health">): LineageKey {
  const d = char.health.diseases;
  if (d.some((x) => x.key === "licantropia")) return "werewolf";
  if (d.find((x) => x.key === "mordida")?.until === Number.MAX_SAFE_INTEGER) return "vampire";
  if (d.find((x) => x.key === "assombro")?.until === Number.MAX_SAFE_INTEGER) return "haunted";
  if (d.some((x) => x.key === "fe")) return "hunter";
  return "human";
}

const PHYSICAL: AttributeKey[] = ["forca", "resistencia", "agilidade"];

/** Bônus/penalidade (em pontos percentuais) da linhagem num teste. `night` indefinido = sem efeito de horário. */
export function lineageCheckModifier(char: Pick<CharacterState, "health">, attr: AttributeKey, night: boolean | undefined): number {
  switch (lineageOf(char)) {
    case "vampire":
      if (night === true && ["forca", "agilidade", "percepcao", "furtividade", "comunicacao"].includes(attr)) return 15;
      if (night === false && PHYSICAL.includes(attr)) return -10;
      return 0;
    case "werewolf":
      if (night === true && ["forca", "resistencia", "percepcao", "orientacao"].includes(attr)) return 20;
      if (night === true && ["controle_emocional", "comunicacao"].includes(attr)) return -10;
      if (night === false && attr === "percepcao") return 5;
      return 0;
    case "haunted":
      if (attr === "comunicacao") return -5;
      if (night === true && (attr === "percepcao" || attr === "inteligencia")) return 15;
      return 0;
    case "hunter":
      if (night === false && (attr === "percepcao" || attr === "controle_emocional")) return 10;
      if (night === true && attr === "controle_emocional") return 5;
      return 0;
    default:
      return 0;
  }
}

/** Progresso rumo a uma linhagem (para o HUD): a maior trilha em andamento. */
export function lineageProgress(char: Pick<CharacterState, "health" | "rules">): { toward: LineageKey; progress: number; max: number } | null {
  if (lineageOf(char) !== "human") return null;
  const bite = char.health.diseases.find((x) => x.key === "mordida")?.level ?? 0;
  const haunt = char.health.diseases.find((x) => x.key === "assombro")?.level ?? 0;
  if (!bite && !haunt) return null;
  return bite >= haunt
    ? { toward: "vampire", progress: bite, max: rulesFor(char.rules?.difficulty).turnAt }
    : { toward: "haunted", progress: haunt, max: HAUNT_LEVEL };
}
