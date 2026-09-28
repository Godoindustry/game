/**
 * Chefes do Vale Silente — cada um é o CLÍMAX de uma trama que o jogador já vinha seguindo:
 *
 *  1. A Mãe das Asas  (Poço escuro)   — de onde vêm as mordidas. Derrotá-la cura quem ainda não virou.
 *  2. O Lobo de Âmbar (Trilha da crista) — a fera do uivo é Anselmo, o mateiro dos laços de arame.
 *  3. Tavares         (Ponte)          — o dono da carga. Humano, armado, e conversa pela IA.
 *  4. Iara, a Voz     (Estação, 23h40) — a hidróloga morta em 1998. O coração de todo o mistério.
 *
 * Estrutura de cada chefe: PRENÚNCIO (suspense) → FASE 1 → FASE 2 (quando há) → CONSEQUÊNCIA.
 * Falhar numa fase fere e a fase volta depois (repetível); vencer avança. Várias escolhas só
 * existem para certas linhagens — e aparecem trancadas para os outros, como um segredo.
 * Tags de voz ([whispers], [dark laugh]…) só da lista de src/shared/voiceTags.ts.
 */
import type { ChoiceDef, ClueDef, EndingDef, EventDef, NpcDef, NpcRule } from "../engine/types";

const c = (eventId: string, id: string, x: Omit<ChoiceDef, "id">): ChoiceDef => ({ id: `${eventId}.${id}`, ...x });

