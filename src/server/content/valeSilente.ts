/**
 * Campanha inicial: "Vale Silente".
 *
 * Premissa: um bimotor de táxi aéreo cai à noite num vale de mata fechada.
 * O cinto do piloto foi cortado e a cabine está vazia. No rádio, uma voz feminina
 * repete números. A explicação é realista (desvio de rota pago, carga ilegal,
 * uma estação hidrológica abandonada desde 1998), mas nem tudo se explica.
 *
 * Coordenadas x/y em % do arquivo public/assets/mapa-vale-silente.png.
 */
import type { ChoiceDef, EventDef, GameContent, LinkDef, LocationDef } from "../engine/types";
import { ITEMS } from "./items";

const LOCATIONS: LocationDef[] = [
  {
    id: "destrocos", name: "Destroços do bimotor", x: 13.5, y: 23, terrain: "destroços", hiddenInitially: false, dangerLevel: 1,
    description: "A fuselagem partida entre árvores quebradas. Cheiro de combustível e metal quente.",
    properties: {
      tempModifier: 2, woodSource: true,
      examineText: "Marcas de derrapagem no barro indicam que o avião tentou pousar — não caiu de bico. A porta do piloto foi aberta por dentro.",
      examineClue: "pouso_tentado",
      loot: [
        { itemId: "garrafa_agua", qty: 1, base: 65 },
        { itemId: "biscoito", qty: 1, base: 55 },
        { itemId: "manta_termica", qty: 1, base: 50, requiresExamined: true },
        { itemId: "canivete", qty: 1, base: 45, requiresExamined: true },
      ],
    },
  },
  {
    id: "mata", name: "Mata do Vale", x: 21, y: 52, terrain: "mata", hiddenInitially: false, dangerLevel: 1,
    description: "Árvores altas, cipós e um silêncio que não parece natural. Entre as rochas, o vento some.",
    properties: {
      tempModifier: 1, woodSource: true, canBuildShelter: true,
      examineText: "Há galhos quebrados na altura do peito, numa linha reta — alguém abriu caminho por aqui há pouco tempo.",
      loot: [{ itemId: "garrafa_vazia", qty: 1, base: 45 }],
    },
  },
  {
    id: "abrigo", name: "Acampamento abandonado", x: 39, y: 41, terrain: "acampamento", hiddenInitially: false, dangerLevel: 0,
    description: "Uma lona esticada sobre estacas, caixas de madeira e uma fogueira antiga.",
    properties: {
      naturalShelter: true, woodSource: true,
      examineText: "Sob uma das caixas, um saco plástico bem dobrado, guardado com cuidado de quem pretendia voltar.",
      loot: [
        { itemId: "caneca", qty: 1, base: 60 },
        { itemId: "corda", qty: 1, base: 55 },
        { itemId: "pastilhas", qty: 1, base: 55, requiresExamined: true },
      ],
    },
  },
  {
    id: "trilha", name: "Trilha da crista", x: 40, y: 15, terrain: "trilha", hiddenInitially: false, dangerLevel: 1,
    description: "Uma trilha estreita subindo pela crista norte, com marcas de tinta laranja nos troncos.",
    properties: {
      tempModifier: -1, woodSource: true, canBuildShelter: true,
      examineText: "As marcas de tinta laranja são recentes. Seguem para leste, em direção à antena.",
      examineRevealsLinks: [["trilha", "estacao"]],
      loot: [
        { itemId: "chocolate", qty: 1, base: 40 },
        { itemId: "analgesico", qty: 1, base: 45, requiresExamined: true },
      ],
    },
  },
  {
    id: "ponte", name: "Ponte do córrego", x: 56, y: 39, terrain: "córrego", hiddenInitially: false, dangerLevel: 1,
    description: "Uma ponte de tábuas sobre o córrego. Rio acima, a cachoeira ruge no escuro.",
    properties: { tempModifier: -2, water: "stream" },
  },
  {
    id: "lago", name: "Poço escuro", x: 21, y: 77, terrain: "lago", hiddenInitially: false, dangerLevel: 1,
    description: "Um poço largo de água parada, cercado de pedras lisas. A superfície reflete a lua como um olho.",
    properties: {
      tempModifier: -2, water: "lake",
      examineText: "Na margem, uma pequena ponte de madeira atravessa o córrego para sudeste. Parece firme.",
      examineRevealsLinks: [["lago", "rochedo"]],
      loot: [{ itemId: "isqueiro", qty: 1, base: 40, requiresExamined: true }],
    },
  },
  {
    id: "estacao", name: "Estação de rádio", x: 81, y: 16, terrain: "estação", hiddenInitially: false, dangerLevel: 1,
    description: "Uma antena treliçada, uma parábola torta e uma casa de alvenaria cercada por alambrado.",
    properties: {
      indoor: true,
      loot: [
        { itemId: "mochila_cargueira", qty: 1, base: 60 },
        { itemId: "atadura", qty: 2, base: 60 },
        { itemId: "antisseptico", qty: 1, base: 55 },
        { itemId: "biscoito", qty: 1, base: 50 },
      ],
    },
  },
  {
    id: "penhasco", name: "Mirante do penhasco", x: 82, y: 38, terrain: "penhasco", hiddenInitially: false, dangerLevel: 3,
    description: "Um guarda-corpo de madeira podre à beira de um paredão. Lá embaixo, a névoa cobre a ravina.",
    properties: { tempModifier: -3, openSky: true },
  },
  {
    id: "rochedo", name: "Rochedo do marco", x: 70, y: 74, terrain: "rochedo", hiddenInitially: true, dangerLevel: 1,
    description: "Um topo de rocha nua acima das copas, com um marco geodésico. Céu aberto em todas as direções.",
    properties: { tempModifier: -2, openSky: true },
  },
];

