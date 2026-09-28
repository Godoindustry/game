/** Quatro atos, quatro mapas regionais e os locais que sustentam a campanha longa. */
import type {
  BossPresentationDef,
  CampaignActDef,
  CampaignRegionDef,
  ChoiceDef,
  ClueDef,
  EventDef,
  LinkDef,
  LocationDef,
} from "../engine/types";

const c = (eventId: string, id: string, choice: Omit<ChoiceDef, "id">): ChoiceDef => ({
  id: `${eventId}.${id}`,
  ...choice,
});

export const PHASE_LOCATIONS: LocationDef[] = [
  {
    id: "cemiterio", name: "Cemitério dos sem nome", x: 34, y: 67, terrain: "cemitério", hiddenInitially: true, dangerLevel: 2,
    description: "Cruzes sem placa afundam no barro. Uma capela baixa desaparece sob raízes e neblina.",
    properties: {
      naturalShelter: true,
      examineText: "As datas param em 1998. Uma lápide sem nome tem o número 740 riscado onde deveria existir uma oração.",
      examineClue: "lapide_740",
      loot: [{ itemId: "fosforos", qty: 1, base: 45, requiresExamined: true }],
    },
  },
  {
    id: "capela", name: "Capela afogada", x: 48, y: 75, terrain: "ruína", hiddenInitially: true, dangerLevel: 3,
    description: "Água negra cobre os bancos. Atrás do altar, uma escada desce para máquinas que não constam em mapa algum.",
    properties: {
      indoor: true, water: "lake",
      examineText: "Cabos de rádio atravessam a parede da capela e descem pela escada. Foram instalados muito depois do abandono.",
      examineClue: "cabos_capela",
      loot: [{ itemId: "corda", qty: 1, base: 50 }, { itemId: "atadura", qty: 1, base: 40 }],
    },
  },
  {
    id: "galeria", name: "Galeria das turbinas", x: 61, y: 66, terrain: "subsolo", hiddenInitially: true, dangerLevel: 4,
    description: "Um túnel hidrelétrico inundado vibra com um pulso que parece vir debaixo da água.",
    properties: {
      indoor: true, water: "stream", tempModifier: -4,
      examineText: "A turbina foi convertida num amplificador. O eixo aponta para o Poço Escuro, como uma agulha de bússola.",
      examineClue: "turbina_sinal",
      loot: [{ itemId: "lanterna", qty: 1, base: 45, state: { battery: 55 } }],
    },
  },
  {
    id: "observatorio", name: "Observatório 740", x: 92, y: 8, terrain: "observatório", hiddenInitially: true, dangerLevel: 5,
    description: "No cume, uma parabólica colossal gira contra o vento. Cada volta repete o seu nome na estática.",
    properties: {
      indoor: true, openSky: true, tempModifier: -5,
      examineText: "O transmissor pode abrir a frequência de emergência, mas três relés precisam ser alinhados na ordem 7-4-0.",
      examineClue: "relés_740",
    },
  },
];

export const PHASE_LINKS: LinkDef[] = [
  { from: "mata", to: "cemiterio", minutes: 25, hidden: true, risk: 1 },
  { from: "cemiterio", to: "capela", minutes: 20, hidden: true, risk: 1 },
  { from: "capela", to: "galeria", minutes: 30, hidden: true, risk: 2 },
  { from: "galeria", to: "lago", minutes: 25, hidden: false, risk: 2 },
  { from: "estacao", to: "observatorio", minutes: 35, hidden: true, risk: 2 },
  { from: "rochedo", to: "observatorio", minutes: 45, hidden: true, risk: 3 },
];

