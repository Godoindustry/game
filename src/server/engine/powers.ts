/**
 * Poderes: despertar da linhagem, classe, disciplinas, recurso e compulsão — e a virada do Ato II.
 *
 * Recurso (0..5, nome por linhagem: Fome, Fúria, Eco, Obsessão):
 *  - usar uma disciplina ativa aumenta (custo do poder);
 *  - Vampiro: a Fome também sobe sozinha (+1 a cada 6h) e só baixa se alimentando;
 *  - demais linhagens: descansar/dormir baixa (−1 a cada 3h de descanso);
 *  - no máximo (5), a COMPULSÃO da classe acontece e o recurso cai para 3.
 *
 * Ato II: quando TODOS os vivos já têm classe, liga-se `ato2` — o vale chama o grupo
 * para o acampamento (evento ch_encontro, com o grupo reunido) e a aventura principal começa.
 */
import type { AttributeKey, CharacterState, GameContent, PowerState, WorldState } from "./types";
import type { Activity } from "./physiology";
import { clamp, isNight } from "./physiology";
import { HAUNT_LEVEL, LINEAGES, VAMPIRE_LEVEL, lineageOf, type LineageKey } from "./lineage";
import { CLASS_BY_ID, RESOURCE_AFTER_COMPULSION, RESOURCE_MAX, RESOURCE_NAME, powerById } from "./classes";
import { applyLycanthropy } from "./vampire";

const VAMPIRE_HUNGER_EVERY = 360;
const REST_RELIEF_EVERY = 180;

export function powerOf(char: CharacterState): PowerState {
  char.power ??= { classId: null, resource: 0, buffs: [], wardUntil: 0, clock: 0 };
  return char.power;
}

// ---------- Despertar ----------
export function awaken(char: CharacterState, lineage: Exclude<LineageKey, "human">, minute: number): string[] {
  if (lineageOf(char) !== "human") return [];
  const d = char.health.diseases;
  const permanent = Number.MAX_SAFE_INTEGER;
  switch (lineage) {
    case "vampire":
      char.health.diseases = d.filter((x) => x.key !== "mordida");
      char.health.diseases.push({ key: "mordida", startedAt: minute, until: permanent, level: VAMPIRE_LEVEL });
      break;
    case "werewolf":
      return applyLycanthropy(char, minute).lines;
    case "haunted":
      char.health.diseases = d.filter((x) => x.key !== "assombro");
      char.health.diseases.push({ key: "assombro", startedAt: minute, until: permanent, level: HAUNT_LEVEL });
      break;
    case "hunter":
      char.health.diseases.push({ key: "fe", startedAt: minute, until: permanent, level: 1 });
      break;
  }
  return [];
}

// ---------- Classe ----------
export function setClass(char: CharacterState, classId: string): { ok: boolean; line: string } {
  const def = CLASS_BY_ID[classId];
  const p = powerOf(char);
  if (!def || p.classId) return { ok: false, line: "" };
  if (def.lineage !== lineageOf(char)) return { ok: false, line: "Esse caminho não é para a sua linhagem." };
  p.classId = classId;
  p.resource = 1;
  return { ok: true, line: `Você é agora ${def.name}. ${def.passive.name}: ${def.passive.description}` };
}

/** Bônus passivo da classe + perdição + efeitos temporários ativos, para um atributo. */
export function classCheckModifier(char: CharacterState, attr: AttributeKey, worldMinute: number): number {
  const p = char.power;
  if (!p) return 0;
  let mod = 0;
  const def = p.classId ? CLASS_BY_ID[p.classId] : undefined;
  if (def) mod += (def.passive.bonus[attr] ?? 0) + (def.bane.penalty[attr] ?? 0);
  for (const b of p.buffs) if (b.attr === attr && b.until > worldMinute) mod += b.bonus;
  return mod;
}

export function addBuff(char: CharacterState, attr: AttributeKey, bonus: number, until: number): void {
  const p = powerOf(char);
  p.buffs = p.buffs.filter((b) => !(b.attr === attr && b.bonus <= bonus)); // não empilha o mesmo poder
  p.buffs.push({ attr, bonus, until });
}

export function isWarded(char: CharacterState, worldMinute: number): boolean {
  return (char.power?.wardUntil ?? 0) > worldMinute;
}

// ---------- Ações ----------
export function validatePower(
  char: CharacterState,
  world: WorldState,
  content: GameContent,
  powerId: unknown,
): { ok: true; minutes: number } | { ok: false; error: string } {
  const p = char.power;
  if (!p?.classId) return { ok: false, error: "Você ainda não tem uma classe." };
  const def = powerById(p.classId, String(powerId ?? ""));
  if (!def) return { ok: false, error: "Poder desconhecido." };
  if (def.onlyNight && !isNight(content, world.minute)) return { ok: false, error: "Esse poder só desperta à noite." };
  if (p.resource + def.cost > RESOURCE_MAX + 1) {
    return { ok: false, error: `${resourceName(char)} alta demais — descanse ou se alimente antes.` };
  }
  return { ok: true, minutes: def.minutes };
}