const LINKS: LinkDef[] = [
  { from: "destrocos", to: "abrigo", minutes: 25, hidden: false, risk: 0 },
  { from: "destrocos", to: "mata", minutes: 20, hidden: false, risk: 0 },
  { from: "mata", to: "abrigo", minutes: 20, hidden: false, risk: 0 },
  { from: "mata", to: "lago", minutes: 25, hidden: false, risk: 1 },
  { from: "abrigo", to: "trilha", minutes: 35, hidden: false, risk: 1 },
  { from: "abrigo", to: "ponte", minutes: 20, hidden: false, risk: 0 },
  { from: "ponte", to: "estacao", minutes: 45, hidden: false, risk: 1 },
  { from: "ponte", to: "penhasco", minutes: 40, hidden: false, risk: 1 },
  { from: "estacao", to: "penhasco", minutes: 30, hidden: false, risk: 1 },
  { from: "trilha", to: "estacao", minutes: 50, hidden: true, risk: 1 },
  { from: "lago", to: "rochedo", minutes: 45, hidden: true, risk: 1 },
  { from: "penhasco", to: "rochedo", minutes: 55, hidden: true, risk: 2 },
];

const c = (eventId: string, id: string, x: Omit<ChoiceDef, "id">): ChoiceDef => ({ id: `${eventId}.${id}`, ...x });

