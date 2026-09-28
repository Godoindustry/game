/**
 * Modos de dificuldade, escolhidos na criação da sala e gravados em `world.flags.dificuldade`.
 *
 * Tudo que muda entre modos está nesta tabela — o resto do motor só lê os números:
 *  - dcShift: soma na CD do D20 (positivo = mais difícil);
 *  - critFailMax: rolagens naturais até este valor são falha crítica (INSANO falha no 1 e no 2);
 *  - drain: multiplica fome, sede e cansaço;
 *  - damage: multiplica dano de sangramento, frio, fome e sede;
 *  - creature*: agressividade das criaturas da noite;
 *  - turnAt: mordidas até virar vampiro.
 */
export const DIFFICULTIES = ["facil", "medio", "dificil", "sobrevivencia", "insano"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface DifficultyRules {
  label: string;
  description: string;
  dcShift: number;
  critFailMax: number;
  drain: number;
  damage: number;
  /** Minutos de jogo mínimos entre dois encontros com criaturas. */
  creatureCooldown: number;
  /** Bônus (em %) na chance de esquivar da criatura. */
  dodgeBonus: number;
  turnAt: number;
  /** 0..1 — quanto a IA das criaturas tende a atacar em vez de rondar. */
  aggression: number;
}

export const DIFFICULTY_RULES: Record<Difficulty, DifficultyRules> = {
  facil: {
    label: "Fácil",
    description: "Para conhecer o vale. Testes mais generosos, o corpo aguenta mais e as criaturas hesitam.",
    dcShift: -3, critFailMax: 1, drain: 0.75, damage: 0.7, creatureCooldown: 60, dodgeBonus: 20, turnAt: 4, aggression: 0.25,
  },
  medio: {
    label: "Médio",
    description: "O equilíbrio pensado para o Vale Silente.",
    dcShift: 0, critFailMax: 1, drain: 1, damage: 1, creatureCooldown: 30, dodgeBonus: 0, turnAt: 3, aggression: 0.5,
  },
  dificil: {
    label: "Difícil",
    description: "Menos margem de erro. A noite cobra caro e os testes apertam.",
    dcShift: 2, critFailMax: 1, drain: 1.2, damage: 1.25, creatureCooldown: 25, dodgeBonus: -10, turnAt: 3, aggression: 0.65,
  },
  sobrevivencia: {
    label: "Sobrevivência",
    description: "Além do difícil: recursos escassos, corpo frágil e criaturas que caçam em bando.",
    dcShift: 3, critFailMax: 1, drain: 1.4, damage: 1.5, creatureCooldown: 20, dodgeBonus: -15, turnAt: 2, aggression: 0.8,
  },
  insano: {
    label: "INSANO",
    description: "Realismo máximo dentro da fantasia. Falha crítica no 1 e no 2, fome e frio implacáveis, e duas mordidas bastam.",
    dcShift: 5, critFailMax: 2, drain: 1.65, damage: 1.9, creatureCooldown: 15, dodgeBonus: -25, turnAt: 2, aggression: 0.95,
  },
};

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === "string" && (DIFFICULTIES as readonly string[]).includes(v);
}

/** Campanhas antigas (sem a flag) jogam no Médio. */
export function difficultyOf(flags: Record<string, unknown> | undefined): Difficulty {
  const v = flags?.dificuldade;
  return isDifficulty(v) ? v : "medio";
}

export function rulesFor(d: Difficulty | undefined): DifficultyRules {
  return DIFFICULTY_RULES[d ?? "medio"];
}
