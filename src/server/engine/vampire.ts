/**
 * Encontros noturnos com as criaturas do vale (morcegos-vampiro e almas).
 *
 * O cliente só avisa "uma criatura me alcançou no escuro"; quem decide se houve
 * ataque e o que ele custa é esta regra, com limites do servidor:
 *  - só à noite; nunca onde há fogueira acesa (elas fogem do fogo);
 *  - intervalo mínimo entre encontros por personagem (depende da dificuldade).
 *
 * A ATITUDE da criatura (atacar, rondar, fugir…) pode vir da IA — mas só de uma lista
 * fechada; a mecânica de cada atitude é daqui. Sem IA, a atitude sai do RNG, pesada pela
 * agressividade da dificuldade.
 *
 * Mordidas acumulam a "mordida" (sede escura) → linhagem Vampiro.
 * Toques das almas acumulam o "assombro" → linhagem Assombrado.
 */
import type { CharacterState, GameContent, WorldState } from "./types";
import type { Rng } from "./rng";
import { clamp, fireActive, initialBleeding, isNight, isSheltered } from "./physiology";
import { difficultyOf, rulesFor } from "./difficulty";
import { HAUNT_LEVEL, VAMPIRE_LEVEL, lineageOf } from "./lineage";

export type CreatureKind = "morcego" | "alma";
/** Referência do modo Médio (testes e textos). O intervalo real vem da dificuldade. */
export const ENCOUNTER_COOLDOWN_MINUTES = 30;
export const BITE_DURATION_MINUTES = 24 * 60;
export const TURN_AT_LEVEL = VAMPIRE_LEVEL;

export const CREATURE_ATTITUDES = {
  morcego: ["atacar", "rondar", "espreitar", "fugir"],
  alma: ["tocar", "sussurrar", "fugir"],
} as const;
export type CreatureAttitude = (typeof CREATURE_ATTITUDES)[CreatureKind][number];

export interface EncounterResult {
  happened: boolean;
  reason: "dia" | "fogo" | "espera" | "morto" | "protegido" | null;
  attitude: CreatureAttitude | null;
  bitten: boolean;
  level: number;
  died: boolean;
  /** Linhagem despertada neste encontro. */
  turned: "vampire" | "haunted" | null;
  lines: string[];
}

const cooldownKey = (charId: string) => `vamp_${charId}`;

/** Por que não haveria encontro agora (checagem barata, antes de gastar IA). */
export function encounterBlocked(char: CharacterState, world: WorldState, content: GameContent): EncounterResult["reason"] {
  if (!char.alive) return "morto";
  if (!isNight(content, world.minute)) return "dia";
  if (fireActive(world, char.status.locationId)) return "fogo";
  // Disciplinas de proteção (Presença Fria, Luz Firme, Chamado do Bando…).
  if ((char.power?.wardUntil ?? 0) > world.minute) return "protegido";
  const last = Number(world.flags[cooldownKey(char.id)] ?? -1e9);
  if (world.minute - last < rulesFor(difficultyOf(world.flags)).creatureCooldown) return "espera";
  return null;
}

/** Atitude sem IA: agressividade da dificuldade decide. */
export function fallbackAttitude(kind: CreatureKind, world: WorldState, rng: Rng): CreatureAttitude {
  const aggression = rulesFor(difficultyOf(world.flags)).aggression;
  const r = rng();
  if (kind === "alma") return r < aggression ? "tocar" : r < aggression + 0.3 ? "sussurrar" : "fugir";
  return r < aggression ? "atacar" : r < aggression + 0.2 ? "espreitar" : r < aggression + 0.4 ? "rondar" : "fugir";
}

