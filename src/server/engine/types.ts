/**
 * Tipos do motor de regras. O motor é puro: recebe estado + conteúdo + RNG,
 * devolve o novo estado e um relatório. Não conhece banco, HTTP nem IA.
 */

export const ATTRIBUTE_KEYS = [
  "forca",
  "resistencia",
  "agilidade",
  "percepcao",
  "inteligencia",
  "controle_emocional",
  "medicina",
  "orientacao",
  "comunicacao",
  "furtividade",
  "improviso",
  "conhecimento_tecnico",
] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type Attributes = Record<AttributeKey, number>;

export const EXPERIENCES = ["medicina", "orientacao", "mecanica", "tecnologia", "sobrevivencia"] as const;
export type Experience = (typeof EXPERIENCES)[number];

export const BODY_TYPES = ["magro", "medio", "robusto", "acima_do_peso"] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const CONDITIONINGS = ["sedentario", "moderado", "atletico"] as const;
export type Conditioning = (typeof CONDITIONINGS)[number];

export const CONTAINERS = ["equipped", "pockets", "backpack_main", "backpack_side", "hands"] as const;
export type Container = (typeof CONTAINERS)[number];

export const BODY_PARTS = ["cabeca", "torso", "braco_esq", "braco_dir", "perna_esq", "perna_dir"] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const WOUND_TYPES = ["corte", "laceracao", "contusao", "entorse", "fratura", "queimadura"] as const;
export type WoundType = (typeof WOUND_TYPES)[number];

export type ClothingSlot =
  | "cabeca"
  | "torso_base"
  | "torso_meio"
  | "torso_externo"
  | "pernas"
  | "pes"
  | "maos"
  | "manta"
  | "costas";

export type ItemCategory =
  | "comida"
  | "agua"
  | "ferramenta"
  | "medico"
  | "roupa"
  | "mochila"
  | "luz"
  | "combustivel"
  | "documento"
  | "essencial";

export interface ItemProps {
  food?: number; // reduz fome
  water?: number; // reduz sede
  stressRelief?: number;
  emptiesTo?: string; // item gerado após consumir (garrafa vazia)
  fillsTo?: string; // item gerado ao encher
  capacityMl?: number; // mochila: compartimento principal
  sideMl?: number; // mochila: bolsos laterais (acesso rápido)
  pocketsMl?: number; // roupa com bolsos
  light?: boolean;
  drainPerHour?: number; // % de bateria por hora de uso
  ignition?: boolean;
  wetSensitive?: boolean;
  fuel?: boolean;
  bandage?: boolean;
  antiseptic?: boolean;
  painkiller?: boolean;
  purifier?: boolean;
  pot?: boolean;
  rope?: boolean;
  tool?: boolean;
  signal?: boolean;
  essential?: boolean;
  readable?: string;
}

export interface ClothingDef {
  slot: ClothingSlot;
  warmth: number;
  waterResistance: number; // 0..100
  protection: number;
}

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  weightG: number;
  volumeMl: number;
  stackable: boolean;
  maxStack: number;
  maxDurability: number | null;
  batteryCapacity: number | null;
  defaultUses?: number | null;
  properties: ItemProps;
  clothing?: ClothingDef;
}

export interface InvItem {
  id: string;
  itemId: string;
  container: Container;
  quantity: number;
  durability: number | null;
  battery: number | null;
  usesLeft: number | null;
  wetness: number;
  contaminated: boolean;
}

export interface Wound {
  id: string;
  bodyPart: BodyPart;
  type: WoundType;
  severity: 1 | 2 | 3;
  bleedingRate: number; // pontos de saúde por hora
  bandaged: boolean;
  disinfected: boolean;
  splinted: boolean;
  createdAtMinute: number;
  healed: boolean;
}

export type DiseaseKey = "gastroenterite" | "febre" | "mordida";
export interface Disease {
  key: DiseaseKey;
  startedAt: number;
  until: number;
  /** Mordida: quantas vezes foi mordido (3 = transformado). */
  level?: number;
}

export interface CharacterStatus {
  locationId: string;
  hunger: number; // 0 = saciado, 100 = inanição
  thirst: number; // 0 = hidratado, 100 = desidratação severa
  energy: number; // 100 = descansado
  fatigue: number; // sono: 0 = alerta, 100 = exausto
  pain: number;
  stress: number;
  bodyTemp: number; // °C
  wetness: number; // 0..100
  awakeMinutes: number;
}