const EVENTS: EventDef[] = [
  {
    id: "vs_despertar", title: "Silêncio depois do impacto", locationId: "destrocos", priority: 100, repeatable: false,
    trigger: { start: true },
    body:
      "O zumbido nos ouvidos é a primeira coisa que volta. Depois, o cheiro de combustível. Você está preso ao assento de um bimotor tombado entre as árvores. A cabine está aberta e vazia. O cinto do piloto não se rompeu: foi cortado. No painel, entre chiados, uma voz de mulher repete números, devagar: “sete… quatro… zero…”",
    choices: [
      c("vs_despertar", "examinar", {
        label: "Soltar o cinto com calma e examinar a cabine", durationMinutes: 10,
        outcome: {
          text: "Você solta o cinto e tateia o chão da cabine.",
          check: { attr: "percepcao", base: 55 },
          success: { text: "Uma lanterna rolou para baixo do banco. E no painel, o transmissor de emergência (ELT) está na posição OFF. Não quebrou — alguém desligou.", effects: [{ op: "addItem", item: "lanterna" }, { op: "clue", key: "elt_desligado" }] },
          failure: { text: "Você acha uma lanterna rolando sob o banco, mas ao se soltar abre o antebraço numa borda de metal.", effects: [{ op: "addItem", item: "lanterna" }, { op: "wound", part: "braco_esq", type: "laceracao", severity: 1 }] },
        },
      }),
      c("vs_despertar", "sair", {
        label: "Sair imediatamente — o cheiro de combustível é forte", durationMinutes: 3,
        outcome: {
          text: "Você se joga contra a janela lateral quebrada.",
          check: { attr: "agilidade", base: 60 },
          success: { text: "Você cai na lama do lado de fora. Está vivo. O avião não pega fogo.", effects: [{ op: "status", field: "stress", delta: -5 }] },
          failure: { text: "Um pedaço de fuselagem rasga sua perna ao passar pela janela.", effects: [{ op: "wound", part: "perna_dir", type: "laceracao", severity: 2 }] },
        },
      }),
      c("vs_despertar", "gritar", {
        label: "Gritar pelo piloto", durationMinutes: 3, safe: true,
        outcome: {
          text: "Sua voz some entre as árvores. Por alguns segundos, a mata inteira se cala — insetos, sapos, tudo. Depois, bem longe, alguém grita de volta. Não dá para saber se é resposta ou eco.",
          effects: [{ op: "status", field: "stress", delta: 15 }, { op: "flag", key: "ouviu_resposta" }, { op: "clue", key: "voz_na_mata" }],
        },
      }),
    ],
  },
  {
    id: "vs_bagageiro", title: "O compartimento de carga", locationId: "destrocos", priority: 50, repeatable: true,
    trigger: { afterEvent: "vs_despertar", flagsNone: ["bagageiro_aberto"], cooldownMinutes: 90 },
    body: "A porta do bagageiro está amassada e emperrada. Pela fresta dá para ver uma mala, uma jaqueta e uma caixa com o símbolo de bateria: a fonte de emergência do avião.",
    choices: [
      c("vs_bagageiro", "forcar", {
        label: "Forçar a porta com as mãos", durationMinutes: 10,
        outcome: {
          text: "Você apoia o pé na fuselagem e puxa.",
          check: { attr: "forca", base: 45 },
          success: { text: "O metal cede com um estalo. Você puxa a bateria (pesada!), uma jaqueta impermeável e um kit de primeiros socorros.", effects: [{ op: "flag", key: "bagageiro_aberto" }, { op: "addItem", item: "bateria_emergencia" }, { op: "addItem", item: "jaqueta" }, { op: "addItem", item: "atadura" }, { op: "addItem", item: "antisseptico" }] },
          failure: { text: "A porta não se move. Seu ombro estala de um jeito ruim.", effects: [{ op: "wound", part: "braco_dir", type: "entorse", severity: 1 }] },
        },
      }),
      c("vs_bagageiro", "alavanca", {
        label: "Usar um pedaço de metal como alavanca", durationMinutes: 15,
        outcome: {
          text: "Você encaixa uma haste de alumínio da asa na fresta.",
          check: { attr: "improviso", base: 50, itemBonus: { canivete: 15 } },
          success: { text: "Com paciência, a trava cede. Bateria, jaqueta e um kit de primeiros socorros.", effects: [{ op: "flag", key: "bagageiro_aberto" }, { op: "addItem", item: "bateria_emergencia" }, { op: "addItem", item: "jaqueta" }, { op: "addItem", item: "atadura" }, { op: "addItem", item: "antisseptico" }] },
          failure: { text: "A haste entorta. Você perde tempo e fôlego.", effects: [{ op: "status", field: "energy", delta: -8 }] },
        },
      }),
      c("vs_bagageiro", "depois", { label: "Deixar para depois", durationMinutes: 1, safe: true, outcome: { text: "Você se afasta do bagageiro. Ele não vai a lugar nenhum." } }),
    ],
  },
  {
    id: "vs_vozes", title: "Alguém chama seu nome", locationId: "mata", priority: 40, repeatable: false,
    trigger: { night: true },
    body: "Entre os troncos, uma voz chama o seu nome. O nome completo, pronunciado devagar, como quem lê de um documento.",
    choices: [
      c("vs_vozes", "seguir", {
        label: "Seguir a voz", durationMinutes: 30,
        outcome: {
          text: "Você segue o som, desviando de raízes.",
          check: { attr: "controle_emocional", base: 45 },
          success: { text: "A voz para. Numa árvore marcada com tinta laranja, pendurada num galho: a jaqueta de um uniforme de piloto. No bolso, um caderno de voo.", effects: [{ op: "addItem", item: "caderno_piloto" }, { op: "clue", key: "caderno_piloto" }] },
          failure: { text: "A voz parece mudar de lugar. Quando você enfim para, não reconhece mais nada. Leva quase uma hora para achar o caminho de volta — e você cai duas vezes.", effects: [{ op: "time", minutes: 45 }, { op: "status", field: "stress", delta: 20 }, { op: "wound", part: "perna_esq", type: "contusao", severity: 1 }] },
        },
      }),
      c("vs_vozes", "ignorar", { label: "Ignorar e seguir em frente", durationMinutes: 2, safe: true, outcome: { text: "Você não para. A voz não insiste. Isso é pior.", effects: [{ op: "status", field: "stress", delta: 10 }] } }),
      c("vs_vozes", "observar", {
        label: "Apagar a luz e observar em silêncio", durationMinutes: 15,
        outcome: {
          text: "Você se agacha atrás de uma raiz e prende a respiração.",
          check: { attr: "furtividade", base: 50 },
          success: { text: "Um facho de lanterna se move entre as árvores, subindo pela crista norte. Quem quer que seja, não está perdido: anda como quem conhece o caminho até a antena.", effects: [{ op: "clue", key: "luz_na_crista" }, { op: "revealLink", from: "trilha", to: "estacao" }] },
          failure: { text: "Você não vê nada. Mas escuta passos se afastando, sem pressa.", effects: [{ op: "status", field: "stress", delta: 10 }] },
        },
      }),
    ],
  },
  {
    id: "vs_acampamento", title: "O acampamento abandonado", locationId: "abrigo", priority: 40, repeatable: false,
    trigger: {},
    body: "Sob a lona, caixas de madeira e uma fogueira fria. Na estaca principal, marcas de contagem: trinta e sete riscos, agrupados de cinco em cinco. Abaixo, gravado a canivete: IARA.",
    choices: [
      c("vs_acampamento", "caixas", {
        label: "Revistar as caixas", durationMinutes: 10,
        outcome: {
          text: "Você abre as caixas uma a uma.",
          check: { attr: "percepcao", base: 60 },
          success: { text: "Uma lata de sardinha e, no fundo falso de uma caixa, fósforos embrulhados em plástico — secos.", effects: [{ op: "addItem", item: "sardinha" }, { op: "addItem", item: "fosforos" }] },
          failure: { text: "Só uma lata de sardinha. O resto é pano podre.", effects: [{ op: "addItem", item: "sardinha" }] },
        },
      }),
      c("vs_acampamento", "descansar", { label: "Descansar sob a lona", durationMinutes: 30, safe: true, outcome: { text: "Pela primeira vez desde a queda, o vento não chega até você.", effects: [{ op: "status", field: "energy", delta: 8 }, { op: "status", field: "stress", delta: -10 }] } }),
      c("vs_acampamento", "marcas", { label: "Examinar as marcas na estaca", durationMinutes: 5, outcome: { text: "Os últimos riscos são tortos, como se feitos no escuro. A madeira ao redor do nome foi alisada por mãos — alguém tocou ali muitas vezes.", effects: [{ op: "clue", key: "marcas_iara" }, { op: "status", field: "stress", delta: 5 }] } }),
    ],
  },
  {
    id: "vs_chuva", title: "Chuva fria", locationId: null, priority: 30, repeatable: false,
    trigger: { night: true, minMinute: 120, notSheltered: true },
    body: "O vento muda e a chuva chega de uma vez, fria, atravessando as copas. Em minutos, tudo pinga.",
    choices: [
      c("vs_chuva", "abrigar", {
        label: "Procurar abrigo sob pedras e raízes", durationMinutes: 20,
        outcome: {
          text: "Você procura um ponto seco no escuro.",
          check: { attr: "orientacao", base: 50 },
          success: { text: "Uma laje de pedra inclinada segura o pior da chuva.", effects: [{ op: "flag", key: "chovendo" }, { op: "wet", amount: 20 }] },
          failure: { text: "Nada serve. Você fica encharcado procurando.", effects: [{ op: "flag", key: "chovendo" }, { op: "wet", amount: 55 }, { op: "status", field: "stress", delta: 5 }] },
        },
      }),
      c("vs_chuva", "seguir", { label: "Cobrir-se como der e aguentar", durationMinutes: 2, safe: true, outcome: { text: "Você encolhe os ombros e espera. A água escorre pelas costas.", effects: [{ op: "flag", key: "chovendo" }, { op: "wet", amount: 50 }] } }),
    ],
  },
  {
    id: "vs_ponte", title: "Peixes mortos", locationId: "ponte", priority: 40, repeatable: false,
    trigger: {},
    body: "Na margem, sob a ponte, peixes mortos boiam de barriga para cima, presos entre as pedras. A água corre limpa e gelada — aparentemente.",
    choices: [
      c("vs_ponte", "examinar", {
        label: "Examinar os peixes e a água", durationMinutes: 10,
        outcome: {
          text: "Você se agacha na margem.",
          check: { attr: "inteligencia", base: 50 },
          success: { text: "Há um brilho oleoso nas pedras e cheiro de diesel. Vem de cima, da direção da antena: algum tanque velho vazando. Essa água precisa ser tratada.", effects: [{ op: "clue", key: "agua_contaminada" }] },
          failure: { text: "Talvez seja só o frio. Ou não.", effects: [] },
        },
      }),
      c("vs_ponte", "beber", {
        label: "Beber direto do córrego", durationMinutes: 5,
        outcome: { text: "A água gelada dói nos dentes. Você bebe muito.", effects: [{ op: "status", field: "thirst", delta: -40 }, { op: "disease", key: "gastroenterite", chanceAttr: "resistencia", base: 35 }] },
      }),
      c("vs_ponte", "seguir", { label: "Seguir em frente", durationMinutes: 1, safe: true, outcome: { text: "Você atravessa a ponte sem olhar para baixo." } }),
    ],
  },
  {
    id: "vs_estacao_portao", title: "A estação de rádio", locationId: "estacao", priority: 45, repeatable: true,
    trigger: { flagsNone: ["estacao_aberta"], cooldownMinutes: 45 },
    body: "Pela janela da casa, luz amarela: um lampião a querosene — aceso. O portão está preso por corrente e cadeado novo.",
    choices: [
      c("vs_estacao_portao", "pular", {
        label: "Pular a cerca", durationMinutes: 10,
        outcome: {
          text: "Você escala o alambrado.",
          check: { attr: "agilidade", base: 55 },
          success: { text: "Você cai do outro lado sem barulho.", effects: [{ op: "flag", key: "estacao_aberta" }] },
          failure: { text: "O arame no topo rasga seu braço. Você desce de volta, sangrando.", effects: [{ op: "wound", part: "braco_dir", type: "laceracao", severity: 2 }] },
        },
      }),
      c("vs_estacao_portao", "rodear", {
        label: "Procurar outra entrada", durationMinutes: 15,
        outcome: {
          text: "Você contorna a cerca devagar.",
          check: { attr: "percepcao", base: 50 },
          success: { text: "Nos fundos, a tela foi cortada e remendada com arame — alguém entra e sai por ali.", effects: [{ op: "flag", key: "estacao_aberta" }, { op: "clue", key: "cerca_cortada" }] },
          failure: { text: "Você dá a volta completa e não encontra nada.", effects: [] },
        },
      }),
      c("vs_estacao_portao", "chamar", { label: "Chamar por alguém", durationMinutes: 3, safe: true, outcome: { text: "A luz do lampião se apaga na mesma hora.", effects: [{ op: "status", field: "stress", delta: 15 }, { op: "flag", key: "piloto_alerta" }] } }),
    ],
  },
  {
    id: "vs_estacao_interior", title: "Dentro da estação", locationId: "estacao", priority: 44, repeatable: false,
    trigger: { flagsAll: ["estacao_aberta"] },
    body: "Cheiro de querosene e remédio. Uma cama de campanha desfeita, tiras de camisa sujas de sangue, um rádio de bancada antigo sem energia. Na parede, um mapa topográfico com alfinetes. Alguém esteve aqui há poucas horas.",
    choices: [
      c("vs_estacao_interior", "diario", {
        label: "Ler o diário de campo sobre a bancada", durationMinutes: 15,
        outcome: { text: "Iara Menezes, hidróloga, 1998: “O sinal volta toda noite às 23h40. Sete, quatro, zero. Não são aleatórios.” As últimas páginas estão em branco — exceto a última, com a data de ontem, noutra letra: “ela ainda transmite”.", effects: [{ op: "addItem", item: "diario_campo" }, { op: "clue", key: "diario_iara" }, { op: "status", field: "stress", delta: 10 }] },
      }),
      c("vs_estacao_interior", "mapa", {
        label: "Levar o mapa da parede", durationMinutes: 5,
        outcome: { text: "Três alfinetes: a estação, a ravina e um rochedo a sudeste, com “740 — caixa” escrito à mão.", effects: [{ op: "addItem", item: "mapa_topografico" }, { op: "clue", key: "mapa_alfinetes" }, { op: "reveal", location: "rochedo" }, { op: "revealLink", from: "lago", to: "rochedo" }] },
      }),
      c("vs_estacao_interior", "esperar", {
        label: "Esconder-se e esperar quem voltar", durationMinutes: 60, safe: true,
        outcome: {
          text: "Você se encolhe atrás de um armário e espera.",
          check: { attr: "furtividade", base: 55 },
          success: { text: "Um homem mancando entra, com uniforme de piloto rasgado e uma chave de roda na mão. Ele não vê você.", effects: [{ op: "flag", key: "piloto_presente" }, { op: "clue", key: "piloto_vivo" }] },
          failure: { text: "Ninguém entra. Mas quando você sai, a porta dos fundos está aberta — e não foi você quem abriu.", effects: [{ op: "flag", key: "piloto_presente" }, { op: "status", field: "stress", delta: 15 }] },
        },
      }),
    ],
  },
  {
    id: "vs_piloto", title: "O piloto", locationId: "estacao", priority: 43, repeatable: false,
    trigger: { flagsAll: ["piloto_presente"] },
    body: "O homem tem a perna enfaixada com tiras de camisa e segura uma chave de roda como arma. “Você não devia ter saído do avião”, ele diz. “Eles vêm buscar a carga. Não a gente.”",
    choices: [
      c("vs_piloto", "conversar", {
        label: "Levantar as mãos e conversar", durationMinutes: 5,
        outcome: {
          text: "Você mostra as mãos vazias.",
          check: { attr: "comunicacao", base: 50 },
          success: { text: "Ele abaixa a chave de roda, devagar. “Brandão. Comandante Brandão.” Dá para conversar com ele agora.", effects: [{ op: "flagAdd", key: "confianca_piloto", delta: 2 }] },
          failure: { text: "Ele não abaixa a arma, mas também não ataca. Fica olhando para a porta.", effects: [{ op: "flagAdd", key: "confianca_piloto", delta: 0 }] },
        },
      }),
      c("vs_piloto", "oferecer", {
        label: "Oferecer água ou comida", durationMinutes: 5, requirements: { hasAnyCategory: ["agua", "comida"] },
        outcome: { text: "Ele come com as mãos tremendo. Depois tira do bolso um sinalizador e coloca na sua mão. “Se o helicóptero vier, não erra.”", effects: [{ op: "consumeAny", categories: ["agua", "comida"] }, { op: "flagAdd", key: "confianca_piloto", delta: 3 }, { op: "addItem", item: "sinalizador" }] },
      }),
      c("vs_piloto", "tomar", {
        label: "Tomar a chave de roda dele", durationMinutes: 5, safe: true,
        outcome: {
          text: "Você avança.",
          check: { attr: "forca", base: 50 },
          success: { text: "Você arranca a chave da mão dele. Ele recua, some pela porta dos fundos e não volta.", effects: [{ op: "flag", key: "piloto_fugiu" }, { op: "status", field: "stress", delta: 10 }] },
          failure: { text: "A chave de roda acerta sua cabeça de raspão. Quando sua visão volta, ele já sumiu.", effects: [{ op: "flag", key: "piloto_fugiu" }, { op: "wound", part: "cabeca", type: "contusao", severity: 2 }] },
        },
      }),
    ],
  },
  {
    id: "vs_radio", title: "O rádio de bancada", locationId: "estacao", priority: 42, repeatable: true,
    trigger: { afterEvent: "vs_estacao_interior", hasItem: "bateria_emergencia", cooldownMinutes: 60 },
    body: "O rádio é antigo, mas os fios parecem inteiros. A bateria de emergência do avião tem terminais compatíveis — talvez.",
    choices: [
      c("vs_radio", "ligar", {
        label: "Ligar a bateria ao rádio", durationMinutes: 20,
        outcome: {
          text: "Você descasca os fios e conecta os terminais.",
          check: { attr: "conhecimento_tecnico", base: 45, itemBonus: { canivete: 10 }, experience: ["tecnologia", "mecanica"] },
          success: { text: "O painel acende. Estática — e então uma voz real, cansada, de uma torre de controle regional. Você repete as coordenadas do mapa. “Recebido. Aguentem firme.”", effects: [{ op: "end", ending: "resgate_radio" }] },
          failure: { text: "Faísca. Cheiro de plástico queimado. O rádio chia e morre de novo. A bateria esquentou.", effects: [{ op: "wound", part: "braco_dir", type: "queimadura", severity: 1 }, { op: "itemDurability", item: "bateria_emergencia", delta: -50 }] },
        },
      }),
      c("vs_radio", "sintonizar", {
        label: "Procurar a frequência dos números", durationMinutes: 10,
        outcome: { text: "Com a bateria, o receptor capta a voz: “sete… quatro… zero”. O sinal é fortíssimo — não vem de longe. Vem de um ponto do próprio vale, a sudeste.", effects: [{ op: "clue", key: "frequencia" }, { op: "reveal", location: "rochedo" }, { op: "revealLink", from: "penhasco", to: "rochedo" }, { op: "status", field: "stress", delta: 8 }] },
      }),
      c("vs_radio", "depois", { label: "Deixar para depois", durationMinutes: 1, safe: true, outcome: { text: "Você se afasta do rádio." } }),
    ],
  },
  {
    id: "vs_penhasco", title: "A luz na ravina", locationId: "penhasco", priority: 40, repeatable: false,
    trigger: {},
    body: "No último poste do guarda-corpo, amarrada com arame, uma lanterna acesa aponta para a névoa. Ela pisca: longa, curta, longa. Lá embaixo, algo laranja brilha entre as rochas.",
    choices: [
      c("vs_penhasco", "corda", {
        label: "Descer usando a corda", durationMinutes: 40, requirements: { hasItem: ["corda"] },
        outcome: {
          text: "Você amarra a corda no poste mais firme e desce de costas.",
          check: { attr: "agilidade", base: 60 },
          success: { text: "No fundo: caixas lacradas com o mesmo adesivo laranja do bagageiro do avião. Carga que nunca deveria existir. E pegadas indo para sudeste.", effects: [{ op: "clue", key: "carga_ravina" }, { op: "revealLink", from: "penhasco", to: "rochedo" }] },
          failure: { text: "A pedra cede sob seu pé. A corda segura você — mas não antes de sua perna bater na rocha com um estalo seco.", effects: [{ op: "wound", part: "perna_esq", type: "fratura", severity: 2 }] },
        },
      }),
      c("vs_penhasco", "semcorda", {
        label: "Descer sem equipamento", durationMinutes: 30,
        outcome: {
          text: "Você procura apoios na rocha molhada.",
          check: { attr: "agilidade", base: 25 },
          success: { text: "Contra qualquer lógica, você chega ao fundo. Caixas lacradas com adesivo laranja. Pegadas indo para sudeste.", effects: [{ op: "clue", key: "carga_ravina" }, { op: "revealLink", from: "penhasco", to: "rochedo" }] },
          failure: { text: "A rocha escorrega sob seus dedos. A névoa engole o som da queda.", effects: [{ op: "kill", cause: "Queda na ravina" }] },
        },
      }),
      c("vs_penhasco", "lanterna", { label: "Desamarrar a lanterna e se afastar", durationMinutes: 5, safe: true, outcome: { text: "A lanterna é igual à sua. O padrão de piscadas não é aleatório — alguém sinalizava para baixo.", effects: [{ op: "addItem", item: "lanterna", state: { battery: 35 } }, { op: "clue", key: "sinal_luz" }] } }),
    ],
  },
  {
    id: "vs_nevoa", title: "A voz na névoa", locationId: "penhasco", priority: 60, repeatable: false,
    trigger: { night: true, flagsAll: ["ouviu_resposta"], afterEvent: "vs_penhasco" },
    body: "Da névoa da ravina, a mesma voz que respondeu ao seu grito chama baixo, paciente, pelo seu nome.",
    choices: [
      c("vs_nevoa", "ir", {
        label: "Caminhar em direção à voz", durationMinutes: 10,
        outcome: {
          text: "Você dá um passo. Depois outro.",
          check: { attr: "controle_emocional", base: 40 },
          success: { text: "Você para. Seu pé esquerdo está no ar, além da borda. Não há ninguém ali. Nunca houve.", effects: [{ op: "status", field: "stress", delta: 25 }, { op: "clue", key: "voz_na_nevoa" }] },
          failure: { text: "A voz fica cada vez mais perto e mais gentil. Depois, não há mais chão.", effects: [{ op: "kill", cause: "Desaparecido na névoa da ravina" }] },
        },
      }),
      c("vs_nevoa", "afastar", { label: "Tapar os ouvidos e se afastar da borda", durationMinutes: 10, safe: true, outcome: { text: "Você recua até sentir o guarda-corpo nas costas. A voz continua, mais baixa.", effects: [{ op: "status", field: "stress", delta: 15 }] } }),
      c("vs_nevoa", "responder", { label: "Responder", durationMinutes: 2, outcome: { text: "A voz para. Então repete exatamente o que você disse — com a sua entonação.", effects: [{ op: "status", field: "stress", delta: 12 }, { op: "clue", key: "voz_na_nevoa" }] } }),
    ],
  },
  {
    id: "vs_rochedo", title: "A caixa no rochedo", locationId: "rochedo", priority: 40, repeatable: false,
    trigger: {},
    body: "No topo, junto ao marco geodésico, uma caixa metálica com cadeado de combinação de três dígitos. Daqui se vê o vale inteiro — e qualquer coisa no céu veria você.",
    choices: [
      c("vs_rochedo", "740", {
        label: "Tentar a combinação 7-4-0", durationMinutes: 5, requirements: { cluesAny: ["frequencia", "diario_iara", "mapa_alfinetes"] },
        outcome: { text: "Clique. Dentro: dois sinalizadores, embalados em plástico, e uma foto antiga de uma mulher de capa de chuva segurando uma prancheta.", effects: [{ op: "addItem", item: "sinalizador", qty: 2 }, { op: "clue", key: "caixa_aberta" }] },
      }),
      c("vs_rochedo", "forcar", {
        label: "Forçar o cadeado", durationMinutes: 20,
        outcome: {
          text: "Você bate no cadeado com uma pedra.",
          check: { attr: "forca", base: 30, itemBonus: { canivete: 15 } },
          success: { text: "A haste cede. Dentro: um sinalizador.", effects: [{ op: "addItem", item: "sinalizador" }] },
          failure: { text: "A pedra escorrega e esmaga seus dedos.", effects: [{ op: "wound", part: "braco_esq", type: "contusao", severity: 1 }] },
        },
      }),
      c("vs_rochedo", "deixar", { label: "Deixar a caixa", durationMinutes: 1, safe: true, outcome: { text: "Você deixa a caixa onde está." } }),
    ],
  },
  {
    id: "vs_helicoptero", title: "Rotor ao longe", locationId: null, priority: 70, repeatable: false,
    trigger: { day: true, minMinute: 420 },
    body: "Um som grave e ritmado cresce do sul. Um helicóptero cruza o vale baixo, seguindo o rio, e some atrás da crista. Estão procurando. Vão voltar — e precisam ver você de um lugar aberto.",
    choices: [
      c("vs_helicoptero", "acenar", { label: "Acenar e gritar", durationMinutes: 2, safe: true, outcome: { text: "Ele já foi. Mas vai voltar.", effects: [{ op: "flag", key: "busca_ativa" }, { op: "status", field: "stress", delta: -10 }] } }),
      c("vs_helicoptero", "memorizar", { label: "Memorizar a rota do helicóptero", durationMinutes: 5, outcome: { text: "Ele circula sobre o rochedo a sudeste antes de voltar. É ali que ele vai passar de novo.", effects: [{ op: "flag", key: "busca_ativa" }, { op: "reveal", location: "rochedo" }, { op: "revealLink", from: "lago", to: "rochedo" }] } }),
    ],
  },
  {
    id: "vs_resgate", title: "Céu aberto", locationId: null, priority: 80, repeatable: true,
    trigger: { day: true, openSky: true, flagsAll: ["busca_ativa"], cooldownMinutes: 60 },
    body: "Daqui você tem visão limpa do céu. Se o helicóptero voltar, é agora ou nunca.",
    choices: [
      c("vs_resgate", "sinalizador", {
        label: "Disparar o sinalizador", durationMinutes: 2, requirements: { hasItem: ["sinalizador"] },
        outcome: {
          text: "Você espera o som do rotor e puxa o cordão. Fumaça vermelha sobe, densa.",
          effects: [{ op: "removeItem", item: "sinalizador" }],
          check: { attr: "percepcao", base: 70 },
          success: { text: "O helicóptero faz uma curva fechada e vem na sua direção.", effects: [{ op: "end", ending: "resgate_sinalizador" }] },
          failure: { text: "Cedo demais. O helicóptero estava longe e não vê a fumaça.", effects: [] },
        },
      }),
      c("vs_resgate", "fogueira", {
        label: "Fazer uma fogueira de sinal", durationMinutes: 30, requirements: { hasItem: ["galhos_secos"], hasAnyItem: ["isqueiro", "fosforos"] },
        outcome: {
          text: "Você empilha os galhos e joga folhas verdes por cima para fazer fumaça.",
          effects: [{ op: "removeItem", item: "galhos_secos" }],
          check: { attr: "improviso", base: 45, experience: ["sobrevivencia"] },
          success: { text: "Uma coluna de fumaça branca sobe reta no ar parado. Minutos depois, o rotor.", effects: [{ op: "end", ending: "resgate_fogueira" }] },
          failure: { text: "O fogo não pega a tempo. A fumaça sai rala.", effects: [] },
        },
      }),
      c("vs_resgate", "esperar", { label: "Esperar e observar", durationMinutes: 30, safe: true, outcome: { text: "Nada no céu além de urubus." } }),
    ],
  },
  {
    id: "vs_febre", title: "Febre", locationId: null, priority: 65, repeatable: false,
    trigger: { anyLocation: true, statusGte: { infection: 55 } },
    body: "Seu corpo queima e treme ao mesmo tempo. Na borda da luz, uma mulher de capa de chuva observa você. Ela segura uma prancheta.",
    choices: [
      c("vs_febre", "remedio", { label: "Tomar um analgésico", durationMinutes: 2, requirements: { hasItem: ["analgesico"] }, outcome: { text: "Você engole o comprimido a seco. Quando olha de novo, não há ninguém.", effects: [{ op: "useCharge", item: "analgesico" }, { op: "painkiller", minutes: 360 }, { op: "status", field: "stress", delta: -10 }] } }),
      c("vs_febre", "perguntar", {
        label: "Perguntar quem ela é", durationMinutes: 5,
        outcome: {
          text: "“Quem é você?”",
          check: { attr: "controle_emocional", base: 50 },
          success: { text: "“Trinta e sete dias”, ela diz. E some quando você pisca.", effects: [{ op: "clue", key: "iara_visao" }, { op: "status", field: "stress", delta: 5 }] },
          failure: { text: "Ela não responde. Fica. Você passa horas sem conseguir fechar os olhos.", effects: [{ op: "status", field: "stress", delta: 25 }] },
        },
      }),
      c("vs_febre", "ignorar", { label: "Fechar os olhos e esperar passar", durationMinutes: 30, safe: true, outcome: { text: "Quando você abre os olhos, ela não está mais lá.", effects: [{ op: "status", field: "stress", delta: 10 }] } }),
    ],
  },
  {
    id: "vs_sede", title: "A poça", locationId: null, priority: 55, repeatable: false,
    trigger: { anyLocation: true, statusGte: { thirst: 75 } },
    body: "Sua língua gruda no céu da boca. Numa depressão entre as raízes, uma poça de água escura, com folhas no fundo.",
    choices: [
      c("vs_sede", "beber", { label: "Beber da poça", durationMinutes: 3, outcome: { text: "Tem gosto de terra e ferro.", effects: [{ op: "status", field: "thirst", delta: -25 }, { op: "disease", key: "gastroenterite", chanceAttr: "resistencia", base: 30 }] } }),
      c("vs_sede", "resistir", { label: "Resistir", durationMinutes: 1, safe: true, outcome: { text: "Você passa por ela sem olhar.", effects: [{ op: "status", field: "stress", delta: 10 }] } }),
    ],
  },
  {
    id: "vs_frio", title: "Tremores", locationId: null, priority: 66, repeatable: false,
    trigger: { anyLocation: true, statusLte: { bodyTemp: 35.2 } },
    body: "Os tremores vêm em ondas. Seus dedos não fecham direito. Se isso continuar, você vai parar de tremer — e isso será pior.",
    choices: [
      c("vs_frio", "encolher", { label: "Proteger-se do vento e se encolher", durationMinutes: 20, safe: true, outcome: { text: "Joelhos no peito, costas contra uma pedra.", effects: [{ op: "status", field: "bodyTemp", delta: 0.4 }] } }),
      c("vs_frio", "mover", { label: "Mexer-se sem parar para gerar calor", durationMinutes: 15, outcome: { text: "Você pula, esfrega os braços, anda em círculos.", effects: [{ op: "status", field: "bodyTemp", delta: 0.6 }, { op: "status", field: "energy", delta: -10 }] } }),
    ],
  },
];

