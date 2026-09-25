/** Catálogo de itens. Pesos e volumes aproximados de objetos reais. */
import type { ItemDef } from "../engine/types";

type Def = Omit<ItemDef, "stackable" | "maxStack" | "maxDurability" | "batteryCapacity" | "properties"> &
  Partial<Pick<ItemDef, "stackable" | "maxStack" | "maxDurability" | "batteryCapacity" | "properties">>;

const d = (x: Def): ItemDef => ({
  stackable: false,
  maxStack: 1,
  maxDurability: null,
  batteryCapacity: null,
  properties: {},
  ...x,
});

export const ITEMS: ItemDef[] = [
  // Água e comida
  d({ id: "garrafa_agua", name: "Garrafa d'água (500 ml)", description: "Garrafa plástica cheia. Se veio de rio ou lago, precisa ser tratada.", category: "agua", weightG: 530, volumeMl: 600, properties: { water: 35, emptiesTo: "garrafa_vazia" } }),
  d({ id: "garrafa_vazia", name: "Garrafa vazia", description: "Pode ser enchida em um córrego ou lago.", category: "agua", weightG: 30, volumeMl: 600, stackable: true, maxStack: 4, properties: { fillsTo: "garrafa_agua" } }),
  d({ id: "barra_cereal", name: "Barra de cereal", description: "Pouca coisa, mas é açúcar.", category: "comida", weightG: 25, volumeMl: 60, stackable: true, maxStack: 10, properties: { food: 7 } }),
  d({ id: "sardinha", name: "Lata de sardinha (abre-fácil)", description: "Proteína e sal. A tampa abre sem ferramenta.", category: "comida", weightG: 125, volumeMl: 150, stackable: true, maxStack: 6, properties: { food: 18 } }),
  d({ id: "biscoito", name: "Pacote de biscoito água e sal", description: "Seco, mas enche o estômago.", category: "comida", weightG: 200, volumeMl: 450, stackable: true, maxStack: 4, properties: { food: 22 } }),
  d({ id: "chocolate", name: "Barra de chocolate", description: "Meio derretida e depois endurecida de novo.", category: "comida", weightG: 90, volumeMl: 90, stackable: true, maxStack: 4, properties: { food: 12, stressRelief: 6 } }),

  // Ferramentas e fogo
  d({ id: "lanterna", name: "Lanterna de LED", description: "Facho forte. Consome bateria em uso noturno.", category: "luz", weightG: 160, volumeMl: 220, batteryCapacity: 100, properties: { light: true, drainPerHour: 9 } }),
  d({ id: "celular", name: "Celular (sem sinal)", description: "Sem sinal nenhum. A lanterna do aparelho ajuda — e drena a bateria rápido.", category: "luz", weightG: 190, volumeMl: 110, batteryCapacity: 100, properties: { light: true, drainPerHour: 22, readable: "Última notificação, 23:12: “Voo confirmado. Não fale com ninguém sobre a parada extra.” Remetente desconhecido." } }),
  d({ id: "isqueiro", name: "Isqueiro", description: "Funciona mesmo úmido, com paciência.", category: "ferramenta", weightG: 22, volumeMl: 20, maxDurability: 30, properties: { ignition: true } }),
  d({ id: "fosforos", name: "Caixa de fósforos", description: "Inúteis se molharem.", category: "ferramenta", weightG: 20, volumeMl: 40, defaultUses: 6, properties: { ignition: true, wetSensitive: true } }),
  d({ id: "canivete", name: "Canivete multiuso", description: "Lâmina, alicate pequeno e chave de fenda.", category: "ferramenta", weightG: 95, volumeMl: 60, maxDurability: 100, properties: { tool: true } }),
  d({ id: "corda", name: "Corda de náilon (15 m)", description: "Útil para abrigo, travessias e descidas.", category: "ferramenta", weightG: 950, volumeMl: 1800, properties: { rope: true } }),
  d({ id: "caneca", name: "Caneca de alumínio", description: "Vai ao fogo. Permite ferver água.", category: "ferramenta", weightG: 140, volumeMl: 400, properties: { pot: true } }),
  d({ id: "galhos_secos", name: "Feixe de galhos", description: "Volumoso e pesado. Úmido, quase não pega fogo.", category: "combustivel", weightG: 1800, volumeMl: 5000, stackable: true, maxStack: 3, properties: { fuel: true } }),

  // Médico
  d({ id: "atadura", name: "Rolo de atadura", description: "Estanca sangramentos e imobiliza.", category: "medico", weightG: 30, volumeMl: 90, stackable: true, maxStack: 6, properties: { bandage: true } }),
  d({ id: "antisseptico", name: "Frasco de antisséptico", description: "Limpa ferimentos e reduz o risco de infecção.", category: "medico", weightG: 110, volumeMl: 120, defaultUses: 4, properties: { antiseptic: true } }),
  d({ id: "analgesico", name: "Cartela de analgésico", description: "Reduz a dor por algumas horas.", category: "medico", weightG: 12, volumeMl: 15, defaultUses: 6, properties: { painkiller: true } }),
  d({ id: "pastilhas", name: "Pastilhas de purificação", description: "Tornam a água segura para beber.", category: "medico", weightG: 15, volumeMl: 20, defaultUses: 5, properties: { purifier: true } }),

  // Essenciais e documentos
  d({ id: "bateria_emergencia", name: "Bateria de emergência do avião", description: "Pesada. Com os fios certos, alimenta um rádio.", category: "essencial", weightG: 3200, volumeMl: 1800, maxDurability: 100, properties: { essential: true } }),
  d({ id: "sinalizador", name: "Sinalizador manual", description: "Fumaça vermelha visível a quilômetros. Um uso.", category: "essencial", weightG: 280, volumeMl: 350, stackable: true, maxStack: 3, properties: { signal: true, essential: true } }),
  d({ id: "mapa_topografico", name: "Mapa topográfico com alfinetes", description: "Alfinetes marcam a estação, a ravina e um rochedo a sudeste.", category: "documento", weightG: 60, volumeMl: 80, properties: { readable: "Três alfinetes. Um deles, no rochedo a sudeste, tem escrito à mão: “740 — caixa”." } }),
  d({ id: "caderno_piloto", name: "Caderno de voo", description: "Anotações do piloto.", category: "documento", weightG: 180, volumeMl: 250, properties: { readable: "Rota planejada riscada. Ao lado: “VS — pouso não registrado — R$ 40 mil na volta”. Na última página: “Se der errado, desligue o ELT.”" } }),
  d({ id: "diario_campo", name: "Diário de campo (1998)", description: "Letra pequena e cuidadosa. Hidróloga Iara Menezes.", category: "documento", weightG: 300, volumeMl: 400, properties: { readable: "“Dia 37. O sinal volta toda noite às 23h40. Sete, quatro, zero. Não são aleatórios. Deixei a caixa do rochedo trancada com eles.”" } }),

  // Roupas
  d({ id: "camiseta", name: "Camiseta", description: "Algodão fino.", category: "roupa", weightG: 150, volumeMl: 400, clothing: { slot: "torso_base", warmth: 0.4, waterResistance: 0, protection: 0 } }),
  d({ id: "moletom", name: "Moletom", description: "Esquenta bem enquanto estiver seco.", category: "roupa", weightG: 550, volumeMl: 2000, clothing: { slot: "torso_meio", warmth: 1.5, waterResistance: 5, protection: 1 } }),
  d({ id: "jaqueta", name: "Jaqueta impermeável", description: "Corta vento e chuva. Tem bolsos.", category: "roupa", weightG: 650, volumeMl: 2500, properties: { pocketsMl: 700 }, clothing: { slot: "torso_externo", warmth: 2, waterResistance: 80, protection: 2 } }),
  d({ id: "calca_jeans", name: "Calça jeans", description: "Resistente, mas pesada e fria quando molhada.", category: "roupa", weightG: 700, volumeMl: 1500, properties: { pocketsMl: 500 }, clothing: { slot: "pernas", warmth: 1, waterResistance: 10, protection: 2 } }),
  d({ id: "tenis", name: "Tênis", description: "Confortável na cidade. Escorrega na lama.", category: "roupa", weightG: 800, volumeMl: 3000, clothing: { slot: "pes", warmth: 0.5, waterResistance: 20, protection: 1 } }),
  d({ id: "manta_termica", name: "Manta térmica aluminizada", description: "Leve. Reflete o calor do corpo.", category: "roupa", weightG: 55, volumeMl: 90, clothing: { slot: "manta", warmth: 2.5, waterResistance: 90, protection: 0 } }),
  d({ id: "mochila_pequena", name: "Mochila de ataque (20 L)", description: "Leve, com bolsos laterais.", category: "mochila", weightG: 900, volumeMl: 3000, properties: { capacityMl: 16000, sideMl: 2000 }, clothing: { slot: "costas", warmth: 0, waterResistance: 0, protection: 0 } }),
  d({ id: "mochila_cargueira", name: "Mochila cargueira (55 L)", description: "Carrega muito mais — e pesa mais também.", category: "mochila", weightG: 2300, volumeMl: 6000, properties: { capacityMl: 48000, sideMl: 5000 }, clothing: { slot: "costas", warmth: 0, waterResistance: 0, protection: 0 } }),
];