export interface HealthState {
  health: number;
  infection: number;
  mobility: number;
  diseases: Disease[];
  painkillerUntil: number;
}

export interface CharacterProfile {
  age: number;
  heightCm: number;
  weightKg: number;
  bodyType: BodyType;
  conditioning: Conditioning;
  profession: string;
  experiences: Experience[];
}

export interface CharacterState {
  id: string;
  userId: string;
  name: string;
  alive: boolean;
  deathCause: string | null;
  diedAtMinute: number | null;
  attrs: Attributes;
  profile: CharacterProfile;
  status: CharacterStatus;
  health: HealthState;
  wounds: Wound[];
  inventory: InvItem[];
}

// ---------- Mundo ----------
export interface LootEntry {
  itemId: string;
  qty: number;
  base: number; // chance base (percepção 3)
  requiresExamined?: boolean;
  state?: Partial<Pick<InvItem, "battery" | "durability" | "usesLeft" | "contaminated" | "wetness">>;
}

export interface LocationDef {
  id: string;
  name: string;
  description: string;
  x: number; // % da largura do mapa
  y: number; // % da altura do mapa
  terrain: string;
  hiddenInitially: boolean;
  dangerLevel: number;
  properties: {
    tempModifier?: number;
    indoor?: boolean;
    naturalShelter?: boolean;
    canBuildShelter?: boolean;
    woodSource?: boolean;
    water?: "stream" | "lake";
    openSky?: boolean;
    loot?: LootEntry[];
    examineText?: string;
    examineClue?: string;
    examineRevealsLinks?: [string, string][];
    npc?: string;
  };
}

export interface LinkDef {
  from: string;
  to: string;
  minutes: number;
  hidden: boolean;
  risk: number;
}

export interface CampaignLocationState {
  locationId: string;
  discovered: boolean;
  visited: boolean;
  examined: boolean;
  loot: number[]; // quantidade restante por entrada da tabela de loot
  shelterBuilt: boolean;
  fireUntilMinute: number;
}

export interface GroundItem {
  id: string;
  locationId: string;
  itemId: string;
  quantity: number;
  state: Partial<Pick<InvItem, "battery" | "durability" | "usesLeft" | "contaminated" | "wetness">>;
}

export type FlagValue = string | number | boolean;

export interface WorldState {
  campaignId: string;
  seed: string;
  minute: number; // minutos de jogo desde o início
  round: number;
  flags: Record<string, FlagValue>;
  clues: string[];
  locations: Record<string, CampaignLocationState>;
  revealedLinks: string[]; // "a|b" (ordenado)
  ground: GroundItem[];
  ending: { key: string; type: "victory" | "defeat" } | null;
  eventHistory: Record<string, number>; // eventId -> último minuto em que disparou
}

// ---------- Eventos ----------
export type StatusField = "hunger" | "thirst" | "energy" | "fatigue" | "stress" | "wetness" | "bodyTemp" | "pain";

export type Effect =
  | { op: "status"; field: StatusField; delta: number }
  | { op: "health"; delta: number }
  | { op: "infection"; delta: number }
  | { op: "wet"; amount: number } // molhar respeitando impermeabilidade das roupas
  | { op: "wound"; part: BodyPart; type: WoundType; severity: 1 | 2 | 3 }
  | { op: "addItem"; item: string; qty?: number; state?: GroundItem["state"] }
  | { op: "removeItem"; item: string; qty?: number }
  | { op: "consumeAny"; categories: ItemCategory[] }
  | { op: "itemDurability"; item: string; delta: number }
  | { op: "useCharge"; item: string }
  | { op: "flag"; key: string; value?: FlagValue }
  | { op: "flagAdd"; key: string; delta: number }
  | { op: "clue"; key: string }
  | { op: "reveal"; location: string }
  | { op: "revealLink"; from: string; to: string }
  | { op: "time"; minutes: number }
  | { op: "disease"; key: DiseaseKey; chanceAttr?: AttributeKey; base?: number }
  | { op: "bite" } // mordida de vampiro (acumula; na 3ª o personagem se transforma)
  | { op: "painkiller"; minutes: number }
  | { op: "fire"; minutes: number }
  | { op: "kill"; cause: string }
  | { op: "end"; ending: string };

export interface CheckDef {
  attr: AttributeKey;
  base: number;
  itemBonus?: Record<string, number>;
  experience?: Experience[];
}