export const BOSS_EVENTS: EventDef[] = [
  // ════════════════════ 1. A MÃE DAS ASAS ════════════════════
  {
    id: "ch_ninho", title: "As marcas chamam", locationId: null, priority: 57, repeatable: false,
    trigger: { anyLocation: true, night: true, diseaseAny: ["mordida"], minMinute: 60 },
    body: "[breathing heavily] As marcas no seu pescoço latejam no ritmo de outro coração — um coração enorme, lento, que não é o seu. [pause] Quando você fecha os olhos, vê água parada e uma luz verde lá no fundo. [whispers] Alguma coisa no poço escuro sabe o seu gosto.",
    choices: [
      c("ch_ninho", "ouvir", {
        label: "Deixar o chamado guiar você", durationMinutes: 5,
        outcome: {
          text: "Você para de resistir e escuta.",
          check: { attr: "controle_emocional", base: 45 },
          success: { text: "[tense] Por um instante você enxerga pelo olhar dela: uma caverna sob o poço, asas dobradas como um manto, dezenas de corpos pequenos pendurados no teto. [pause] Ela é a mãe de todas. E está com fome.", effects: [{ op: "clue", key: "ninho_mae" }, { op: "flag", key: "mae_conhecida" }, { op: "status", field: "stress", delta: 8 }] },
          failure: { text: "[gasps] Você volta a si de joelhos, com terra na boca, dez passos longe de onde estava. Não lembra de ter andado.", effects: [{ op: "flag", key: "mae_conhecida" }, { op: "status", field: "stress", delta: 18 }] },
        },
      }),
      c("ch_ninho", "resistir", { label: "Morder a própria língua até a dor apagar a visão", durationMinutes: 2, safe: true, outcome: { text: "O gosto de sangue traz você de volta. [whispers] Lá longe, algo parece achar graça.", effects: [{ op: "flag", key: "mae_conhecida" }, { op: "status", field: "pain", delta: 5 }, { op: "status", field: "stress", delta: 6 }] } }),
    ],
  },
  {
    id: "ch_mae", title: "A Mãe das Asas", locationId: "lago", priority: 64, repeatable: true,
    trigger: { night: true, flagsAll: ["mae_conhecida"], flagsNone: ["mae_ferida", "mae_caida", "pacto_sangue"], cooldownMinutes: 120 },
    body: "[ominous] A água do poço escuro sobe um palmo sem nenhuma chuva. Das pedras, desdobra-se algo do tamanho de um homem alto, envolto nas próprias asas como numa capa de viúva. [pause] O rosto é quase humano. Quase. [hisses] Ela sorri com dentes demais e diz, numa voz de muitas vozes: [whispers] “Você voltou para a mãe.”",
    choices: [
      c("ch_mae", "luz", {
        label: "Cravar o facho da lanterna nos olhos dela", durationMinutes: 5, requirements: { hasItem: ["lanterna"] },
        outcome: {
          text: "Você levanta a lanterna como quem ergue uma faca.",
          check: { attr: "percepcao", base: 50 },
          success: { text: "[gasps] O facho acerta em cheio. O grito dela estoura os seus ouvidos e as asas se rasgam contra as pedras. Ela recua para dentro do poço, cega e ferida — [pause] mas não morta.", effects: [{ op: "flag", key: "mae_ferida" }, { op: "status", field: "stress", delta: 10 }] },
          failure: { text: "A luz treme na sua mão. Ela está atrás de você antes que o facho a encontre.", effects: [{ op: "bite" }, { op: "status", field: "stress", delta: 12 }] },
        },
      }),
      c("ch_mae", "fogo", {
        label: "Incendiar um feixe de galhos e avançar com o fogo", durationMinutes: 10, requirements: { hasItem: ["galhos_secos"], hasAnyItem: ["isqueiro", "fosforos"] },
        outcome: {
          text: "Você acende o feixe. As chamas lambem seus dedos.",
          effects: [{ op: "removeItem", item: "galhos_secos" }],
          check: { attr: "improviso", base: 50, experience: ["sobrevivencia"] },
          success: { text: "[terrified] As asas dela pegam fogo como papel velho. O cheiro é de couro e de coisa muito antiga queimando. Ela mergulha no poço, soltando vapor — [pause] ferida de verdade.", effects: [{ op: "flag", key: "mae_ferida" }] },
          failure: { text: "Um golpe de asa apaga o fogo e joga brasas no seu rosto.", effects: [{ op: "wound", part: "cabeca", type: "queimadura", severity: 1 }, { op: "status", field: "stress", delta: 12 }] },
        },
      }),
      c("ch_mae", "ajoelhar", {
        label: "Ajoelhar-se e oferecer o próprio sangue", durationMinutes: 10, requirements: { lineage: ["vampire"] },
        outcome: {
          text: "[reverent] Você se ajoelha na lama e expõe o pulso.",
          effects: [{ op: "flag", key: "pacto_sangue" }, { op: "clue", key: "pacto_sangue" }, { op: "status", field: "stress", delta: -25 }],
          check: { attr: "comunicacao", base: 45 },
          success: { text: "Ela bebe devagar, como quem prova vinho. [dark laugh] “Filho meu.” [pause] “O vale inteiro é seu quando a lua cair. Os homens da carga, a mulher do rádio, o piloto medroso — todos seus.”" },
          failure: { text: "Ela bebe mais do que devia. O mundo gira. [whispers] “Ainda fraco… mas meu.”", effects: [{ op: "status", field: "energy", delta: -20 }] },
        },
      }),
      c("ch_mae", "fugir", {
        label: "Correr para longe do poço", durationMinutes: 10, safe: true,
        outcome: {
          text: "Você dá as costas para ela e corre.",
          check: { attr: "agilidade", base: 45 },
          success: { text: "Asas batem logo atrás — e param na primeira faixa de luar. [whispers] “Amanhã, então.”", effects: [{ op: "status", field: "stress", delta: 15 }, { op: "status", field: "energy", delta: -10 }] },
          failure: { text: "Garras fecham no seu ombro e soltam só depois de provar você.", effects: [{ op: "bite" }, { op: "status", field: "stress", delta: 15 }] },
        },
      }),
    ],
  },
  {
    id: "ch_mae_furia", title: "A fúria da Mãe", locationId: "lago", priority: 64, repeatable: true,
    trigger: { night: true, flagsAll: ["mae_ferida"], flagsNone: ["mae_caida"], cooldownMinutes: 90 },
    body: "[menacing] O poço ferve. Ela sai da água de uma vez, meio queimada, meio cega — e já não sorri. As filhas descem das árvores como folhas pretas. [urgent] É agora: ela ou você.",
    choices: [
      c("ch_mae_furia", "golpe", {
        label: "Esperar o bote e golpear o coração dela", durationMinutes: 10,
        outcome: {
          text: "Você finca os pés na lama e espera.",
          check: { attr: "forca", base: 40, itemBonus: { canivete: 15 } },
          success: { text: "[gasps] Ela vem. Você não recua. [long pause] Quando acaba, a coisa no chão é pequena, seca, quase frágil. As filhas se dispersam em silêncio. [relieved] As marcas no seu pescoço param de latejar pela primeira vez.", effects: [{ op: "flag", key: "mae_caida" }, { op: "clue", key: "mae_caida" }, { op: "cure", key: "mordida" }, { op: "status", field: "stress", delta: -20 }] },
          failure: { text: "O bote é rápido demais. Dentes, garras, água gelada — você só se solta porque ela se engasga com a luz de algum relâmpago.", effects: [{ op: "bite" }, { op: "wound", part: "torso", type: "laceracao", severity: 2 }] },
        },
      }),
      c("ch_mae_furia", "armadilha", {
        label: "Atrair as filhas para a luz e deixá-la sozinha", durationMinutes: 15, requirements: { hasItem: ["lanterna"] },
        outcome: {
          text: "Você pendura a lanterna num galho e se esconde no escuro.",
          check: { attr: "furtividade", base: 45 },
          success: { text: "As filhas cercam a luz, confusas. A Mãe fica sozinha na margem — e não vê você chegando. [long pause] Quando termina, o poço fica em silêncio. [relieved] A sede escura vai embora do seu corpo.", effects: [{ op: "flag", key: "mae_caida" }, { op: "clue", key: "mae_caida" }, { op: "cure", key: "mordida" }, { op: "status", field: "stress", delta: -20 }] },
          failure: { text: "Um galho estala sob seu pé. Ela vira a cabeça — e sorri de novo.", effects: [{ op: "bite" }, { op: "status", field: "stress", delta: 15 }] },
        },
      }),
      c("ch_mae_furia", "recuar", { label: "Recuar enquanto ela ainda está fraca", durationMinutes: 10, safe: true, outcome: { text: "Você sai de perto do poço de costas, sem piscar. [whispers] Ela não segue — está lambendo as feridas.", effects: [{ op: "status", field: "stress", delta: 10 }] } }),
    ],
  },
  {
    id: "ch_trono", title: "O trono da noite", locationId: "lago", priority: 63, repeatable: true,
    trigger: { night: true, flagsAll: ["pacto_sangue", "tavares_resolvido"], flagsAny: ["iara_em_paz", "iara_furia"], lineageAny: ["vampire"], minMinute: 1440, cooldownMinutes: 240 },
    body: "[reverent] As filhas da Mãe pousam em volta de você em círculo, asas dobradas, cabeças baixas. Ela espera na água, [whispers] e estende a mão ossuda. “A lua caiu. O vale é seu, se você quiser. Nunca mais frio. Nunca mais fome. Nunca mais resgate.”",
    choices: [
      c("ch_trono", "aceitar", { label: "Aceitar o vale e nunca mais sair", durationMinutes: 5, outcome: { text: "[dark laugh] Você pega a mão dela. O frio vai embora para sempre.", effects: [{ op: "end", ending: "senhor_da_noite" }] } }),
      c("ch_trono", "recusar", { label: "Recusar — ainda quer voltar para casa", durationMinutes: 2, safe: true, outcome: { text: "[sighs] Ela recolhe a mão sem raiva. [whispers] “Humanos sempre querem voltar. Eu espero.”", effects: [{ op: "status", field: "stress", delta: 8 }] } }),
    ],
  },

  // ════════════════════ 2. O LOBO DE ÂMBAR ════════════════════
  {
    id: "ch_carcaca", title: "Garras a três metros", locationId: "mata", priority: 39, repeatable: false,
    trigger: { day: true, afterEvent: "vs_uivo" },
    body: "[tense] Uma queixada adulta, aberta do pescoço à barriga, pendurada num galho como se alguém guardasse comida. [pause] No tronco, marcas de garras — a três metros do chão. E, perto da raiz, um laço de arame igual ao da trilha, [ominous] cortado por dentes.",
    choices: [
      c("ch_carcaca", "rastrear", {
        label: "Seguir as marcas de garras", durationMinutes: 25,
        outcome: {
          text: "Você segue as árvores marcadas, uma a uma.",
          check: { attr: "orientacao", base: 50 },
          success: { text: "As marcas sobem até a Trilha da crista e terminam numa toca sob as pedras. Lá dentro: uma caneca de lata, um cobertor, uma foto de família desbotada. [whispers] A fera tem uma casa.", effects: [{ op: "flag", key: "rastro_ambar" }, { op: "clue", key: "toca_ambar" }] },
          failure: { text: "As marcas somem. Você passa o resto da tarde com a sensação de estar sendo seguido pelo mesmo caminho que você fez.", effects: [{ op: "flag", key: "rastro_ambar" }, { op: "status", field: "stress", delta: 12 }] },
        },
      }),
      c("ch_carcaca", "sair", { label: "Sair dali antes que o dono volte", durationMinutes: 3, safe: true, outcome: { text: "Você se afasta rápido. Na volta, um uivo longo — em plena luz do dia.", effects: [{ op: "flag", key: "rastro_ambar" }, { op: "status", field: "stress", delta: 10 }] } }),
    ],
  },
  {
    id: "ch_ambar", title: "O Lobo de Âmbar", locationId: "trilha", priority: 63, repeatable: true,
    trigger: { night: true, flagsAll: ["rastro_ambar"], flagsNone: ["ambar_ferido", "ambar_caido", "ambar_alfa", "ambar_aliado"], cooldownMinutes: 120 },
    body: "[growls] Ele desce da crista sobre quatro patas e se levanta sobre duas. Mais alto que qualquer homem, pelo cinza-escuro, olhos de âmbar líquido. [pause] Traz no pescoço um pedaço de arame enferrujado, como uma coleira que ele mesmo não conseguiu tirar. [menacing] Ele não ataca ainda. Ele quer ver o que você vai fazer.",
    choices: [
      c("ch_ambar", "uivar", {
        label: "Uivar de volta e desafiar pela matilha", durationMinutes: 10, requirements: { lineage: ["werewolf"] },
        outcome: {
          text: "[growls] O uivo rasga a sua garganta. Os dois avançam ao mesmo tempo.",
          check: { attr: "forca", base: 45 },
          success: { text: "Você o derruba na pedra e fecha os dentes no pescoço dele — e para. Ele baixa as orelhas. [long pause] A matilha agora é sua.", effects: [{ op: "flag", key: "ambar_alfa" }, { op: "clue", key: "alfa_matilha" }, { op: "status", field: "stress", delta: -15 }] },
          failure: { text: "Ele é mais velho e mais forte. Joga você contra uma árvore e vai embora, sem pressa — dessa vez.", effects: [{ op: "wound", part: "torso", type: "laceracao", severity: 2 }, { op: "status", field: "stress", delta: 10 }] },
        },
      }),
      c("ch_ambar", "medalhao", {
        label: "Mostrar o medalhão da lua partida e dizer um nome", durationMinutes: 10, requirements: { cluesAny: ["marca_lunar", "toca_ambar"] },
        outcome: {
          text: "Você ergue o medalhão (ou a lembrança da foto na toca) e fala baixo.",
          check: { attr: "controle_emocional", base: 50 },
          success: { text: "[voice breaking] O corpo dele encolhe, dobra, geme. No lugar da fera, um velho nu, magro, chorando no chão frio. “Anselmo”, ele diz. “Eu era o mateiro. Eu vi quando enterraram a moça do rádio viva.” [sobbing]", effects: [{ op: "flag", key: "ambar_aliado" }, { op: "clue", key: "anselmo_mateiro" }, { op: "clue", key: "estrada_servico" }, { op: "revealLink", from: "trilha", to: "estacao" }] },
          failure: { text: "Ele olha para o medalhão com ódio e o arranca da sua mão com uma unha. [growls] Você não sabe se o ódio é de você ou de si mesmo.", effects: [{ op: "wound", part: "braco_dir", type: "corte", severity: 2 }] },
        },
      }),
      c("ch_ambar", "fogo", {
        label: "Brandir fogo e forçar a luta", durationMinutes: 10, requirements: { hasAnyItem: ["isqueiro", "fosforos"] },
        outcome: {
          text: "Você acende o que tem e avança gritando.",
          check: { attr: "forca", base: 40, itemBonus: { canivete: 10 } },
          success: { text: "[gasps] O pelo dele pega fogo no ombro. Ele uiva de dor e some pela crista, deixando um rastro de sangue escuro. Ferido. Furioso.", effects: [{ op: "flag", key: "ambar_ferido" }] },
          failure: { text: "Uma patada apaga a chama e abre o seu braço até o osso.", effects: [{ op: "wound", part: "braco_esq", type: "laceracao", severity: 3 }, { op: "status", field: "stress", delta: 15 }] },
        },
      }),
      c("ch_ambar", "baixar", {
        label: "Baixar os olhos e recuar devagar", durationMinutes: 10, safe: true,
        outcome: {
          text: "Você não encara. Não corre.",
          check: { attr: "controle_emocional", base: 45 },
          success: { text: "Ele fareja o ar por um longo tempo — e vira as costas. [whispers] Você foi julgado. Por hoje, absolvido.", effects: [{ op: "status", field: "stress", delta: 10 }] },
          failure: { text: "Seu corpo tremia demais. Ele cheirou o medo. Os dentes marcam o seu ombro — não para matar, para lembrar.", effects: [{ op: "lycanthropy" }] },
        },
      }),
    ],
  },
  {
    id: "ch_ambar_final", title: "A última caçada", locationId: "trilha", priority: 63, repeatable: true,
    trigger: { night: true, flagsAll: ["ambar_ferido"], flagsNone: ["ambar_caido", "ambar_aliado"], cooldownMinutes: 90 },
    body: "[breathing heavily] O rastro de sangue termina em você. Ele está ali, encostado na pedra, respirando rápido, o ombro queimado ainda fumegando. [pause] Os olhos de âmbar já não têm fúria. Têm cansaço. [whispers] Como se ele esperasse por isso há vinte e oito anos.",
    choices: [
      c("ch_ambar_final", "acabar", {
        label: "Acabar com isso", durationMinutes: 10,
        outcome: {
          text: "Você se aproxima.",
          check: { attr: "forca", base: 45, itemBonus: { canivete: 15 } },
          success: { text: "[long pause] Ele não se defende. No fim, o corpo no chão é de um velho magro, com uma coleira de arame no pescoço. No bolso da calça rasgada, um bilhete: “Tavares enterrou a moça do rádio viva. Eu vi. Eu não fiz nada.” [sad]", effects: [{ op: "flag", key: "ambar_caido" }, { op: "clue", key: "anselmo_mateiro" }, { op: "status", field: "stress", delta: 5 }] },
          failure: { text: "Ainda ferido, ele é mais rápido que você. Deixa você no chão com três cortes paralelos e desaparece.", effects: [{ op: "wound", part: "perna_dir", type: "laceracao", severity: 2 }] },
        },
      }),
      c("ch_ambar_final", "poupar", {
        label: "Abaixar a arma e perguntar o nome dele", durationMinutes: 10,
        outcome: {
          text: "“Quem é você?”",
          check: { attr: "comunicacao", base: 45 },
          success: { text: "[voice breaking] “Anselmo.” A fera encolhe até virar um velho. “Eu vi o Tavares enterrar a moça do rádio. Viva. E a lua me pegou naquela mesma noite, como castigo.” [crying] Ele aponta uma estrada de serviço que ninguém conhece.", effects: [{ op: "flag", key: "ambar_aliado" }, { op: "clue", key: "anselmo_mateiro" }, { op: "clue", key: "estrada_servico" }, { op: "revealLink", from: "trilha", to: "estacao" }] },
          failure: { text: "Ele rosna e se arrasta para longe. Não confia em ninguém — ainda.", effects: [{ op: "status", field: "stress", delta: 8 }] },
        },
      }),
      c("ch_ambar_final", "recuar", { label: "Deixá-lo ali e ir embora", durationMinutes: 5, safe: true, outcome: { text: "[sighs] Você vira as costas. Atrás de você, um uivo baixo — quase um agradecimento. Ou uma promessa.", effects: [{ op: "status", field: "stress", delta: 6 }] } }),
    ],
  },
  {
    id: "ch_lua_cheia", title: "Lua cheia sobre a crista", locationId: "trilha", priority: 62, repeatable: true,
    trigger: { night: true, flagsAll: ["ambar_alfa", "tavares_resolvido"], flagsAny: ["iara_em_paz", "iara_furia"], lineageAny: ["werewolf"], minMinute: 1440, cooldownMinutes: 240 },
    body: "[growls] A matilha espera na crista, olhos acesos no escuro. Lá embaixo, bem longe, o som de um helicóptero procurando alguém que já não existe. [pause] O vento traz o cheiro de tudo o que está vivo no vale. [whispers] Tudo isso pode ser seu território.",
    choices: [
      c("ch_lua_cheia", "ficar", { label: "Ficar com a matilha para sempre", durationMinutes: 5, outcome: { text: "[growls] Você uiva. A matilha responde. O helicóptero vai embora.", effects: [{ op: "end", ending: "rei_da_mata" }] } }),
      c("ch_lua_cheia", "voltar", { label: "Ainda não — há gente para salvar", durationMinutes: 2, safe: true, outcome: { text: "[sighs] Você desce da crista. A matilha espera. Ela sabe esperar.", effects: [{ op: "status", field: "stress", delta: 5 }] } }),
    ],
  },

  // ════════════════════ 3. TAVARES, O DONO DA CARGA ════════════════════
  {
    id: "ch_tavares", title: "O dono da carga", locationId: "ponte", priority: 61, repeatable: true,
    // Ato II: só depois que o grupo transformado se reencontrou (content/atos.ts).
    trigger: { cluesAny: ["donos_carga", "carga_ravina"], minMinute: 900, flagsAll: ["encontro_feito"], flagsNone: ["tavares_resolvido"], cooldownMinutes: 180 },
    body: "[calm] Ele está sentado na mureta da ponte, fumando, como se esperasse um ônibus. Uns sessenta anos, chapéu de couro, a espingarda atravessada no colo. O capanga das botas de borracha está atrás de você — [pause] você nem ouviu ele chegar. [chuckles] “Tavares”, ele se apresenta. “Você tem uma coisa que é minha. E eu tenho a única estrada que sai daqui.”",
    choices: [
      c("ch_tavares", "negociar", {
        label: "Negociar: a carga pela saída", durationMinutes: 15,
        outcome: {
          text: "Você fala devagar, sem olhar para a espingarda.",
          effects: [{ op: "flag", key: "tavares_presente" }],
          check: { attr: "comunicacao", base: 45 },
          success: { text: "[sarcastic] Ele ri. “Gente da cidade negocia bonito.” Mas escuta. E, distraído, fala demais: “A moça do rádio também quis negociar, em 98.” [pause] Ele percebe o que disse. O sorriso fica. Os olhos, não.", effects: [{ op: "clue", key: "tavares_confessa" }, { op: "status", field: "stress", delta: 8 }] },
          failure: { text: "“Chega de conversa.” A coronha acerta seu estômago. Você cai de joelhos na ponte. [dark laugh] “Pensa melhor. Eu espero aqui.”", effects: [{ op: "wound", part: "torso", type: "contusao", severity: 2 }] },
        },
      }),
      c("ch_tavares", "emboscada", {
        label: "Derrubar o capanga e tomar a espingarda", durationMinutes: 10,
        outcome: {
          text: "Você gira e se joga contra o homem das botas.",
          check: { attr: "agilidade", base: 40 },
          success: { text: "[gasps] Os dois caem da ponte para dentro do córrego gelado. Quando você sobe, a espingarda está na sua mão e Tavares está de mãos para cima, [nervous] pela primeira vez sem sorrir.", effects: [{ op: "flag", key: "tavares_resolvido" }, { op: "flag", key: "tavares_rendido" }, { op: "wet", amount: 70 }, { op: "status", field: "stress", delta: 10 }] },
          failure: { text: "Um tiro para o alto — depois um para baixo. Chumbo rasga a sua coxa. Você cai no córrego e a correnteza leva você para longe da ponte.", effects: [{ op: "wound", part: "perna_esq", type: "laceracao", severity: 3 }, { op: "wet", amount: 80 }, { op: "flag", key: "donos_alerta" }] },
        },
      }),
      c("ch_tavares", "dentes", {
        label: "Deixar ele ver o que você se tornou", durationMinutes: 5, requirements: { lineage: ["vampire", "werewolf"] },
        outcome: {
          text: "[menacing] Você sorri. E deixa o sorriso crescer.",
          check: { attr: "comunicacao", base: 40 },
          success: { text: "[terrified] O cigarro cai da boca dele. O capanga corre pela estrada sem olhar para trás. Tavares fica — paralisado, mãos tremendo sobre a espingarda que ele não consegue levantar. [whispers] “Eu sabia… eu sabia que o vale ia cobrar.”", effects: [{ op: "flag", key: "tavares_resolvido" }, { op: "flag", key: "tavares_rendido" }, { op: "clue", key: "tavares_confessa" }] },
          failure: { text: "Ele atira antes de pensar. O chumbo arde — mas você continua de pé. Ele foge, e você deixa.", effects: [{ op: "wound", part: "torso", type: "laceracao", severity: 1 }, { op: "flag", key: "tavares_resolvido" }] },
        },
      }),
      c("ch_tavares", "iara_fala", {
        label: "Deixar Iara falar pela sua boca", durationMinutes: 5, requirements: { lineage: ["haunted"] },
        outcome: {
          text: "[haunting] O frio sobe pela sua garganta. A voz que sai não é a sua. [whispers] “Sete… quatro… zero, Tavares.”",
          effects: [{ op: "flag", key: "tavares_resolvido" }, { op: "flag", key: "tavares_rendido" }, { op: "clue", key: "tavares_confessa" }, { op: "status", field: "stress", delta: 10 }],
        },
      }),
      c("ch_tavares", "recuar", { label: "Levantar as mãos e sair devagar", durationMinutes: 5, safe: true, outcome: { text: "[chuckles] “Vai, vai. O vale é pequeno.” Ele acende outro cigarro. Você sente o olhar dele nas costas até a mata fechar.", effects: [{ op: "flag", key: "tavares_presente" }, { op: "status", field: "stress", delta: 12 }] } }),
    ],
  },

  // ════════════════════ 4. IARA, A VOZ ════════════════════
  {
    id: "ch_iara_sinal", title: "23h40 em ponto", locationId: null, priority: 59, repeatable: false,
    trigger: { anyLocation: true, night: true, minMinute: 1440, flagsAll: ["tavares_resolvido"], cluesAny: ["cova_iara", "bolsa_iara", "iara_visao", "voz_gravada", "diario_iara"] },
    body: "[long pause] Todos os sons do vale param ao mesmo tempo. Grilos, vento, água. [pause] Seu relógio marca 23h40. Ao longe, na direção da antena, a lâmpada vermelha acende sozinha — e começa a piscar em três tempos. [whispers] Sete. Quatro. Zero. [ominous] Ela está chamando você para a estação.",
    choices: [
      c("ch_iara_sinal", "ir", { label: "Responder ao chamado", durationMinutes: 2, outcome: { text: "Você não sabe por quê, mas diz em voz alta: “Estou indo.” [whispers] A lâmpada para de piscar.", effects: [{ op: "flag", key: "iara_chamou" }, { op: "status", field: "stress", delta: 8 }] } }),
      c("ch_iara_sinal", "calar", { label: "Ficar em silêncio e esperar o som voltar", durationMinutes: 10, safe: true, outcome: { text: "Os grilos voltam, um a um. Mas a lâmpada continua acesa até o amanhecer.", effects: [{ op: "flag", key: "iara_chamou" }, { op: "status", field: "stress", delta: 12 }] } }),
    ],
  },
  {
    id: "ch_iara", title: "Iara, a Voz", locationId: "estacao", priority: 66, repeatable: true,
    trigger: { night: true, flagsAll: ["iara_chamou", "estacao_aberta"], flagsNone: ["iara_em_paz", "iara_furia"], cooldownMinutes: 180 },
    body: "[haunting] O lampião apaga. A névoa entra por baixo da porta e sobe até o teto. O rádio liga sozinho, sem bateria, [whispers] e a voz de mulher conta: “sete… quatro… zero…” [long pause] Então ela está ali, atrás da bancada. Capa de chuva encharcada, prancheta na mão, terra sob as unhas. [cold] Ela olha para você e pergunta, com a sua própria voz: “Você veio me tirar daqui… ou me calar?”",
    choices: [
      c("ch_iara", "prometer", {
        label: "Prometer que o mundo vai saber o que fizeram com ela", durationMinutes: 15, requirements: { cluesAny: ["desvio_rota", "rumo_074", "tavares_confessa", "anselmo_mateiro", "iara_desaparecida"] },
        outcome: {
          text: "Você conta tudo o que sabe. O rumo 074. A carga. O nome de quem a enterrou.",
          check: { attr: "controle_emocional", base: 45 },
          success: { text: "[voice breaking] A névoa fica imóvel. [long pause] Ela abaixa a prancheta. “Vinte e oito anos contando para ninguém.” [crying] “Liga o rádio. Eu dou a frequência certa — a da polícia, não a deles.” E some, deixando na bancada uma fita cassete escrita à mão: PROVAS.", effects: [{ op: "flag", key: "iara_em_paz" }, { op: "clue", key: "iara_revela" }, { op: "status", field: "stress", delta: -25 }] },
          failure: { text: "Sua voz falha no meio. Ela inclina a cabeça, decepcionada. [whispers] “Todo mundo promete.” O frio atravessa você e ela se desfaz — por enquanto.", effects: [{ op: "haunt" }] },
        },
      }),
      c("ch_iara", "ouvir", {
        label: "Deixar os mortos falarem — escutar tudo", durationMinutes: 20, requirements: { lineage: ["haunted"] },
        outcome: {
          text: "[whispers] Você não pergunta nada. Só abre espaço dentro de você para ela entrar.",
          effects: [{ op: "flag", key: "iara_em_paz" }, { op: "clue", key: "iara_revela" }, { op: "clue", key: "tavares_confessa" }, { op: "status", field: "stress", delta: -30 }],
          check: { attr: "percepcao", base: 30 },
          success: { text: "Você vê a noite de 1998 pelos olhos dela: o avião pousando sem luzes, Tavares com a pá, Anselmo escondido entre as árvores sem coragem de gritar. [sobbing] Quando acaba, ela sorri pela primeira vez. [relieved] “Obrigada por me ouvir até o fim.”" },
          failure: { text: "As imagens vêm rápidas demais. Você entende o essencial — e ela, pelo menos, descansa." },
        },
      }),
      c("ch_iara", "desligar", {
        label: "Arrancar os fios do rádio e calar a voz", durationMinutes: 5,
        outcome: {
          text: "[desperate] Você agarra o feixe de fios e puxa com toda a força.",
          check: { attr: "forca", base: 45 },
          success: { text: "Faíscas. Silêncio. [long pause] A névoa sai pela porta como quem vai embora ofendida. [whispers] Lá fora, muito longe, alguém grita — um grito de homem. [ominous] Ela foi procurar outro ouvinte: quem a enterrou.", effects: [{ op: "flag", key: "iara_furia" }, { op: "clue", key: "iara_furia" }, { op: "status", field: "stress", delta: 10 }] },
          failure: { text: "[terrified] Os fios estão frios como gelo. Suas mãos grudam neles. A voz entra pelos seus dedos e sobe até a sua boca. Você começa a contar junto com ela.", effects: [{ op: "haunt" }, { op: "haunt" }, { op: "status", field: "bodyTemp", delta: -1 }] },
        },
      }),
      c("ch_iara", "fugir", {
        label: "Fugir da estação", durationMinutes: 10, safe: true,
        outcome: { text: "Você corre. A voz corre junto, sempre um passo atrás, [whispers] contando até você não aguentar mais ouvir.", effects: [{ op: "haunt" }, { op: "status", field: "stress", delta: 10 }] },
      }),
    ],
  },
  {
    id: "ch_iara_furia", title: "O que a névoa fez", locationId: "ponte", priority: 60, repeatable: false,
    trigger: { flagsAll: ["iara_furia"] },
    body: "[tense] O quadriciclo está tombado no meio da ponte, o farol ainda aceso apontando para a água. A espingarda boia no córrego. [long pause] Não há ninguém. Só pegadas de botas indo até a beira — e nenhuma voltando. [whispers] Na mureta, escrito com o dedo na lama: 740.",
    choices: [
      c("ch_iara_furia", "revistar", { label: "Revistar o quadriciclo", durationMinutes: 10, outcome: { text: "No baú: a chave de uma porteira, um mapa da estrada de serviço e um maço de dinheiro que ninguém vai vir buscar.", effects: [{ op: "flag", key: "tavares_resolvido" }, { op: "clue", key: "estrada_servico" }, { op: "addItem", item: "fosforos" }] } }),
      c("ch_iara_furia", "sair", { label: "Não tocar em nada e ir embora", durationMinutes: 2, safe: true, outcome: { text: "Você passa longe da água. Ela está calma demais.", effects: [{ op: "flag", key: "tavares_resolvido" }, { op: "status", field: "stress", delta: 10 }] } }),
    ],
  },
];