export function nightEncounter(
  char: CharacterState,
  world: WorldState,
  content: GameContent,
  kind: CreatureKind,
  rng: Rng,
  genId: () => string,
  /** Atitude decidida pela IA (ou fallback). Ausente = a criatura ataca/toca. */
  attitude?: CreatureAttitude,
): EncounterResult {
  const none = (reason: EncounterResult["reason"]): EncounterResult => ({
    happened: false, reason, attitude: null, bitten: false, level: 0, died: false, turned: null, lines: [],
  });
  const blocked = encounterBlocked(char, world, content);
  if (blocked) return none(blocked);
  world.flags[cooldownKey(char.id)] = world.minute;

  const rules = rulesFor(difficultyOf(world.flags));
  const s = char.status;
  const lines: string[] = [];
  const lineage = lineageOf(char);
  const done = (extra: Partial<EncounterResult> = {}): EncounterResult => ({
    happened: true, reason: null, attitude: act, bitten: false, level: currentLevel(char), died: false, turned: null, lines, ...extra,
  });

  if (kind === "alma") {
    const act = (attitude && (CREATURE_ATTITUDES.alma as readonly string[]).includes(attitude) ? attitude : "tocar") as CreatureAttitude;
    return almaEncounter(char, world.minute, act, lineage === "haunted", lines, (r) => ({
      happened: true, reason: null, attitude: act, bitten: false, level: currentLevel(char), died: false, turned: r, lines,
    }));
  }

  const act = (attitude && (CREATURE_ATTITUDES.morcego as readonly string[]).includes(attitude) ? attitude : "atacar") as CreatureAttitude;
  if (lineage === "vampire") {
    s.stress = clamp(s.stress - 4, 0, 100);
    lines.push("[whispers] As asas param no ar, a um palmo do seu rosto. A criatura inclina a cabeça — e recua. Ela reconhece o próprio sangue.");
    return done();
  }
  if (act === "fugir") {
    s.stress = clamp(s.stress + 3, 0, 100);
    lines.push("Um bater de asas passa rente e some entre as copas. Seja lá o que for, desistiu de você. Por enquanto.");
    return done();
  }
  if (act === "rondar" || act === "espreitar") {
    s.stress = clamp(s.stress + (act === "espreitar" ? 8 : 5), 0, 100);
    lines.push(
      act === "espreitar"
        ? "[tense] Olhos pequenos e vermelhos refletem sua luz, pendurados de cabeça para baixo num galho. Ele não ataca. [pause] Ele conta quantos vocês são."
        : "Círculos no escuro, cada vez mais baixos. O guincho agudo arranha os ouvidos — e então se afasta, sem pressa.",
    );
    return done();
  }

  s.stress = clamp(s.stress + 10, 0, 100);
  const dodge = 25 + (char.attrs.agilidade - 3) * 9 + (isSheltered(world, content, char.status.locationId) ? 15 : 0) + rules.dodgeBonus + (lineage === "hunter" ? 20 : 0);
  if (rng() * 100 < dodge) {
    lines.push("[gasps] Asas de couro rasgam o ar. Você se joga no chão a tempo — os dentes passam a um dedo do seu pescoço.");
    return done();
  }
  const b = applyBite(char, world.minute, genId, rules.turnAt);
  lines.push(...b.lines);
  return done({ bitten: true, level: b.level, turned: b.turned ? "vampire" : null });
}

function almaEncounter(
  char: CharacterState,
  minute: number,
  act: CreatureAttitude,
  haunted: boolean,
  lines: string[],
  result: (turned: "haunted" | null) => EncounterResult,
): EncounterResult {
  const s = char.status;
  if (act === "fugir") {
    lines.push("Uma silhueta de névoa atravessa a trilha à sua frente e se desfaz antes de chegar perto.");
    return result(null);
  }
  if (act === "sussurrar" || haunted) {
    s.stress = clamp(s.stress + (haunted ? 3 : 8), 0, 100);
    lines.push(
      haunted
        ? "[whispers] A alma para ao seu lado como quem encontra um conhecido. [sighs] Ela murmura um nome que você não conhece — e que não esquece mais."
        : "[whispers] Ninguém está perto. Mesmo assim, alguém diz seu nome — baixinho, bem atrás da sua orelha.",
    );
    return result(null);
  }
  lines.push("[trembling] Um frio atravessa você de lado a lado. Por um instante, você não sente o próprio coração — e ouve alguém sussurrar seu nome de dentro da névoa.");
  const h = applyHaunt(char, minute);
  lines.push(...h.lines);
  return result(h.turned ? "haunted" : null);
}

/**
 * Toque de alma: frio, medo e o "assombro" que acumula. Usado pelas almas e pelos eventos
 * (ex.: o confronto com Iara). No 3º toque desperta a linhagem Assombrado.
 */