export const PHASE_EVENTS: EventDef[] = [
  {
    id: "fs_portao", title: "O caminho das cruzes", locationId: "mata", priority: 46, repeatable: false,
    trigger: { afterEvent: "vs_vozes", flagsNone: ["cemiterio_revelado"] },
    body: "[whispers] Entre duas figueiras, correntes enferrujadas balançam sem vento. Atrás delas, cruzes tortas seguem pela neblina até uma capela quase enterrada.",
    choices: [
      c("fs_portao", "abrir", {
        label: "Abrir passagem entre as correntes", durationMinutes: 15,
        outcome: { text: "O metal geme. O caminho dos mortos se abre.", effects: [{ op: "flag", key: "cemiterio_revelado" }, { op: "reveal", location: "cemiterio" }, { op: "revealLink", from: "mata", to: "cemiterio" }] },
      }),
      c("fs_portao", "marcar", {
        label: "Marcar o caminho e voltar depois", durationMinutes: 5, safe: true,
        outcome: { text: "Você amarra um pedaço de tecido na árvore. Quando olha de novo, ele já está molhado como se tivesse chovido por horas.", effects: [{ op: "flag", key: "cemiterio_revelado" }, { op: "reveal", location: "cemiterio" }, { op: "revealLink", from: "mata", to: "cemiterio" }, { op: "status", field: "stress", delta: 5 }] },
      }),
    ],
  },
  {
    id: "fs_cemiterio", title: "A porta sob as raízes", locationId: "cemiterio", priority: 48, repeatable: false,
    trigger: {},
    body: "A porta da capela está presa por raízes grossas como braços. Do outro lado, água pinga no ritmo de uma transmissão em código.",
    choices: [
      c("fs_cemiterio", "cortar", {
        label: "Cortar as raízes e entrar", durationMinutes: 20,
        outcome: {
          text: "Você abre espaço centímetro por centímetro.",
          check: { attr: "improviso", base: 50, itemBonus: { canivete: 15 } },
          success: { text: "A porta cede. O ar lá dentro tem cheiro de igreja inundada e fio queimado.", effects: [{ op: "flag", key: "capela_revelada" }, { op: "reveal", location: "capela" }, { op: "revealLink", from: "cemiterio", to: "capela" }] },
          failure: { text: "Uma raiz rompe de volta como um chicote, mas a passagem fica aberta.", effects: [{ op: "wound", part: "braco_dir", type: "corte", severity: 1 }, { op: "flag", key: "capela_revelada" }, { op: "reveal", location: "capela" }, { op: "revealLink", from: "cemiterio", to: "capela" }] },
        },
      }),
      c("fs_cemiterio", "rezar", {
        label: "Seguir a contagem sussurrada até outra entrada", durationMinutes: 25, safe: true,
        outcome: { text: "Sete passos, quatro cruzes, nenhuma oração. Uma abertura lateral leva à capela.", effects: [{ op: "flag", key: "capela_revelada" }, { op: "reveal", location: "capela" }, { op: "revealLink", from: "cemiterio", to: "capela" }, { op: "status", field: "stress", delta: 8 }] },
      }),
    ],
  },
  {
    id: "fs_capela", title: "A escada atrás do altar", locationId: "capela", priority: 49, repeatable: false,
    trigger: {},
    body: "[ominous] O altar está preso sobre trilhos. Atrás dele, uma escada industrial desce para água e ferrugem. Nas paredes, marcas de garras sobem — nenhuma desce.",
    choices: [
      c("fs_capela", "descer", {
        label: "Descer com a lanterna à frente", durationMinutes: 30,
        outcome: { text: "A escada termina num corredor de turbinas abandonadas.", effects: [{ op: "flag", key: "galeria_revelada" }, { op: "reveal", location: "galeria" }, { op: "revealLink", from: "capela", to: "galeria" }, { op: "clue", key: "cabos_capela" }] },
      }),
      c("fs_capela", "corda", {
        label: "Fixar uma corda para garantir a volta", durationMinutes: 20, safe: true, requirements: { hasItem: ["corda"] },
        outcome: { text: "A corda fica presa ao altar. Agora existe um caminho de volta — se alguma coisa não a cortar.", effects: [{ op: "flag", key: "galeria_revelada" }, { op: "reveal", location: "galeria" }, { op: "revealLink", from: "capela", to: "galeria" }, { op: "clue", key: "cabos_capela" }, { op: "status", field: "stress", delta: -5 }] },
      }),
      c("fs_capela", "voltar", { label: "Fechar o altar por enquanto", durationMinutes: 5, safe: true, outcome: { text: "O altar volta ao lugar. A vibração continua sob seus pés." } }),
    ],
  },
  {
    id: "fs_turbinas", title: "O coração sob o vale", locationId: "galeria", priority: 58, repeatable: false,
    trigger: {},
    body: "A turbina principal pulsa mesmo sem energia. Cabos sobem para a estação; outros desaparecem na água, na direção do Poço Escuro. [whispers] Algo respira do outro lado do concreto.",
    choices: [
      c("fs_turbinas", "mapear", {
        label: "Mapear os cabos e seguir o pulso", durationMinutes: 35,
        outcome: {
          text: "Você marca cada derivação na parede.",
          check: { attr: "conhecimento_tecnico", base: 50, experience: ["tecnologia", "mecanica"] },
          success: { text: "O sistema inteiro amplifica um sinal que nasce sob o poço. E uma criatura enorme dorme junto dele.", effects: [{ op: "flag", key: "mae_conhecida" }, { op: "clue", key: "turbina_sinal" }, { op: "revealLink", from: "galeria", to: "lago" }] },
          failure: { text: "A turbina acorda por um segundo. A onda de choque joga você dentro da água negra.", effects: [{ op: "flag", key: "mae_conhecida" }, { op: "wet", amount: 70 }, { op: "status", field: "stress", delta: 15 }, { op: "revealLink", from: "galeria", to: "lago" }] },
        },
      }),
      c("fs_turbinas", "recuar", {
        label: "Desligar tudo que puder e recuar", durationMinutes: 15, safe: true,
        outcome: { text: "Você arranca duas chaves. O pulso enfraquece, mas não para. Agora ele sabe que você está aqui.", effects: [{ op: "flag", key: "mae_conhecida" }, { op: "revealLink", from: "galeria", to: "lago" }, { op: "status", field: "stress", delta: 10 }] },
      }),
    ],
  },
  {
    id: "fs_observatorio", title: "A última subida", locationId: "estacao", priority: 67, repeatable: false,
    trigger: { flagsAny: ["iara_em_paz", "iara_furia"], flagsNone: ["observatorio_revelado"] },
    body: "[urgent] A parabólica no cume gira pela primeira vez em décadas. No mapa de Iara, uma estrada técnica sobe até ela. O rádio comum nunca atravessará a tempestade sem aquele transmissor.",
    choices: [
      c("fs_observatorio", "subir", {
        label: "Abrir a estrada técnica até o cume", durationMinutes: 20,
        outcome: { text: "Você força o cadeado e encontra a trilha de manutenção.", effects: [{ op: "flag", key: "observatorio_revelado" }, { op: "reveal", location: "observatorio" }, { op: "revealLink", from: "estacao", to: "observatorio" }, { op: "revealLink", from: "rochedo", to: "observatorio" }] },
      }),
      c("fs_observatorio", "preparar", {
        label: "Descansar e subir quando estiver pronto", durationMinutes: 15, safe: true,
        outcome: { text: "Você copia a rota no braço. O cume continuará chamando.", effects: [{ op: "flag", key: "observatorio_revelado" }, { op: "reveal", location: "observatorio" }, { op: "revealLink", from: "estacao", to: "observatorio" }, { op: "revealLink", from: "rochedo", to: "observatorio" }, { op: "status", field: "energy", delta: 5 }] },
      }),
    ],
  },
  {
    id: "fs_alinhar", title: "Sete, quatro, zero", locationId: "observatorio", priority: 72, repeatable: true,
    trigger: { flagsNone: ["sinal_final_alinhado"], cooldownMinutes: 30 },
    body: "[tense] Três relés gigantes tremem sob a tempestade. O primeiro pede sete voltas. O segundo, quatro. O último está travado no zero — e alguma coisa bate dentro da caixa metálica.",
    choices: [
      c("fs_alinhar", "reles", {
        label: "Alinhar os relés na sequência 7-4-0", durationMinutes: 35,
        outcome: {
          text: "Você prende o corpo ao painel e gira cada volante contra o vento.",
          check: { attr: "conhecimento_tecnico", base: 55, itemBonus: { canivete: 10 }, experience: ["tecnologia", "mecanica"] },
          success: { text: "[hopeful] A parabólica trava no rumo. Pela primeira vez, a estática se abre como uma porta. O rádio da estação agora pode alcançar o mundo.", effects: [{ op: "flag", key: "sinal_final_alinhado" }, { op: "clue", key: "relés_740" }, { op: "status", field: "stress", delta: -15 }] },
          failure: { text: "Um arco elétrico atravessa o painel. Dois relés ficam no lugar; o terceiro precisa ser tentado outra vez.", effects: [{ op: "wound", part: "braco_dir", type: "queimadura", severity: 1 }, { op: "status", field: "stress", delta: 8 }] },
        },
      }),
      c("fs_alinhar", "tempestade", {
        label: "Esperar a tempestade ceder", durationMinutes: 20, safe: true,
        outcome: { text: "Ela não cede. A cada trovão, a voz no metal conta mais perto do seu ouvido.", effects: [{ op: "status", field: "stress", delta: 5 }] },
      }),
    ],
  },
];