export const BOSS_CLUES: ClueDef[] = [
  { key: "ninho_mae", title: "A mãe de todas", text: "Sob o poço escuro dorme a criatura que gerou as outras. As mordidas são dela." },
  { key: "mae_caida", title: "O poço em silêncio", text: "A Mãe das Asas caiu. As mordidas que ainda não tinham virado sangue secaram." },
  { key: "pacto_sangue", title: "Filho da noite", text: "Você bebeu e foi bebido pela Mãe das Asas. O vale a oferece a você quando a lua cair." },
  { key: "toca_ambar", title: "A toca na crista", text: "A fera do uivo tem cobertor, caneca e foto de família. Ela já foi gente." },
  { key: "anselmo_mateiro", title: "Anselmo", text: "O Lobo de Âmbar é Anselmo, o mateiro. Ele viu Tavares enterrar Iara viva em 1998 e não fez nada." },
  { key: "alfa_matilha", title: "Alfa", text: "Você venceu o Lobo de Âmbar pela liderança. A matilha da crista é sua." },
  { key: "estrada_servico", title: "A estrada de serviço", text: "Uma estrada de terra liga a crista à estação e desce até a ponte. É por ela que a carga sai." },
  { key: "tavares_confessa", title: "“Em 98”", text: "Tavares deixou escapar: Iara Menezes quis negociar com ele em 1998." },
  { key: "iara_revela", title: "A fita PROVAS", text: "Iara deixou uma fita com a frequência da polícia e 28 anos de gravações dos pousos clandestinos." },
  { key: "iara_furia", title: "740 na lama", text: "Você calou o rádio. Iara foi atrás de quem a enterrou." },
];