export function validateFeed(char: CharacterState, world: WorldState, content: GameContent): { ok: true; minutes: number } | { ok: false; error: string } {
  const lineage = lineageOf(char);
  if (lineage !== "vampire" && lineage !== "werewolf") return { ok: false, error: "Só predadores caçam assim." };
  if (!isNight(content, world.minute)) return { ok: false, error: "A caça só acontece à noite." };
  const terrain = content.locations[char.status.locationId]?.terrain ?? "";
  if (!/mata|lago|trilha|córrego|rochedo/.test(terrain)) return { ok: false, error: "Não há presas aqui. Tente a mata, a trilha ou a água." };
  return { ok: true, minutes: 45 };
}

export function resourceName(char: CharacterState): string {
  const l = lineageOf(char);
  return l === "human" ? "Recurso" : RESOURCE_NAME[l];
}

// ---------- Tempo e compulsão ----------
/**
 * Avança o relógio do recurso após a rodada. Devolve as linhas narrativas e,
 * se houver, os efeitos da compulsão (aplicados por quem chamou, com o contexto de efeitos).
 */
export function tickPowers(char: CharacterState, worldMinute: number, minutes: number, activity: Activity) {
  const p = char.power;
  const out: { lines: string[]; compulsion: ReturnType<typeof compulsionOf> | null } = { lines: [], compulsion: null };
  if (!p?.classId || !char.alive || minutes <= 0) return out;
  p.buffs = p.buffs.filter((b) => b.until > worldMinute);
  const lineage = lineageOf(char);
  p.clock += minutes;
  if (lineage === "vampire") {
    while (p.clock >= VAMPIRE_HUNGER_EVERY) {
      p.clock -= VAMPIRE_HUNGER_EVERY;
      p.resource = clamp(p.resource + 1, 0, RESOURCE_MAX);
      out.lines.push("[hungry] A Fome sobe um degrau. Você sente o pulso de tudo que respira perto.");
    }
  } else if (activity === "rest" || activity === "sleep") {
    while (p.clock >= REST_RELIEF_EVERY) {
      p.clock -= REST_RELIEF_EVERY;
      p.resource = clamp(p.resource - 1, 0, RESOURCE_MAX);
    }
  } else p.clock = Math.min(p.clock, REST_RELIEF_EVERY - 1);
  if (p.resource >= RESOURCE_MAX) out.compulsion = compulsionOf(char);
  return out;
}

export function compulsionOf(char: CharacterState) {
  const def = char.power?.classId ? CLASS_BY_ID[char.power.classId] : undefined;
  if (!def) return null;
  char.power!.resource = RESOURCE_AFTER_COMPULSION;
  return { name: def.compulsion.name, text: def.compulsion.text, effects: def.compulsion.effects };
}

// ---------- Ato II ----------
/** Liga `ato2` quando todos os vivos despertaram E escolheram classe. Devolve true se ligou agora. */
export function checkActTwo(world: WorldState, chars: CharacterState[], content: GameContent): boolean {
  if (world.flags.ato2) return false;
  const alive = chars.filter((c) => c.alive);
  if (!alive.length || !alive.every((c) => c.power?.classId)) return false;
  world.flags.ato2 = true;
  world.flags.ato2_minuto = world.minute;
  const meet = content.meetingLocation ? world.locations[content.meetingLocation] : undefined;
  if (meet) meet.discovered = true;
  return true;
}

export const ACT_TWO_LINE =
  "[long pause] Todos vocês sentem ao mesmo tempo: o vale mudou de dono. Sangue, lua, névoa e fé acordaram nele. [whispers] E, do acampamento abandonado, algo chama cada um pelo nome. É lá que vocês vão se reencontrar.";

// ---------- Visão para o cliente ----------
export function powerView(char: CharacterState, worldMinute: number) {
  const lineage = lineageOf(char);
  const p = char.power;
  const def = p?.classId ? CLASS_BY_ID[p.classId] : undefined;
  return {
    lineage,
    lineageLabel: LINEAGES[lineage].label,
    classId: def?.id ?? null,
    className: def?.name ?? null,
    epithets: def?.epithets ?? null,
    description: def?.description ?? null,
    resourceName: lineage === "human" ? null : RESOURCE_NAME[lineage],
    resource: p?.resource ?? 0,
    resourceMax: RESOURCE_MAX,
    passive: def?.passive ?? null,
    bane: def?.bane ?? null,
    compulsion: def ? { name: def.compulsion.name, description: def.compulsion.description } : null,
    powers: def?.powers.map((pw) => ({ id: pw.id, name: pw.name, description: pw.description, cost: pw.cost, minutes: pw.minutes, onlyNight: !!pw.onlyNight })) ?? [],
    buffs: (p?.buffs ?? []).filter((b) => b.until > worldMinute).map((b) => ({ attr: b.attr, bonus: b.bonus, minutesLeft: b.until - worldMinute })),
    wardMinutesLeft: Math.max(0, (p?.wardUntil ?? 0) - worldMinute),
  };
}
