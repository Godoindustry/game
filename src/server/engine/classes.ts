/**
 * Classes (clãs, tribos, ordens e credos) — escolhidas DEPOIS que o personagem desperta a linhagem.
 *
 * Inspiradas na estrutura de RPGs de horror gótico (disciplinas, perdição, compulsão), mas com
 * nomes, poderes e textos ORIGINAIS, nascidos da história do Vale Silente.
 *
 * Cada classe tem:
 *  - 3 disciplinas: 1 passiva (bônus permanente em atributos) + 2 ativas (ação "usar_poder");
 *  - perdição: uma fraqueza permanente (penalidade em atributos) com a sua história;
 *  - compulsão: quando o recurso da linhagem (Fome, Fúria, Eco, Obsessão) chega ao máximo,
 *    o sangue cobra — efeitos automáticos e o recurso volta a um nível mais baixo.
 */
import type { AttributeKey, Effect } from "./types";
import type { LineageKey } from "./lineage";

export const RESOURCE_MAX = 5;
/** Depois da compulsão, o recurso cai para cá. */
export const RESOURCE_AFTER_COMPULSION = 3;

export const RESOURCE_NAME: Record<Exclude<LineageKey, "human">, string> = {
  vampire: "Fome",
  werewolf: "Fúria",
  haunted: "Eco",
  hunter: "Obsessão",
};

export interface PowerDef {
  id: string;
  name: string;
  description: string;
  /** Quanto o recurso sobe ao usar. */
  cost: number;
  minutes: number;
  onlyNight?: boolean;
  effects: Effect[];
  text: string;
}

export interface ClassDef {
  id: string;
  lineage: Exclude<LineageKey, "human">;
  name: string;
  epithets: string;
  description: string;
  passive: { name: string; description: string; bonus: Partial<Record<AttributeKey, number>> };
  powers: [PowerDef, PowerDef];
  bane: { name: string; description: string; penalty: Partial<Record<AttributeKey, number>> };
  compulsion: { name: string; description: string; text: string; effects: Effect[] };
}

const buff = (attr: AttributeKey, bonus: number, minutes: number): Effect => ({ op: "buff", attr, bonus, minutes });