export const BOSS_ENDINGS: EndingDef[] = [
  { key: "senhor_da_noite", type: "victory", title: "Senhor da noite", text: "[dark laugh] O helicóptero volta três vezes e desiste. O relatório diz “sem sobreviventes”. [pause] No vale, às 23h40, as asas agora respondem a outra voz. [whispers] A sua." },
  { key: "rei_da_mata", type: "victory", title: "Rei da mata", text: "[growls] Anos depois, mateiros da região contam sobre uma fera de olhos de âmbar que guarda a crista do Vale Silente. [pause] Dizem que ela nunca ataca os perdidos. [whispers] Só quem vem buscar a carga." },
];

export const BOSS_NPCS: NpcDef[] = [
  {
    id: "tavares", name: "Tavares", locationId: "ponte", presentFlag: "tavares_presente", goneFlag: "tavares_resolvido",
    persona: "Contrabandista de uns 60 anos, chapéu de couro, espingarda no colo, sempre fumando. Calmo, educado de um jeito ameaçador, ri de tudo. Controla a pista clandestina do vale desde os anos 90 e a estrada de serviço que é a única saída por terra. Em 1998 enterrou viva a hidróloga Iara Menezes, que tinha visto os pousos — nunca admite isso diretamente, mas às vezes escorrega ao falar “da moça do rádio”. Quer a carga do avião e quer saber quem mais sabe. Tem um medo supersticioso do vale à noite, das asas e do uivo, e fica nervoso quando alguém repete os números 7-4-0. Nunca ameaça com números nem descreve violência explícita.",
    intents: ["perguntar_acidente", "perguntar_caminho", "perguntar_numeros", "ameacar", "acalmar", "oferecer_item", "outro"],
  },
  {
    id: "anselmo", name: "Anselmo, o mateiro", locationId: "trilha", presentFlag: "ambar_aliado", goneFlag: "ambar_caido",
    persona: "Velho mateiro magro, nu sob um cobertor, com uma coleira de arame enferrujado no pescoço. É o Lobo de Âmbar: a licantropia o pegou na mesma noite de 1998 em que ele viu Tavares enterrar Iara viva e não teve coragem de gritar. Culpado, cansado, fala manso e com sotaque do interior. Conhece cada trilha, a estrada de serviço e as armadilhas. Tem medo de machucar alguém quando a lua sobe e pede que ninguém fique perto dele à noite. Quer que a verdade sobre Iara apareça, mas não se acha digno de contar.",
    intents: ["perguntar_acidente", "perguntar_caminho", "perguntar_numeros", "pedir_ajuda", "acalmar", "ameacar", "outro"],
  },
  {
    id: "iara", name: "Iara Menezes", locationId: "rochedo", presentFlag: "iara_em_paz", goneFlag: "iara_furia",
    persona: "Alma da hidróloga Iara Menezes, morta em 1998, agora em paz. Capa de chuva, prancheta, voz baixa e gentil, às vezes fala no presente como se ainda fosse 1998. Mediu o rio por meses, anotou os pousos noturnos no rumo 074 e gravou tudo numa fita. Foi enterrada viva por Tavares; Anselmo viu e não fez nada — ela já o perdoou. Não sente raiva, só pressa de que a verdade chegue ao rádio. Fala de forma poética e curta sobre água, frio e números. Nunca descreve a própria morte em detalhes.",
    intents: ["perguntar_acidente", "perguntar_caminho", "perguntar_numeros", "acalmar", "pedir_ajuda", "outro"],
  },
];

