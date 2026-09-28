/**
 * Ícones de perfil. Os 8 clássicos (emoji) continuam valendo para quem já os escolheu; as
 * criaturas vêm de UM sprite (public/avatars/criaturas.webp, grade 14 × 8 de 96 px) —
 * um download só, e cada ícone é uma posição dentro dele.
 */
export const CLASSIC_AVATARS = ["bussola", "radio", "lanterna", "mochila", "fogueira", "mapa", "corda", "cruz"] as const;

export const CLASSIC_ICON: Record<string, string> = {
  bussola: "🧭", radio: "📻", lanterna: "🔦", mochila: "🎒", fogueira: "🔥", mapa: "🗺️", corda: "🪢", cruz: "✚",
};

export const CLASSIC_NAME: Record<string, string> = {
  bussola: "Bússola", radio: "Rádio", lanterna: "Lanterna", mochila: "Mochila", fogueira: "Fogueira", mapa: "Mapa", corda: "Corda", cruz: "Cruz",
};

export const SPRITE = { url: "/avatars/criaturas.webp", cols: 14, rows: 8, size: 96 } as const;

/** Na ordem do sprite (linha a linha). */
const CREATURE_NAMES = [
  "Olho Tirano", "Dragão Vermelho", "Rei Lich", "Goblin", "Orc", "Orc Guerreiro", "Dragão Azul",
  "Devorador de Mentes", "Troll", "Leão", "Cubo Gelatinoso", "Gosma", "Corujurso", "Centopeia",
  "Rastejante", "Gárgula", "Gárgula de Pedra", "Gárgula Sombria", "Mímico", "Minotauro", "Mímico Faminto",
  "Dragão Dourado", "Serpe", "Dragão Rubro", "Dragão Prateado", "Horror Tentacular", "Diabrete Chifrudo", "Diabo Vermelho",
  "Orc Selvagem", "Ogro", "Ettin", "Esqueleto", "Zumbi", "Carniçal", "Espectro",
  "Gnoll", "Hidra", "Grifo", "Tubarão da Terra", "Pantera Deslocadora", "Pantera Sombria", "Salamandra",
  "Harpia", "Dracolino", "Boca Devoradora", "Homem-Lagarto", "Lagarto Verde", "Medusa", "Aberração",
  "Tentáculos", "Encapuzado", "Vampiro", "Banshee", "Fantasma", "Assombração", "Serpente Marinha",
  "Homem-Peixe", "Demônio Vermelho", "Súcubo", "Diaba Púrpura", "Tiefling", "Demônio Púrpura", "Diabo Rubro",
  "Goblin Chifrudo", "Diabrete Púrpura", "Feiticeiro Sombrio", "Diabo Azul", "Diabrete Violeta", "Hobgoblin Pálido", "Diabo Púrpura",
  "Demônio Cornudo", "Demônio Rubro", "Diabo de Gelo", "Diabo Ósseo", "Chifrudo Ancestral", "Cavaleiro Sombrio", "Golem de Pedra",
  "Golem de Ferro", "Golem de Carne", "Golem de Barro", "Elemental do Ar", "Elemental da Terra", "Elemental do Fogo", "Elemental da Água",
  "Naga", "Louva-Deus", "Louva-Deus Verde", "Aranha Gigante", "Dríade", "Aranha de Fase", "Gigante da Colina",
  "Sábio Ancião", "Gigante do Gelo", "Gigante do Fogo", "Gigante da Pedra", "Gigante Glacial", "Gigante da Tempestade", "Gigante das Nuvens",
  "Bárbaro", "Ogro Ancião", "Orc Ancião", "Sapo Verde", "Sapo Azul", "Sapo Vermelho", "Monstro Marinho",
  "Serpente", "Víbora", "Morcego Tentacular", "Sombra Viva", "Hobgoblin", "Lobisomem", "Olho Flutuante",
] as const;

export interface CreatureAvatar {
  id: string;
  name: string;
  /** Posição no sprite (0-based, linha a linha). */
  index: number;
}

export const CREATURE_AVATARS: CreatureAvatar[] = CREATURE_NAMES.map((name, index) => ({
  id: `criatura-${String(index + 1).padStart(3, "0")}`,
  name,
  index,
}));

const CREATURE_BY_ID = new Map(CREATURE_AVATARS.map((a) => [a.id, a]));

export const AVATAR_IDS = [...CLASSIC_AVATARS, ...CREATURE_AVATARS.map((a) => a.id)] as [string, ...string[]];

export function creatureAvatar(id: string): CreatureAvatar | undefined {
  return CREATURE_BY_ID.get(id);
}

export function avatarName(id: string): string {
  return creatureAvatar(id)?.name ?? CLASSIC_NAME[id] ?? id;
}