export const CLASSES: ClassDef[] = [
  // ═══════════════════ VAMPIROS — os clãs do sangue da Mãe ═══════════════════
  {
    id: "filhos_do_poco", lineage: "vampire", name: "Filhos do Poço",
    epithets: "Os Afogados, Silenciosos, Crias da Mãe",
    description: "Os primeiros que a Mãe das Asas bebeu e devolveu. Herdaram o silêncio da água parada: movem-se sem som, curam-se com o próprio sangue e enxergam no escuro como quem olha o fundo de um poço.",
    passive: { name: "Véu da Névoa", description: "A névoa se agarra a você. +15% em furtividade.", bonus: { furtividade: 15 } },
    powers: [
      { id: "sangue_que_fecha", name: "Sangue que Fecha", description: "O próprio sangue estanca as feridas.", cost: 2, minutes: 10, effects: [{ op: "healWounds" }, { op: "health", delta: 8 }], text: "[whispers] Você passa o dedo sobre a ferida. O sangue escuro para de correr — e a pele se fecha, fria como água de poço." },
      { id: "olhar_de_poco", name: "Olhar de Poço", description: "Por 2h, +20% em percepção.", cost: 1, minutes: 5, effects: [buff("percepcao", 20, 120)], text: "Suas pupilas se abrem até engolir a íris. O escuro fica cinza, depois claro." },
    ],
    bane: { name: "Sede de Água Parada", description: "O sangue da Mãe puxa você para a água. −10% em orientação: todo caminho parece levar ao poço.", penalty: { orientacao: -10 } },
    compulsion: { name: "Mergulho", description: "Com a Fome no máximo, você precisa submergir.", text: "[breathing heavily] A Fome vira um puxão no peito. Você só volta a si com a água até o pescoço, gelado, sem lembrar do caminho.", effects: [{ op: "wet", amount: 45 }, { op: "status", field: "stress", delta: 12 }] },
  },
  {
    id: "corte_da_crista", lineage: "vampire", name: "Corte da Crista",
    epithets: "Os Coroados, Senhores, Donos da Noite",
    description: "Aristocratas do sangue. Acreditam que o vale inteiro — homens, feras e mortos — deveria se ajoelhar. Sua voz dobra vontades e sua pele endurece como pedra da crista.",
    passive: { name: "Voz de Comando", description: "Falam e os outros obedecem. +15% em comunicação e +10% em controle emocional.", bonus: { comunicacao: 15, controle_emocional: 10 } },
    powers: [
      { id: "presenca_fria", name: "Presença Fria", description: "Por 3h, as criaturas da noite não se aproximam.", cost: 2, minutes: 5, onlyNight: true, effects: [{ op: "ward", minutes: 180 }], text: "[menacing] Você endireita as costas e olha para o escuro como quem olha para servos. As asas, lá em cima, param de bater." },
      { id: "pele_de_marmore", name: "Pele de Mármore", description: "Por 3h, +20% em resistência.", cost: 1, minutes: 5, effects: [buff("resistencia", 20, 180)], text: "Sua pele fica fria e dura como a pedra do marco. A dor chega abafada, de longe." },
    ],
    bane: { name: "Paladar de Rei", description: "Só o sangue certo sacia. Caçar bichos alivia menos a Fome, e o desprezo por trabalho braçal pesa: −10% em improviso.", penalty: { improviso: -10 } },
    compulsion: { name: "Domínio", description: "Com a Fome no máximo, você precisa mandar em alguém ou em algo.", text: "[cold] Você passa uma hora dando ordens ao vento, às árvores, a quem estiver perto. Ninguém obedece. Isso dói mais que a fome.", effects: [{ op: "status", field: "stress", delta: 15 }, { op: "status", field: "energy", delta: -8 }] },
  },
  {
    id: "rasgados", lineage: "vampire", name: "Os Rasgados",
    epithets: "Andrajos, Ratos da Ravina, Cicatrizes",
    description: "O sangue da Mãe não os aceitou inteiros: saíram tortos, marcados, com rostos que assustam os vivos. Vivem nas frestas, sabem de tudo e somem quando querem.",
    passive: { name: "Olhos de Rato", description: "Nada escapa. +15% em percepção e +5% em furtividade.", bonus: { percepcao: 15, furtividade: 5 } },
    powers: [
      { id: "sumir", name: "Sumir", description: "Por 3h, +25% em furtividade.", cost: 1, minutes: 5, effects: [buff("furtividade", 25, 180)], text: "[whispers] Você se encolhe numa sombra que não deveria caber ninguém. E cabe." },
      { id: "forca_do_tumulo", name: "Força do Túmulo", description: "Por 1h, +25% em força.", cost: 2, minutes: 5, effects: [buff("forca", 25, 60)], text: "Os ossos estalam e se ajeitam. Seus braços ficam pesados de uma força que não é sua." },
    ],
    bane: { name: "Rosto Partido", description: "A transformação deformou você. −20% em comunicação: os vivos desviam o olhar.", penalty: { comunicacao: -20 } },
    compulsion: { name: "Fome de Segredos", description: "Com a Fome no máximo, você precisa saber o que ninguém sabe.", text: "[nervous] Você revira tudo ao redor — bolsos, pedras, cascas de árvore — atrás de um segredo. Não acha. A mão não para de tremer.", effects: [{ op: "status", field: "stress", delta: 14 }, { op: "status", field: "fatigue", delta: 8 }] },
  },
  {
    id: "febris", lineage: "vampire", name: "Os Febris",
    epithets: "Os Lúcidos, Os da Lua Torta, Profetas",
    description: "O sangue da Mãe chegou a eles junto com uma febre que nunca passou. Veem o que foi e o que vai ser — e às vezes o que nunca existiu. Dizem que são loucos. Às vezes estão certos.",
    passive: { name: "Segunda Visão", description: "Enxergam por trás das coisas. +15% em inteligência e +10% em percepção.", bonus: { inteligencia: 15, percepcao: 10 } },
    powers: [
      { id: "pressagio", name: "Presságio", description: "Uma visão revela caminhos escondidos do vale.", cost: 2, minutes: 15, effects: [{ op: "reveal", location: "rochedo" }, { op: "revealLink", from: "trilha", to: "estacao" }, { op: "status", field: "stress", delta: 5 }], text: "[haunting] Você fecha os olhos e vê o vale de cima, como um pássaro: a crista, a antena, um rochedo a sudeste com uma caixa esperando." },
      { id: "sussurro_na_mente", name: "Sussurro na Mente", description: "Por 2h, +20% em comunicação.", cost: 1, minutes: 5, effects: [buff("comunicacao", 20, 120)], text: "[whispers] Você fala e, ao mesmo tempo, fala por dentro da cabeça de quem ouve." },
    ],
    bane: { name: "Mente Rachada", description: "A febre nunca passa. −15% em controle emocional.", penalty: { controle_emocional: -15 } },
    compulsion: { name: "Delírio", description: "Com a Fome no máximo, a febre mostra coisas.", text: "[laughs nervously] Por uma hora você conversa com Iara, com o piloto, com você mesmo de amanhã. Ninguém mais vê ninguém.", effects: [{ op: "status", field: "stress", delta: 18 }] },
  },

  // ═══════════════════ LOBISOMENS — as tribos da crista ═══════════════════
  {
    id: "uivo_da_crista", lineage: "werewolf", name: "Uivo da Crista",
    epithets: "Guardiões, Matilha de Anselmo, Sentinelas",
    description: "Guardam o vale como quem guarda a própria casa. Sentem cada passo na mata pelo chão e pelo vento — e não perdoam quem traz o mal para dentro dele.",
    passive: { name: "Faro", description: "O vento conta tudo. +15% em orientação e +10% em percepção.", bonus: { orientacao: 15, percepcao: 10 } },
    powers: [
      { id: "pele_grossa", name: "Pele Grossa", description: "Por 3h, +20% em resistência e o frio recua.", cost: 1, minutes: 5, effects: [buff("resistencia", 20, 180), { op: "status", field: "bodyTemp", delta: 0.8 }], text: "[growls] Pelos grossos brotam nos braços e no pescoço. O vento para de cortar." },
      { id: "garra", name: "Garra", description: "Por 1h, +25% em força.", cost: 2, minutes: 5, onlyNight: true, effects: [buff("forca", 25, 60)], text: "As unhas escurecem e crescem. Cada dedo vira uma faca." },
    ],
    bane: { name: "Lua no Sangue", description: "A fera fala primeiro. −10% em comunicação.", penalty: { comunicacao: -10 } },
    compulsion: { name: "Território", description: "Com a Fúria no máximo, você precisa marcar e defender.", text: "[growls] Você passa a noite rondando, marcando árvores, rosnando para sombras. Quando para, as pernas tremem.", effects: [{ op: "status", field: "energy", delta: -15 }, { op: "status", field: "stress", delta: 8 }] },
  },
  {
    id: "dentes_de_ferro", lineage: "werewolf", name: "Dentes de Ferro",
    epithets: "Caçadores de Homens, Os do Diesel, Vingadores",
    description: "A tribo que odeia o que o homem fez ao vale: o diesel no córrego, os aviões sem luz, as covas na mata. Rasgam metal com os dentes e correm mais que o vento.",
    passive: { name: "Cheiro de Diesel", description: "Sentem a presença humana de longe. +15% em percepção e +10% em conhecimento técnico.", bonus: { percepcao: 15, conhecimento_tecnico: 10 } },
    powers: [
      { id: "rasgar_metal", name: "Rasgar Metal", description: "Por 1h, +20% em força e +15% em improviso.", cost: 2, minutes: 5, effects: [buff("forca", 20, 60), buff("improviso", 15, 60)], text: "[growls] Seus dentes rangem como engrenagem. Cadeados, cercas, portas — tudo parece papel." },
      { id: "correr_com_o_vento", name: "Correr com o Vento", description: "Por 2h, +25% em agilidade.", cost: 1, minutes: 5, effects: [buff("agilidade", 25, 120)], text: "Você cai sobre quatro patas sem perceber. O mundo passa borrado." },
    ],
    bane: { name: "Ódio", description: "Raiva de tudo que é humano. −15% em controle emocional.", penalty: { controle_emocional: -15 } },
    compulsion: { name: "Fúria Cega", description: "Com a Fúria no máximo, você ataca o que estiver perto.", text: "[growls] Você acorda do transe com as mãos sangrando e uma árvore rasgada à sua frente. Não lembra de nada.", effects: [{ op: "health", delta: -4 }, { op: "status", field: "stress", delta: 12 }] },
  },
  {
    id: "filhos_da_queixada", lineage: "werewolf", name: "Filhos da Queixada",
    epithets: "O Bando, Porcos-do-Mato, Sobreviventes",
    description: "A tribo mais antiga e mais prática: sobreviver primeiro, o resto depois. Comem de tudo, aguentam tudo e nunca andam sozinhos.",
    passive: { name: "Estômago de Fera", description: "O corpo aguenta o que o vale oferece. +15% em resistência e +5% em improviso.", bonus: { resistencia: 15, improviso: 5 } },
    powers: [
      { id: "farejar_comida", name: "Farejar Comida", description: "Acha raízes, frutos e água limpa: alivia fome e sede.", cost: 1, minutes: 30, effects: [{ op: "status", field: "hunger", delta: -30 }, { op: "status", field: "thirst", delta: -20 }], text: "Você fuça a terra com as mãos e com o nariz. Raízes doces, uma mina d'água escondida sob as folhas." },
      { id: "chamado_do_bando", name: "Chamado do Bando", description: "Por 3h, as criaturas da noite mantêm distância.", cost: 2, minutes: 5, effects: [{ op: "ward", minutes: 180 }], text: "[growls] Você bate os dentes três vezes. Da mata, dezenas de dentes respondem. As asas vão caçar em outro lugar." },
    ],
    bane: { name: "Fome sem Fim", description: "O corpo de fera queima tudo. −10% em inteligência (a fome distrai).", penalty: { inteligencia: -10 } },
    compulsion: { name: "Devorar", description: "Com a Fúria no máximo, a fome vira urgência.", text: "[breathing heavily] Você come o que encontra no chão — folhas, larvas, casca. A fome passa. A náusea, não.", effects: [{ op: "status", field: "hunger", delta: 10 }, { op: "infection", delta: 6 }, { op: "status", field: "stress", delta: 6 }] },
  },

  // ═══════════════════ ASSOMBRADOS — as ordens dos que ouvem os mortos ═══════════════════
  {
    id: "carpideiras", lineage: "haunted", name: "Carpideiras",
    epithets: "As Choronas, Vozes do Velório, Mães de Ninguém",
    description: "Choram pelos mortos que ninguém chorou. O choro acalma as almas — e às vezes os vivos. Carregam o luto como quem carrega água.",
    passive: { name: "Lamento", description: "Já choraram tudo. +15% em controle emocional.", bonus: { controle_emocional: 15 } },
    powers: [
      { id: "chorar_pelos_mortos", name: "Chorar pelos Mortos", description: "Alivia o estresse e fecha feridas leves.", cost: 1, minutes: 20, effects: [{ op: "status", field: "stress", delta: -30 }, { op: "health", delta: 5 }], text: "[sobbing] Você chora por todos que o vale engoliu. Quando acaba, o peito está leve — e alguém, no escuro, agradece." },
      { id: "ouvir_a_cova", name: "Ouvir a Cova", description: "Por 2h, +20% em percepção: os mortos apontam o que está escondido.", cost: 2, minutes: 10, effects: [buff("percepcao", 20, 120)], text: "[whispers] Você encosta o ouvido no chão. Lá embaixo, alguém sussurra onde procurar." },
    ],
    bane: { name: "Luto", description: "O peso de tantos mortos. −10% em agilidade.", penalty: { agilidade: -10 } },
    compulsion: { name: "Velar", description: "Com o Eco no máximo, você precisa velar um morto.", text: "[crying] Você não consegue sair do lugar até terminar uma prece inteira por alguém que nem conheceu.", effects: [{ op: "status", field: "energy", delta: -15 }, { op: "status", field: "stress", delta: 8 }] },
  },
  {
    id: "radio_escutas", lineage: "haunted", name: "Rádio-Escutas",
    epithets: "Os da Frequência, Ouvintes, Filhos do Chiado",
    description: "Ouvem os mortos pelo chiado — rádios, celulares sem sinal, fios soltos. Iara fala mais alto com eles. Consertam qualquer aparelho e escutam o que ele ainda guarda.",
    passive: { name: "Frequência", description: "Máquinas e mortos falam a mesma língua. +15% em conhecimento técnico e +5% em inteligência.", bonus: { conhecimento_tecnico: 15, inteligencia: 5 } },
    powers: [
      { id: "sintonizar", name: "Sintonizar", description: "Por 3h, +25% em conhecimento técnico.", cost: 1, minutes: 10, effects: [buff("conhecimento_tecnico", 25, 180)], text: "[mysterious] Você encosta a testa no metal. O chiado vira uma voz de mulher explicando, com paciência, qual fio é qual." },
      { id: "eco_do_passado", name: "Eco do Passado", description: "A frequência revela o caminho da crista e o rochedo.", cost: 2, minutes: 15, effects: [{ op: "revealLink", from: "trilha", to: "estacao" }, { op: "reveal", location: "rochedo" }], text: "[whispers] Sete… quatro… zero. Desta vez você entende: é um rumo. E uma trilha que ninguém mais vê." },
    ],
    bane: { name: "Chiado", description: "O ruído nunca para. −10% em comunicação: você responde a vozes que ninguém ouviu.", penalty: { comunicacao: -10 } },
    compulsion: { name: "Contagem", description: "Com o Eco no máximo, você precisa contar junto com a voz.", text: "[slowly] Sete. Quatro. Zero. Você conta por uma hora, baixinho, sem conseguir parar. As pessoas se afastam.", effects: [{ op: "status", field: "stress", delta: 14 }] },
  },
  {
    id: "os_frios", lineage: "haunted", name: "Os Frios",
    epithets: "Sem Calor, Meio-Mortos, Passantes",
    description: "Tocaram a morte e voltaram com metade do corpo do lado de lá. Atravessam paredes de névoa, não fazem sombra e gelam o que tocam.",
    passive: { name: "Corpo Frio", description: "Metade de você já não está aqui. +15% em furtividade.", bonus: { furtividade: 15 } },
    powers: [
      { id: "atravessar", name: "Atravessar", description: "Por 2h, +25% em agilidade.", cost: 1, minutes: 5, effects: [buff("agilidade", 25, 120)], text: "[haunting] Por um instante, galhos e pedras passam por dentro de você." },
      { id: "toque_gelado", name: "Toque Gelado", description: "Por 3h, as criaturas da noite evitam você.", cost: 2, minutes: 5, effects: [{ op: "ward", minutes: 180 }], text: "[cold] Você exala e o ar congela em volta. O que é vivo no escuro sente frio e vai embora." },
    ],
    bane: { name: "Sem Calor", description: "O corpo não se aquece direito. −10% em resistência.", penalty: { resistencia: -10 } },
    compulsion: { name: "Frio do Outro Lado", description: "Com o Eco no máximo, o lado de lá puxa você.", text: "[trembling] Você fica transparente por um minuto inteiro. Quando volta, está gelado até os ossos.", effects: [{ op: "status", field: "bodyTemp", delta: -0.9 }, { op: "status", field: "stress", delta: 8 }] },
  },

  // ═══════════════════ CAÇADORES — os credos dos que resistiram ═══════════════════
  {
    id: "vigias", lineage: "hunter", name: "Vigias",
    epithets: "Os que Não Dormem, Sentinelas da Fogueira",
    description: "Resistiram ao chamado ficando acordados. Aprenderam a ver as criaturas antes que elas vejam você — e a segurar a luz firme quando tudo treme.",
    passive: { name: "Vigília", description: "Sempre de olho. +15% em percepção e +5% em controle emocional.", bonus: { percepcao: 15, controle_emocional: 5 } },
    powers: [
      { id: "luz_firme", name: "Luz Firme", description: "Por 3h, as criaturas da noite não se aproximam.", cost: 2, minutes: 5, onlyNight: true, effects: [{ op: "ward", minutes: 180 }], text: "[serious] Você ergue a luz e não pisca. Pela primeira vez, são elas que têm medo." },
      { id: "marcar_a_presa", name: "Marcar a Presa", description: "Por 2h, +20% em agilidade.", cost: 1, minutes: 5, effects: [buff("agilidade", 20, 120)], text: "Você estuda o movimento das sombras até prever o próximo." },
    ],
    bane: { name: "Insônia", description: "Dormir é deixar de vigiar. −10% em resistência.", penalty: { resistencia: -10 } },
    compulsion: { name: "Não Dormir", description: "Com a Obsessão no máximo, você não consegue fechar os olhos.", text: "[exhausted] Você passa horas encarando o escuro, certo de que se piscar alguém morre.", effects: [{ op: "status", field: "fatigue", delta: 20 }, { op: "status", field: "stress", delta: 8 }] },
  },
  {
    id: "remendeiros", lineage: "hunter", name: "Remendeiros",
    epithets: "Benzedeiros, Curandeiros de Beira de Estrada",
    description: "A fé deles é de mão: rezas antigas, chá amargo e pano limpo. Não vencem as criaturas — impedem que elas levem os seus.",
    passive: { name: "Mãos Firmes", description: "Sabem remendar gente. +20% em medicina.", bonus: { medicina: 20 } },
    powers: [
      { id: "benzedura", name: "Benzedura", description: "Estanca sangramentos e acalma.", cost: 1, minutes: 15, effects: [{ op: "healWounds" }, { op: "status", field: "stress", delta: -10 }], text: "[speaking softly] Você reza baixo a benzedura da sua avó, faz o sinal três vezes sobre a ferida e aperta o pano. O sangue para." },
      { id: "cha_amargo", name: "Chá Amargo", description: "Cura gastroenterite e febre, reduz a infecção.", cost: 2, minutes: 30, effects: [{ op: "cure", key: "gastroenterite" }, { op: "cure", key: "febre" }, { op: "infection", delta: -25 }], text: "Folhas amargas, água quente, uma oração da sua avó. O corpo sua — e melhora." },
    ],
    bane: { name: "Carrega a Dor dos Outros", description: "Cada cura cobra um pouco. −10% em força.", penalty: { forca: -10 } },
    compulsion: { name: "Cuidar", description: "Com a Obsessão no máximo, você precisa cuidar de alguém.", text: "[sighs] Você passa uma hora refazendo curativos que já estavam bons. Não consegue parar.", effects: [{ op: "status", field: "energy", delta: -12 }, { op: "status", field: "stress", delta: 6 }] },
  },
  {
    id: "justiceiros", lineage: "hunter", name: "Justiceiros do 074",
    epithets: "Os da Verdade, Promesseiros, Teimosos",
    description: "Resistiram porque alguém precisava contar a verdade. Farejam a mentira e não largam o osso até o culpado pagar — seja homem ou fera.",
    passive: { name: "Faro de Mentira", description: "Ninguém engana vocês fácil. +15% em comunicação e +10% em inteligência.", bonus: { comunicacao: 15, inteligencia: 10 } },
    powers: [
      { id: "pressionar", name: "Pressionar", description: "Por 2h, +25% em comunicação.", cost: 1, minutes: 5, effects: [buff("comunicacao", 25, 120)], text: "[serious] Você olha nos olhos e não pisca. A verdade começa a pesar mais que o medo." },
      { id: "cumprir_a_promessa", name: "Cumprir a Promessa", description: "Por 1h, +20% em força e +15% em controle emocional.", cost: 2, minutes: 5, effects: [buff("forca", 20, 60), buff("controle_emocional", 15, 60)], text: "Você lembra de Iara, dos 37 riscos na estaca, do rumo 074. O corpo obedece." },
    ],
    bane: { name: "Teimosia", description: "Nunca se escondem da verdade — nem das balas. −10% em furtividade.", penalty: { furtividade: -10 } },
    compulsion: { name: "Justiça", description: "Com a Obsessão no máximo, você precisa confrontar alguém.", text: "[desperate] Você grita acusações para o vale inteiro. O eco devolve cada uma. Algo no escuro ouviu.", effects: [{ op: "status", field: "stress", delta: 16 }] },
  },
];

export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));

export function classesFor(lineage: LineageKey): ClassDef[] {
  return CLASSES.filter((c) => c.lineage === lineage);
}

export function powerById(classId: string | null | undefined, powerId: string): PowerDef | undefined {
  return classId ? CLASS_BY_ID[classId]?.powers.find((p) => p.id === powerId) : undefined;
}