export const PHASE_CLUES: ClueDef[] = [
  { key: "lapide_740", title: "A lápide 740", text: "O número da transmissão foi gravado numa sepultura sem nome em 1998." },
  { key: "cabos_capela", title: "Cabos sob o altar", text: "A capela foi ligada à estação por uma instalação clandestina que desce ao subsolo." },
  { key: "turbina_sinal", title: "O coração do sinal", text: "A velha turbina amplifica algo que nasce sob o Poço Escuro e sobe até a antena." },
  { key: "relés_740", title: "Frequência alinhada", text: "Os relés do observatório abriram uma frequência capaz de atravessar a tempestade." },
];

export const VALE_ACTS: CampaignActDef[] = [
  {
    id: "queda", title: "A Queda", subtitle: "Ninguém procura um avião que não caiu por acidente.",
    briefing: "Saia dos destroços, estanque os ferimentos e recupere o que pode manter o grupo vivo.",
    targetRealMinutes: [0, 20], regionId: "impacto", artPosition: "0% 0%",
    milestones: [
      { id: "acordar", label: "Sobreviver ao impacto", condition: { eventsAny: ["vs_despertar"] } },
      { id: "bateria", label: "Abrir o compartimento de carga", condition: { flagsAll: ["bagageiro_aberto"] } },
      { id: "abrigo", label: "Encontrar um ponto seguro", condition: { visitedAny: ["abrigo", "mata"] } },
    ],
    completeWhen: { flagsAll: ["bagageiro_aberto"], visitedAny: ["abrigo", "mata"] },
  },
  {
    id: "caca", title: "O Vale Caça", subtitle: "A noite não esconde as criaturas. Ela pertence a elas.",
    briefing: "Abra os mapas esquecidos, encontre a origem das marcas e sobreviva ao primeiro predador do vale.",
    targetRealMinutes: [20, 55], regionId: "necropolis", artPosition: "100% 0%",
    milestones: [
      { id: "cemiterio", label: "Abrir o caminho das cruzes", condition: { visitedAny: ["cemiterio", "capela"] } },
      { id: "origem", label: "Descobrir uma origem sobrenatural", condition: { flagsAny: ["mae_conhecida", "rastro_ambar"] } },
      { id: "encontro", label: "Reunir o grupo transformado", condition: { flagsAll: ["encontro_feito"] } },
      { id: "predador", label: "Resolver o primeiro confronto", condition: { flagsAny: ["mae_caida", "pacto_sangue", "ambar_caido", "ambar_aliado", "ambar_alfa"] } },
    ],
    completeWhen: { flagsAll: ["encontro_feito"], flagsAny: ["mae_caida", "pacto_sangue", "ambar_caido", "ambar_aliado", "ambar_alfa"] },
  },
  {
    id: "rumo", title: "Rumo 074", subtitle: "Os monstros mais antigos ainda carregam espingardas.",
    briefing: "Chegue à estação, descubra quem controla a pista clandestina e corte a última saída de Tavares.",
    targetRealMinutes: [55, 90], regionId: "subsolo", artPosition: "0% 100%",
    milestones: [
      { id: "estacao", label: "Entrar na estação", condition: { flagsAll: ["estacao_aberta"] } },
      { id: "carga", label: "Provar a rota clandestina", condition: { cluesAny: ["carga_ravina", "donos_carga", "rumo_074"] } },
      { id: "tavares", label: "Resolver o confronto com Tavares", condition: { flagsAll: ["tavares_resolvido"] } },
    ],
    completeWhen: { flagsAll: ["tavares_resolvido"] },
  },
  {
    id: "voz", title: "23h40", subtitle: "Toda transmissão precisa de alguém disposto a escutar.",
    briefing: "Enfrente Iara, suba ao Observatório 740 e decida o que o mundo ouvirá quando a frequência abrir.",
    targetRealMinutes: [90, 130], regionId: "sinal", artPosition: "100% 100%",
    milestones: [
      { id: "iara", label: "Dar uma resposta a Iara", condition: { flagsAny: ["iara_em_paz", "iara_furia"] } },
      { id: "observatorio", label: "Alcançar o Observatório 740", condition: { visitedAny: ["observatorio"] } },
      { id: "alinhar", label: "Alinhar o transmissor final", condition: { flagsAll: ["sinal_final_alinhado"] } },
      { id: "desfecho", label: "Escolher o destino do vale", condition: { ending: true } },
    ],
    completeWhen: { ending: true },
  },
];

