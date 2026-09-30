/** Estado inicial do mundo/personagem e pontuação final. */
import type { Attributes, CharacterState, GameContent, WorldState } from "./types";
import type { CharacterSheet } from "./character";
import { addItem, newInvItem } from "./inventory";
import { neighbors } from "./actions";
import { revealLocation } from "./effects";

export function initWorld(content: GameContent, campaignId: string, seed: string): WorldState {
  const world: WorldState = {
    campaignId,
    seed,
    minute: 0,
    round: 1,
    flags: {},
    clues: [],
    locations: {},
    revealedLinks: [],
    ground: [],
    ending: null,
    eventHistory: {},
  };
  for (const loc of Object.values(content.locations)) {
    world.locations[loc.id] = {
      locationId: loc.id,
      discovered: false,
      visited: false,
      examined: false,
      loot: (loc.properties.loot ?? []).map((l) => l.qty),
      shelterBuilt: false,
      fireUntilMinute: 0,
    };
  }
  const start = world.locations[content.startLocation];
  start.discovered = true;
  start.visited = true;
  for (const n of neighbors(world, content, content.startLocation)) revealLocation(world, n.to);
  return world;
}

/** Consumíveis que o grupo divide: o estoque de cada local cresce com o número de jogadores. */
const PARTY_SCALED = new Set(["comida", "agua", "medico"]);
/** Fogo é sobrevivência: cada um precisa de como acender. */
const PARTY_SCALED_ITEMS = new Set(["fosforos"]);

/**
 * O saque de cada local foi pensado para 1 sobrevivente. Em grupo, comida, água e curativos
 * são multiplicados pelo número de jogadores (ferramentas e itens de história não).
 */
export function scaleLootForParty(world: WorldState, content: GameContent, players: number): void {
  if (players <= 1) return;
  for (const loc of Object.values(content.locations)) {
    const state = world.locations[loc.id];
    (loc.properties.loot ?? []).forEach((entry, idx) => {
      if (PARTY_SCALED.has(content.items[entry.itemId]?.category ?? "") || PARTY_SCALED_ITEMS.has(entry.itemId)) state.loot[idx] = entry.qty * players;
    });
  }
}

export function initCharacter(
  content: GameContent,
  genId: () => string,
  base: { id: string; userId: string },
  sheet: CharacterSheet,
  attrs: Attributes,
): CharacterState {
  const char: CharacterState = {
    id: base.id,
    userId: base.userId,
    name: sheet.name,
    alive: true,
    deathCause: null,
    diedAtMinute: null,
    attrs,
    profile: {
      sex: sheet.sex,
      age: sheet.age,
      heightCm: sheet.heightCm,
      weightKg: sheet.weightKg,
      bodyType: sheet.bodyType,
      conditioning: sheet.conditioning,
      profession: sheet.profession,
      experiences: sheet.experiences,
    },
    status: {
      locationId: content.startLocation,
      hunger: 25,
      thirst: 30,
      energy: 70,
      fatigue: 45,
      pain: 0,
      stress: 35,
      bodyTemp: 36.6,
      wetness: 10,
      awakeMinutes: 16 * 60,
    },
    health: { health: 92, infection: 0, mobility: 100, diseases: [], painkillerUntil: 0 },
    wounds: [],
    inventory: [],
  };
  // Primeiro o que é vestido (inclui a mochila, que cria os compartimentos).
  const kit = [...content.startingInventory, ...(content.professionKits[sheet.profession] ?? [])];
  for (const s of kit.filter((k) => k.container === "equipped")) {
    char.inventory.push(newInvItem(content, genId, s.itemId, "equipped", s.qty ?? 1, s.state));
  }
  for (const s of kit.filter((k) => k.container !== "equipped")) {
    addItem(char, content, genId, s.itemId, s.qty ?? 1, s.state ?? {}, s.container);
  }
  return char;
}

export function computeScore(char: CharacterState, world: WorldState): number {
  const survived = char.alive ? world.minute : (char.diedAtMinute ?? world.minute);
  let score = Math.floor(survived / 6) + world.clues.length * 40;
  if (char.alive) score += 150;
  if (world.ending?.type === "victory" && char.alive) score += 600;
  return score;
}