export function applyHaunt(char: CharacterState, minute: number): { turned: boolean; lines: string[] } {
  const s = char.status;
  if (lineageOf(char) === "haunted") {
    s.stress = clamp(s.stress + 3, 0, 100);
    return { turned: false, lines: [] };
  }
  s.stress = clamp(s.stress + 16, 0, 100);
  s.bodyTemp = Math.round((s.bodyTemp - 0.5) * 100) / 100;
  let haunt = char.health.diseases.find((d) => d.key === "assombro");
  if (!haunt) {
    haunt = { key: "assombro", startedAt: minute, until: minute + BITE_DURATION_MINUTES, level: 0 };
    char.health.diseases.push(haunt);
  }
  haunt.level = (haunt.level ?? 0) + 1;
  haunt.until = minute + BITE_DURATION_MINUTES;
  if (haunt.level >= HAUNT_LEVEL) {
    haunt.level = HAUNT_LEVEL;
    haunt.until = Number.MAX_SAFE_INTEGER;
    return {
      turned: true,
      lines: ["[long pause] Desta vez o frio não vai embora. Ele fica — e traz vozes. Os mortos do vale agora falam com você: sua linhagem Assombrado despertou."],
    };
  }
  return { turned: false, lines: [] };
}

/** Cura uma marca que ainda não virou linhagem (ex.: derrotar a Mãe das Asas cura a mordida). */
export function cureDisease(char: CharacterState, key: CharacterState["health"]["diseases"][number]["key"]): boolean {
  const before = char.health.diseases.length;
  char.health.diseases = char.health.diseases.filter((d) => d.key !== key || d.until === Number.MAX_SAFE_INTEGER);
  return char.health.diseases.length < before;
}

/**
 * Mordida: ferida no pescoço + a doença que acumula. Usada pelas criaturas e pelos eventos.
 * `turnAt` vem da dificuldade (INSANO/Sobrevivência: 2 mordidas; Fácil: 4).
 */
export function applyBite(
  char: CharacterState,
  minute: number,
  genId: () => string,
  turnAt: number = TURN_AT_LEVEL,
): { level: number; died: boolean; turned: boolean; lines: string[] } {
  const s = char.status;
  const lines: string[] = [];
  const existing = char.health.diseases.find((d) => d.key === "mordida");
  if (existing?.until === Number.MAX_SAFE_INTEGER) {
    return { level: TURN_AT_LEVEL, died: false, turned: false, lines: ["O sangue reconhece o sangue. A criatura recua: você já pertence à noite."] };
  }
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

  if (bite.level >= turnAt) {
    // Normaliza no nível da linhagem: "nível 3" = vampiro em qualquer dificuldade.
    bite.level = TURN_AT_LEVEL;
    bite.until = Number.MAX_SAFE_INTEGER;
    lines.push("[gasps] Os dentes encontram o mesmo lugar outra vez. [long pause] O coração para por um longo segundo — e volta diferente. Você continua consciente. Continua sendo você. Mas agora a noite chama você pelo nome: sua linhagem Vampiro despertou.");
    return { level: bite.level, died: false, turned: true, lines };
  }
  lines.push(
    bite.level === 1
      ? "[terrified] Algo desce da escuridão e crava os dentes no seu pescoço. Some antes que você consiga gritar. Duas marcas pequenas, quentes — e uma sede que água não mata."
      : "De novo. Os dentes acham as mesmas marcas. [breathing heavily] Sua visão escurece nas bordas e a luz da lanterna parece forte demais. Só o fogo afasta essas coisas.",
  );
  return { level: bite.level, died: false, turned: false, lines };
}

/** A maldição lunar é uma transformação jogável, não uma causa de morte. */
export function applyLycanthropy(char: CharacterState, minute: number): { lines: string[] } {
  const existing = char.health.diseases.find((d) => d.key === "licantropia");
  if (existing) return { lines: ["O uivo vibra dentro do seu peito. A lua já conhece seu verdadeiro nome."] };
  char.health.diseases.push({ key: "licantropia", startedAt: minute, until: Number.MAX_SAFE_INTEGER, level: 1 });
  char.status.stress = clamp(char.status.stress + 18, 0, 100);
  return {
    lines: ["[breathing heavily] A mordida fecha depressa demais. Seus ossos doem sob a lua e os sons da mata ficam nítidos, impossíveis. A maldição não tomou sua mente — ela revelou sua linhagem: Lobisomem."],
  };
}

function currentLevel(char: CharacterState) {
  return char.health.diseases.find((d) => d.key === "mordida")?.level ?? 0;
}