export interface OutcomeBranch {
  text: string;
  effects?: Effect[];
}

export interface Outcome extends OutcomeBranch {
  check?: CheckDef;
  success?: OutcomeBranch;
  failure?: OutcomeBranch;
}

export interface ChoiceRequirements {
  hasItem?: string[];
  hasAnyItem?: string[];
  hasAnyCategory?: ItemCategory[];
  flagsAll?: string[];
  flagsNone?: string[];
  cluesAny?: string[];
  atShelter?: boolean;
}

export interface ChoiceDef {
  id: string;
  label: string;
  durationMinutes: number;
  requirements?: ChoiceRequirements;
  outcome: Outcome;
  safe?: boolean;
}

export interface EventTrigger {
  start?: boolean;
  anyLocation?: boolean;
  minMinute?: number;
  night?: boolean;
  day?: boolean;
  flagsAll?: string[];
  flagsNone?: string[];
  afterEvent?: string;
  hasItem?: string;
  chance?: number;
  statusGte?: Partial<Record<"thirst" | "hunger" | "infection" | "stress" | "fatigue", number>>;
  statusLte?: Partial<Record<"bodyTemp" | "energy" | "health", number>>;
  notSheltered?: boolean;
  openSky?: boolean;
  cooldownMinutes?: number;
}

export interface EventDef {
  id: string;
  title: string;
  body: string;
  locationId: string | null;
  trigger: EventTrigger;
  priority: number;
  repeatable: boolean;
  choices: ChoiceDef[];
}

export interface ClueDef {
  key: string;
  title: string;
  text: string;
}

export interface EndingDef {
  key: string;
  type: "victory" | "defeat";
  title: string;
  text: string;
}

export interface NpcDef {
  id: string;
  name: string;
  locationId: string;
  presentFlag: string;
  goneFlag: string;
  persona: string;
  intents: string[];
}

export interface NpcRule extends Outcome {
  requirements?: ChoiceRequirements;
  blockedText?: string;
}

/** Condição de etapa de objetivo: todos os campos presentes precisam valer (E). */
export interface ObjectiveCondition {
  hasAnyItem?: string[];
  hasAllItems?: string[];
  flagsAll?: string[];
  eventSeen?: string;
}

export interface ObjectiveStep {
  id: string;
  label: string;
  hint: string;
  locations?: string[]; // alvos por preferência; vale o primeiro já descoberto
  done?: ObjectiveCondition[]; // qualquer uma (OU); ausente = etapa final, concluída pelo evento
}

/** Rota de fuga: sequência de etapas até um final de vitória. Só orienta o HUD. */
export interface ObjectiveRoute {
  id: string;
  title: string;
  steps: ObjectiveStep[];
}

export interface StartItem {
  itemId: string;
  container: Container;
  qty?: number;
  state?: GroundItem["state"];
}

export interface GameContent {
  scenarioId: string;
  title: string;
  startLocation: string;
  startMinuteOfDay: number;
  items: Record<string, ItemDef>;
  locations: Record<string, LocationDef>;
  links: LinkDef[];
  events: EventDef[];
  clues: Record<string, ClueDef>;
  endings: Record<string, EndingDef>;
  npcs: Record<string, NpcDef>;
  npcRules: Record<string, Record<string, NpcRule>>;
  startingInventory: StartItem[];
  professionKits: Record<string, StartItem[]>;
  objectives?: ObjectiveRoute[];
}

// ---------- Ações ----------
export const ACTION_TYPES = [
  "examinar",
  "procurar",
  "mover",
  "descansar",
  "dormir",
  "comer",
  "beber",
  "coletar_agua",
  "purificar_agua",
  "ferver_agua",
  "tratar_ferimento",
  "tomar_analgesico",
  "montar_abrigo",
  "acender_fogueira",
  "coletar_lenha",
  "pegar_item",
  "largar_item",
  "mover_item",
  "equipar",
  "desequipar",
  "conversar",
  "escolha_evento",
  "esperar",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface ActionInput {
  type: ActionType;
  params: Record<string, unknown>;
}

export interface ActiveEvent {
  instanceId: string;
  eventId: string;
  participants: string[];
}

export interface ActionReport {
  characterId: string;
  actionType: ActionType;
  success: boolean | null;
  summary: string;
  lines: string[];
  effects: string[];
  minutes: number;
  tags: string[];
}
