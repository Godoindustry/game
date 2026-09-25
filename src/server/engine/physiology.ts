/**
 * Fisiologia simulada — MECÂNICA DE JOGO, não orientação médica real.
 *
 * O tempo passa em passos de até 10 minutos. Em cada passo:
 *  necessidades (fome, sede, energia, sono) → temperatura corporal → sangramento
 *  → infecção/doenças → dano/regeneração de saúde → dor/mobilidade → morte.
 */
import type { CharacterState, GameContent, WorldState, Wound } from "./types";
import { itemDef, encumbranceMultiplier } from "./inventory";
import { NIGHT_END, NIGHT_START } from "./constants";

export type Activity = "idle" | "light" | "walk" | "heavy" | "rest" | "sleep";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------- Relógio e ambiente ----------
export function minuteOfDay(content: GameContent, worldMinute: number): number {
  return (content.startMinuteOfDay + worldMinute) % 1440;
}

export function dayNumber(content: GameContent, worldMinute: number): number {
  return Math.floor((content.startMinuteOfDay + worldMinute) / 1440) + 1;
}

export function isNight(content: GameContent, worldMinute: number): boolean {
  const m = minuteOfDay(content, worldMinute);
  return m >= NIGHT_START || m < NIGHT_END;
}

export function clockLabel(content: GameContent, worldMinute: number): string {
  const m = minuteOfDay(content, worldMinute);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Temperatura do ar no vale: mínima ~5 °C às 3h, máxima ~17 °C às 15h. */
export function ambientTemp(content: GameContent, worldMinute: number): number {
  const hour = minuteOfDay(content, worldMinute) / 60;
  return 11 + 6 * Math.cos((2 * Math.PI * (hour - 15)) / 24);
}

export function fireActive(world: WorldState, locationId: string): boolean {
  return (world.locations[locationId]?.fireUntilMinute ?? 0) > world.minute;
}

export function isSheltered(world: WorldState, content: GameContent, locationId: string): boolean {
  const loc = content.locations[locationId];
  return Boolean(loc?.properties.indoor || loc?.properties.naturalShelter || world.locations[locationId]?.shelterBuilt);
}

export function locationTemp(world: WorldState, content: GameContent, locationId: string, worldMinute: number): number {
  const loc = content.locations[locationId];
  let t = ambientTemp(content, worldMinute) + (loc?.properties.tempModifier ?? 0);
  if (loc?.properties.indoor) t += 5;
  if (loc?.properties.naturalShelter) t += 3;
  if (world.locations[locationId]?.shelterBuilt) t += 4;
  if (fireActive(world, locationId)) t += 10;
  return t;
}

export function clothingInsulation(char: CharacterState, content: GameContent): number {
  let total = 0;
  for (const inv of char.inventory) {
    if (inv.container !== "equipped") continue;
    const c = itemDef(content, inv.itemId).clothing;
    if (!c || c.slot === "costas") continue;
    const wetPenalty = (char.status.wetness / 100) * (1 - c.waterResistance / 100) * 0.7;
    total += c.warmth * (1 - wetPenalty);
  }
  return total;
}

/** Impermeabilidade média das camadas externas (reduz quanto a chuva molha). */
export function clothingWaterResistance(char: CharacterState, content: GameContent): number {
  let best = 0;
  for (const inv of char.inventory) {
    if (inv.container !== "equipped") continue;
    const c = itemDef(content, inv.itemId).clothing;
    if (c && (c.slot === "torso_externo" || c.slot === "manta")) best = Math.max(best, c.waterResistance);
  }
  return best;
}

// ---------- Dor e mobilidade ----------
export function computePain(char: CharacterState, worldMinute: number): number {
  let pain = 0;
  for (const w of char.wounds) {
    if (w.healed) continue;
    const base = { corte: 6, laceracao: 12, contusao: 8, entorse: 14, fratura: 30, queimadura: 14 }[w.type] * w.severity;
    pain += w.bandaged || w.splinted ? base * 0.6 : base;
  }
  if (char.health.diseases.some((d) => d.key === "febre")) pain += 10;
  if (char.health.painkillerUntil > worldMinute) pain -= 30;
  return clamp(Math.round(pain), 0, 100);
}

export function computeMobility(char: CharacterState): number {
  let mob = 100;
  for (const w of char.wounds) {
    if (w.healed || !w.bodyPart.startsWith("perna")) continue;
    const p = { corte: 4, laceracao: 10, contusao: 8, entorse: 25, fratura: 60, queimadura: 8 }[w.type] * w.severity;
    mob -= w.splinted ? p * 0.55 : p;
  }
  return clamp(Math.round(mob), 10, 100);
}

// ---------- Ferimentos ----------
export function initialBleeding(type: Wound["type"], severity: 1 | 2 | 3): number {
  if (type === "laceracao") return [0, 1.5, 5, 14][severity];
  if (type === "corte") return [0, 0.6, 2, 6][severity];
  if (type === "fratura" && severity >= 2) return 1;
  return 0;
}

// ---------- Passagem do tempo ----------
export interface TimeReport {
  minutes: number;
  died: boolean;
  cause: string | null;
  notes: string[];
}

const RATES: Record<Activity, { energy: number; hunger: number; thirst: number; heat: number }> = {
  idle: { energy: -2, hunger: 3, thirst: 4, heat: 0 },
  light: { energy: -5, hunger: 4, thirst: 5, heat: 1 },
  walk: { energy: -10, hunger: 6, thirst: 8, heat: 3 },
  heavy: { energy: -15, hunger: 7, thirst: 9, heat: 4 },
  rest: { energy: 12, hunger: 3, thirst: 3.5, heat: 0 },
  sleep: { energy: 9, hunger: 2.5, thirst: 3, heat: -1 },
};

/**
 * Avança o relógio fisiológico de UM personagem por `minutes`, a partir de `startMinute`.
 * Não altera world.minute (quem controla o relógio da campanha é a rodada).
 */
export function passTime(
  char: CharacterState,
  world: WorldState,
  content: GameContent,
  startMinute: number,
  minutes: number,
  activity: Activity,
): TimeReport {
  const report: TimeReport = { minutes, died: false, cause: null, notes: [] };
  if (!char.alive || minutes <= 0) return report;

  const s = char.status;
  const h = char.health;
  const resist = 1.15 - char.attrs.resistencia * 0.04;
  const cond = { sedentario: 1.12, moderado: 1, atletico: 0.88 }[char.profile.conditioning];
  const load = encumbranceMultiplier(char, content);
  let elapsed = 0;
  const warned = new Set<string>();
  const note = (key: string, text: string) => {
    if (!warned.has(key)) {
      warned.add(key);
      report.notes.push(text);
    }
  };

  while (elapsed < minutes && char.alive) {
    const dt = Math.min(10, minutes - elapsed);
    const hr = dt / 60;
    const now = startMinute + elapsed;
    const r = RATES[activity];
    const gastro = h.diseases.some((d) => d.key === "gastroenterite" && d.until > now);

    // Necessidades
    s.hunger = clamp(s.hunger + r.hunger * hr * (s.bodyTemp < 36 ? 1.25 : 1), 0, 100);
    s.thirst = clamp(s.thirst + r.thirst * hr * (gastro ? 1.7 : 1) * (activity === "walk" ? load : 1), 0, 100);
    if (r.energy < 0) {
      const mult = resist * cond * (activity === "walk" || activity === "heavy" ? load : 1) * (s.fatigue >= 85 ? 1.3 : 1);
      s.energy = clamp(s.energy + r.energy * mult * hr - (gastro ? 2 * hr : 0), 0, 100);
    } else {
      const starving = s.hunger >= 80 || s.thirst >= 80 ? 0.5 : 1;
      s.energy = clamp(s.energy + r.energy * starving * hr, 0, 100);
    }
    if (activity === "sleep") {
      s.fatigue = clamp(s.fatigue - 14 * hr, 0, 100);
      s.awakeMinutes = 0;
    } else {
      s.fatigue = clamp(s.fatigue + (activity === "rest" ? 1.5 : 4.5) * hr, 0, 100);
      s.awakeMinutes += dt;
    }

    // Temperatura
    const env = locationTemp(world, content, s.locationId, now);
    const feels = env + clothingInsulation(char, content) * 3 + r.heat - (s.wetness / 100) * 4;
    if (feels >= 18) {
      s.bodyTemp = s.bodyTemp < 37 ? Math.min(37, s.bodyTemp + 0.6 * hr) : Math.max(37, s.bodyTemp - 0.5 * hr);
    } else {
      s.bodyTemp -= (18 - feels) * 0.07 * hr * (1.1 - char.attrs.resistencia * 0.03);
    }
    // Secagem
    const drying = fireActive(world, s.locationId) ? 40 : content.locations[s.locationId]?.properties.indoor ? 10 : 4;
    s.wetness = clamp(s.wetness - drying * hr, 0, 100);

    // Dano por causa (para registrar a causa da morte)
    const damage: Record<string, number> = {};
    const hit = (cause: string, v: number) => (damage[cause] = (damage[cause] ?? 0) + v);

    for (const w of char.wounds) {
      if (w.healed || w.bleedingRate <= 0) continue;
      hit("Hemorragia", w.bleedingRate * hr);
      if (!w.bandaged && w.severity <= 2) w.bleedingRate = Math.max(0, w.bleedingRate * (1 - 0.1 * hr));
      if (w.bleedingRate < 0.05) w.bleedingRate = 0;
    }
    if (s.thirst >= 100) hit("Desidratação", 5 * hr);
    else if (s.thirst >= 85) hit("Desidratação", 1 * hr);
    if (s.hunger >= 100) hit("Inanição", 1.5 * hr);
    if (s.energy <= 0) hit("Exaustão", 1 * hr);
    if (s.bodyTemp < 31) hit("Hipotermia", 20 * hr);
    else if (s.bodyTemp < 33) hit("Hipotermia", 6 * hr);
    else if (s.bodyTemp < 35) hit("Hipotermia", 2 * hr);

    // Infecção: feridas abertas sem antisséptico há mais de 4h
    const open = char.wounds.filter((w) => !w.healed && ["corte", "laceracao", "queimadura", "fratura"].includes(w.type));
    const dirty = open.filter((w) => !w.disinfected && now - w.createdAtMinute > 240);
    if (dirty.length) h.infection = clamp(h.infection + dirty.reduce((a, w) => a + w.severity * 1.2, 0) * hr, 0, 100);
    else h.infection = clamp(h.infection - 1.5 * hr, 0, 100);
    if (h.infection >= 60) {
      hit("Infecção", 1.5 * hr);
      if (!h.diseases.some((d) => d.key === "febre")) h.diseases.push({ key: "febre", startedAt: now, until: now + 1440 });
    }
    h.diseases = h.diseases.filter((d) => d.until > now && !(d.key === "febre" && h.infection < 40));

    const totalDamage = Object.values(damage).reduce((a, b) => a + b, 0);
    h.health -= totalDamage;

    // Regeneração
    const bleeding = char.wounds.some((w) => !w.healed && w.bleedingRate > 0);
    if (!bleeding && totalDamage === 0 && s.hunger < 70 && s.thirst < 70 && s.bodyTemp >= 36) {
      h.health += (activity === "sleep" ? 1.2 : activity === "rest" ? 0.8 : 0.3) * hr;
    }
    h.health = clamp(h.health, 0, 100);

    // Estresse
    const sheltered = isSheltered(world, content, s.locationId);
    if (fireActive(world, s.locationId)) s.stress -= 4 * hr;
    else if (isNight(content, now) && !sheltered) s.stress += 2 * hr;
    if (activity === "sleep") s.stress -= 3 * hr;
    s.stress = clamp(s.stress, 0, 100);

    // Cura de ferimentos tratados
    for (const w of char.wounds) {
      if (!w.healed && w.bandaged && w.disinfected && now - w.createdAtMinute > w.severity * 1440) w.healed = true;
    }

    s.pain = computePain(char, now);
    h.mobility = computeMobility(char);

    if (h.health <= 0) {
      const cause = Object.entries(damage).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Causas desconhecidas";
      kill(char, cause, now + dt);
      report.died = true;
      report.cause = cause;
    }

    if (s.thirst >= 85) note("sede", "Sua boca está seca e a cabeça lateja. A desidratação está afetando seu corpo.");
    if (s.bodyTemp < 35) note("frio", "Você treme sem conseguir parar. Seus dedos estão dormentes.");
    if (bleeding && char.wounds.some((w) => w.bleedingRate >= 3)) note("sangue", "O sangramento não para.");
    if (s.energy <= 5) note("energia", "Suas pernas mal respondem. Você precisa descansar.");
    if (h.infection >= 50) note("infeccao", "Um ferimento está quente, inchado e latejando.");

    elapsed += dt;
  }

  s.hunger = round1(s.hunger);
  s.thirst = round1(s.thirst);
  s.energy = round1(s.energy);
  s.fatigue = round1(s.fatigue);
  s.bodyTemp = Math.round(s.bodyTemp * 100) / 100;
  s.wetness = round1(s.wetness);
  s.stress = round1(s.stress);
  h.health = round1(h.health);
  h.infection = round1(h.infection);
  return report;
}

export function kill(char: CharacterState, cause: string, atMinute: number): void {
  char.alive = false;
  char.deathCause = cause;
  char.diedAtMinute = atMinute;
  char.health.health = 0;
}