export const VALE_SILENTE: GameContent = {
  scenarioId: "vale_silente",
  title: "Vale Silente",
  startLocation: "destrocos",
  startMinuteOfDay: 23 * 60 + 40,
  items: Object.fromEntries(ITEMS.map((i) => [i.id, i])),
  locations: Object.fromEntries(LOCATIONS.map((l) => [l.id, l])),
  links: LINKS,
  events: EVENTS,
  clues: Object.fromEntries(
    [
      { key: "elt_desligado", title: "Transmissor desligado", text: "O ELT do avião foi desligado manualmente. Alguém não queria que o avião fosse encontrado." },
      { key: "voz_na_mata", title: "Uma resposta", text: "Alguém — ou algo — respondeu ao seu grito." },
      { key: "pouso_tentado", title: "Pouso, não queda", text: "O avião tentou pousar ali. O piloto sabia para onde ia." },
      { key: "caderno_piloto", title: "Caderno de voo", text: "“VS — pouso não registrado — R$ 40 mil na volta.” O desvio foi pago." },
      { key: "luz_na_crista", title: "Luz na crista", text: "Alguém sobe a crista norte até a antena como quem conhece o caminho." },
      { key: "marcas_iara", title: "Trinta e sete riscos", text: "Alguém chamada Iara contou 37 dias no acampamento." },
      { key: "agua_contaminada", title: "Diesel no córrego", text: "Um tanque velho vaza perto da estação. A água do córrego precisa ser tratada." },
      { key: "cerca_cortada", title: "Cerca remendada", text: "Alguém entra e sai da estação pelos fundos." },
      { key: "diario_iara", title: "O diário de Iara", text: "Em 1998, a hidróloga Iara Menezes registrou um sinal toda noite às 23h40: 7-4-0." },
      { key: "mapa_alfinetes", title: "Três alfinetes", text: "Estação, ravina e um rochedo a sudeste: “740 — caixa”." },
      { key: "piloto_vivo", title: "O piloto está vivo", text: "O comandante sobreviveu à queda — e se esconde na estação." },
      { key: "frequencia", title: "A frequência", text: "A transmissão dos números não vem de longe: vem de dentro do vale." },
      { key: "carga_ravina", title: "Carga na ravina", text: "Caixas lacradas com o adesivo do bagageiro, jogadas na ravina." },
      { key: "sinal_luz", title: "Sinal para baixo", text: "Uma lanterna no mirante piscava um padrão para dentro da ravina." },
      { key: "voz_na_nevoa", title: "Sua própria voz", text: "A voz na névoa repetiu você. Não há explicação para isso." },
      { key: "caixa_aberta", title: "A foto", text: "Na caixa do rochedo, a foto de uma mulher de capa de chuva com uma prancheta." },
      { key: "iara_visao", title: "Trinta e sete dias", text: "Na febre, a mulher da foto falou com você." },
      { key: "desvio_rota", title: "A confissão", text: "Brandão admitiu: foi pago para pousar no vale e entregar a carga. O ELT, desligou ele mesmo." },
    ].map((cl) => [cl.key, cl]),
  ),
  endings: {
    resgate_radio: { key: "resgate_radio", type: "victory", title: "Frequência aberta", text: "Horas depois do chamado, faróis sobem a estrada de serviço até a estação. Você sobreviveu ao Vale Silente." },
    resgate_sinalizador: { key: "resgate_sinalizador", type: "victory", title: "Fumaça vermelha", text: "O helicóptero pousa no rochedo. Enquanto sobe, você olha para o vale — e por um instante vê uma capa de chuva entre as árvores." },
    resgate_fogueira: { key: "resgate_fogueira", type: "victory", title: "Coluna de fumaça", text: "A fumaça branca guiou o resgate até você. O vale fica para trás, em silêncio." },
    morte: { key: "morte", type: "defeat", title: "O vale fica com você", text: "Semanas depois, uma equipe encontra os destroços. O relatório final fala em “causas naturais”." },
  },
  npcs: {
    piloto: {
      id: "piloto", name: "Comandante Brandão", locationId: "estacao", presentFlag: "piloto_presente", goneFlag: "piloto_fugiu",
      persona: "Piloto de táxi aéreo, 50 anos, ferido na perna, febril, paranoico e culpado. Fala pouco, em frases curtas. Aceitou dinheiro para desviar o voo e entregar uma carga no vale. Tem medo de quem vem buscar a carga. Nunca fala de forma sobrenatural sobre si mesmo.",
      intents: ["perguntar_acidente", "perguntar_caminho", "pedir_ajuda", "oferecer_item", "acalmar", "ameacar", "perguntar_numeros", "outro"],
    },
  },
  npcRules: {
    piloto: {
      perguntar_acidente: {
        text: "Você pergunta o que aconteceu com o avião.",
        check: { attr: "comunicacao", base: 45 },
        success: { text: "Ele fala baixo: foi pago para pousar no vale, entregar a carga e sumir. O ELT, ele mesmo desligou.", effects: [{ op: "clue", key: "desvio_rota" }, { op: "flagAdd", key: "confianca_piloto", delta: 1 }] },
        failure: { text: "Ele desvia o olhar e não responde.", effects: [{ op: "status", field: "stress", delta: 3 }] },
      },
      perguntar_caminho: {
        text: "Você pergunta como sair do vale.",
        effects: [{ op: "reveal", location: "rochedo" }, { op: "revealLink", from: "lago", to: "rochedo" }],
      },
      perguntar_numeros: {
        text: "Você pergunta sobre os números no rádio.",
        effects: [{ op: "clue", key: "frequencia" }, { op: "status", field: "stress", delta: 5 }],
      },
      pedir_ajuda: {
        text: "Você pede ajuda a ele.",
        requirements: { flagsAll: ["confianca_piloto"] },
        blockedText: "“Ajuda?” Ele ri sem humor. “Nem me conhece.”",
        effects: [{ op: "addItem", item: "atadura" }],
      },
      oferecer_item: {
        text: "Você oferece algo a ele.",
        requirements: { hasAnyCategory: ["agua", "comida"] },
        blockedText: "Você não tem nada que ele queira.",
        effects: [{ op: "consumeAny", categories: ["agua", "comida"] }, { op: "flagAdd", key: "confianca_piloto", delta: 2 }],
      },
      acalmar: {
        text: "Você tenta acalmá-lo.",
        check: { attr: "controle_emocional", base: 50 },
        success: { text: "Os ombros dele descem um pouco.", effects: [{ op: "flagAdd", key: "confianca_piloto", delta: 1 }, { op: "status", field: "stress", delta: -5 }] },
        failure: { text: "Ele fica ainda mais agitado.", effects: [] },
      },
      ameacar: {
        text: "Você o ameaça.",
        effects: [{ op: "flag", key: "piloto_fugiu" }, { op: "status", field: "stress", delta: 8 }],
      },
      outro: { text: "Ele escuta, mas não parece entender o que você quer.", effects: [] },
    },
  },
  startingInventory: [
    { itemId: "camiseta", container: "equipped" },
    { itemId: "moletom", container: "equipped" },
    { itemId: "calca_jeans", container: "equipped" },
    { itemId: "tenis", container: "equipped" },
    { itemId: "mochila_pequena", container: "equipped" },
    { itemId: "celular", container: "pockets", state: { battery: 23 } },
    { itemId: "garrafa_agua", container: "backpack_side" },
    { itemId: "barra_cereal", container: "backpack_side", qty: 2 },
    // Kit do bolso da poltrona: garante que o tutorial de sangramento seja jogável.
    { itemId: "atadura", container: "pockets" },
  ],
  objectives: [
    {
      id: "radio", title: "Chamar pelo rádio",
      steps: [
        { id: "bateria", label: "Recuperar a bateria de emergência", hint: "Está no compartimento de carga do avião, emperrado. Força ou uma alavanca resolvem.", locations: ["destrocos"], done: [{ hasAnyItem: ["bateria_emergencia"] }] },
        { id: "estacao", label: "Entrar na estação de rádio", hint: "A antena a leste. O portão tem cadeado — procure outro jeito de entrar.", locations: ["estacao"], done: [{ flagsAll: ["estacao_aberta"] }] },
        { id: "ligar", label: "Ligar a bateria a um rádio", hint: "Dentro da estação. Conhecimento técnico ou um canivete ajudam com os fios.", locations: ["estacao"] },
      ],
    },
    {
      id: "sinal", title: "Sinalizar para o resgate",
      steps: [
        { id: "busca", label: "Descobrir se alguém está procurando", hint: "Sobreviva à noite. De dia, escute o céu.", done: [{ flagsAll: ["busca_ativa"] }] },
        { id: "sinal", label: "Conseguir um jeito de sinalizar", hint: "Um sinalizador — ou lenha seca e algo para acender fogo.", locations: ["rochedo", "estacao"], done: [{ hasAnyItem: ["sinalizador"] }, { hasAllItems: ["galhos_secos"], hasAnyItem: ["isqueiro", "fosforos"] }] },
        { id: "ceu", label: "Ir a um lugar de céu aberto, de dia", hint: "Do rochedo ou do mirante o helicóptero consegue ver você.", locations: ["rochedo", "penhasco"] },
      ],
    },
  ],
  professionKits: {
    enfermagem: [{ itemId: "atadura", container: "backpack_side" }],
    mecanico: [{ itemId: "canivete", container: "pockets" }],
    tecnico_ti: [{ itemId: "canivete", container: "pockets" }],
    guia: [{ itemId: "isqueiro", container: "pockets" }],
    atleta: [{ itemId: "chocolate", container: "backpack_side" }],
  },
};

export const SCENARIOS: Record<string, GameContent> = { vale_silente: VALE_SILENTE };

export function getScenario(id: string): GameContent {
  const s = SCENARIOS[id];
  if (!s) throw new Error(`Cenário desconhecido: ${id}`);
  return s;
}