export const VALE_REGIONS: CampaignRegionDef[] = [
  { id: "impacto", title: "Mata do impacto", subtitle: "Destroços e primeiro abrigo", locationIds: ["destrocos", "mata", "abrigo"], artPosition: "0% 0%", unlockAct: 1 },
  { id: "necropolis", title: "Necrópole afogada", subtitle: "Cemitério, capela e poço", locationIds: ["cemiterio", "capela", "lago"], artPosition: "100% 0%", unlockAct: 2 },
  { id: "subsolo", title: "Galerias clandestinas", subtitle: "Turbinas, ponte e ravina", locationIds: ["galeria", "ponte", "penhasco"], artPosition: "0% 100%", unlockAct: 3 },
  { id: "sinal", title: "Crista do sinal", subtitle: "Trilha, estação e observatório", locationIds: ["trilha", "estacao", "rochedo", "observatorio"], artPosition: "100% 100%", unlockAct: 4 },
];

export const VALE_BOSSES: BossPresentationDef[] = [
  {
    id: "mae", title: "A Mãe das Asas", epithet: "A fome sob o Poço Escuro",
    eventIds: ["ch_ninho", "ch_mae", "ch_mae_furia", "ch_trono"], locationIds: ["galeria", "lago"], artPosition: "0% 50%",
    introducedWhen: { flagsAll: ["mae_conhecida"] },
    stages: [
      { label: "O chamado no sangue", condition: { flagsAll: ["mae_conhecida"] } },
      { label: "As asas estão feridas", condition: { flagsAll: ["mae_ferida"] } },
      { label: "O ninho silenciou", condition: { flagsAny: ["mae_caida", "pacto_sangue"] } },
    ],
    resolvedWhen: { flagsAny: ["mae_caida", "pacto_sangue"] },
  },
  {
    id: "ambar", title: "O Lobo de Âmbar", epithet: "O guardião da crista",
    eventIds: ["ch_carcaca", "ch_ambar", "ch_ambar_final", "ch_lua_cheia"], locationIds: ["mata", "trilha"], artPosition: "50% 50%",
    introducedWhen: { flagsAll: ["rastro_ambar"] },
    stages: [
      { label: "A fera conhece seu cheiro", condition: { flagsAll: ["rastro_ambar"] } },
      { label: "A última caçada", condition: { flagsAll: ["ambar_ferido"] } },
      { label: "A matilha escolheu", condition: { flagsAny: ["ambar_caido", "ambar_aliado", "ambar_alfa"] } },
    ],
    resolvedWhen: { flagsAny: ["ambar_caido", "ambar_aliado", "ambar_alfa"] },
  },
  {
    id: "tavares", title: "Tavares", epithet: "O homem que alimentou o vale",
    eventIds: ["ch_tavares"], locationIds: ["ponte", "penhasco"], artPosition: "50% 50%",
    introducedWhen: { cluesAny: ["donos_carga", "carga_ravina", "tavares_confessa"] },
    stages: [
      { label: "Os donos da carga chegaram", condition: { cluesAny: ["donos_carga", "carga_ravina"] } },
      { label: "A ponte está cercada", condition: { flagsAll: ["tavares_presente"] } },
      { label: "A estrada mudou de dono", condition: { flagsAll: ["tavares_resolvido"] } },
    ],
    resolvedWhen: { flagsAll: ["tavares_resolvido"] },
  },
  {
    id: "iara", title: "Iara, a Voz", epithet: "Vinte e oito anos transmitindo para ninguém",
    eventIds: ["ch_iara_sinal", "ch_iara", "ch_iara_furia", "fs_observatorio", "fs_alinhar"], locationIds: ["estacao", "observatorio"], artPosition: "100% 50%",
    introducedWhen: { flagsAll: ["iara_chamou"] },
    stages: [
      { label: "A voz chamou pelo seu nome", condition: { flagsAll: ["iara_chamou"] } },
      { label: "A morta espera sua resposta", condition: { eventsAny: ["ch_iara"] } },
      { label: "A frequência está aberta", condition: { flagsAll: ["sinal_final_alinhado"] } },
    ],
    resolvedWhen: { flagsAll: ["sinal_final_alinhado"] },
  },
];