export const BOSS_NPC_RULES: Record<string, Record<string, NpcRule>> = {
  tavares: {
    perguntar_acidente: {
      text: "Você pergunta sobre a carga do avião.",
      check: { attr: "comunicacao", base: 40 },
      success: { text: "Ele dá uma tragada longa. “Carga é carga. O Brandão sabia o preço. A moça do rádio também sabia, em 98.”", effects: [{ op: "clue", key: "tavares_confessa" }] },
      failure: { text: "“Pergunta demais pra quem está perdido.”", effects: [{ op: "status", field: "stress", delta: 5 }] },
    },
    perguntar_caminho: { text: "Você pergunta como sair do vale.", effects: [{ op: "clue", key: "estrada_servico" }, { op: "status", field: "stress", delta: 4 }] },
    perguntar_numeros: { text: "Você diz: sete, quatro, zero.", effects: [{ op: "status", field: "stress", delta: -4 }] },
    ameacar: {
      text: "Você o ameaça.",
      check: { attr: "comunicacao", base: 35 },
      success: { text: "Ele ri, mas levanta da mureta e se afasta da ponte.", effects: [{ op: "flag", key: "tavares_resolvido" }] },
      failure: { text: "A espingarda sobe meio palmo. Você entende o recado.", effects: [{ op: "status", field: "stress", delta: 12 }] },
    },
    acalmar: { text: "Você tenta baixar a tensão.", effects: [{ op: "status", field: "stress", delta: -3 }] },
    oferecer_item: { text: "Você oferece algo.", requirements: { hasAnyCategory: ["comida", "agua"] }, blockedText: "“Guarda. Vai precisar.”", effects: [{ op: "consumeAny", categories: ["comida", "agua"] }] },
    outro: { text: "Ele só sorri e fuma.", effects: [] },
  },
  anselmo: {
    perguntar_acidente: { text: "Você pergunta o que ele viu em 1998.", effects: [{ op: "clue", key: "anselmo_mateiro" }, { op: "status", field: "stress", delta: 6 }] },
    perguntar_caminho: { text: "Você pergunta pela saída.", effects: [{ op: "clue", key: "estrada_servico" }, { op: "revealLink", from: "trilha", to: "estacao" }] },
    perguntar_numeros: { text: "Você pergunta sobre os números.", effects: [{ op: "clue", key: "rumo_074" }] },
    pedir_ajuda: { text: "Você pede ajuda.", effects: [{ op: "addItem", item: "galhos_secos" }] },
    acalmar: { text: "Você diz que não é culpa dele.", effects: [{ op: "status", field: "stress", delta: -8 }] },
    ameacar: { text: "Você o ameaça.", effects: [{ op: "flag", key: "ambar_caido" }, { op: "status", field: "stress", delta: 10 }] },
    outro: { text: "Ele olha para a lua e não responde.", effects: [] },
  },
  iara: {
    perguntar_acidente: { text: "Você pergunta o que aconteceu com ela.", effects: [{ op: "clue", key: "iara_desaparecida" }, { op: "status", field: "stress", delta: 4 }] },
    perguntar_caminho: { text: "Você pergunta como sair.", effects: [{ op: "reveal", location: "rochedo" }, { op: "flag", key: "busca_ativa" }] },
    perguntar_numeros: { text: "Você pergunta sobre os números.", effects: [{ op: "clue", key: "rumo_074" }] },
    acalmar: { text: "Você diz que ela pode descansar.", effects: [{ op: "status", field: "stress", delta: -12 }] },
    pedir_ajuda: { text: "Você pede ajuda.", effects: [{ op: "status", field: "bodyTemp", delta: 0.5 }] },
    outro: { text: "Ela olha para o rio e sorri.", effects: [] },
  },
};
