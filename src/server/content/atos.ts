/**
 * Estrutura em atos do Vale Silente.
 *
 *  ATO I — Sozinhos: cada jogador acorda num ponto diferente do vale (o dono da sala nos destroços).
 *          Na primeira noite, quem ainda for humano passa pelo DESPERTAR e escolhe o próprio caminho:
 *          Vampiro, Lobisomem, Assombrado ou Caçador. Depois escolhe a CLASSE da linhagem.
 *  VIRADA — Quando todos os vivos têm classe, liga `ato2` (engine/powers.ts) e o vale chama o grupo.
 *  ATO II — O Encontro (grupo reunido no acampamento) liga `encontro_feito`: começa a aventura
 *          principal (Tavares e Iara só aparecem a partir daqui).
 */
import type { ChoiceDef, ClueDef, EventDef } from "../engine/types";
import { CLASSES, RESOURCE_NAME } from "../engine/classes";
import type { LineageKey } from "../engine/lineage";

const c = (eventId: string, id: string, x: Omit<ChoiceDef, "id">): ChoiceDef => ({ id: `${eventId}.${id}`, ...x });

/** Ordem de chegada: 1º = dono da sala (tutorial nos destroços), depois os convidados. */
export const START_LOCATIONS = ["destrocos", "mata", "lago", "trilha"];
export const MEETING_LOCATION = "abrigo";

export const START_INTROS: Record<string, string> = {
  destrocos: "[exhales] Você acorda preso ao assento do bimotor. Os outros passageiros não estão aqui. [pause] Nenhum corpo, nenhum sangue — só cintos soltos e o rádio chiando.",
  mata: "[gasps] Você acorda de bruços na mata, a quilômetros do avião, com folhas na boca e as roupas rasgadas. [pause] Não lembra de ter andado. [whispers] Lembra de ter sido carregado.",
  lago: "[trembling] Você acorda na beira do poço escuro, encharcado até o peito, como se alguém tivesse tirado você da água. [pause] Na lama, marcas de mãos pequenas. Muitas.",
  trilha: "[breathing heavily] Você acorda na trilha da crista, sob um céu de estrelas duras, com um laço de arame preso no tornozelo. [pause] Alguém armou isso para você. E soltou.",
};

const LINEAGE_CLASS_TITLE: Record<Exclude<LineageKey, "human">, { title: string; body: string }> = {
  vampire: {
    title: "O sangue escolhe o seu clã",
    body: "[whispers] O sangue da Mãe corre em você — mas não do mesmo jeito que corre nos outros. Na água parada do poço, reflexos que não são o seu mostram quatro caminhos. [pause] Cada clã é uma família antiga, com dons e maldições que passam pelo sangue.",
  },
  werewolf: {
    title: "A matilha te reconhece",
    body: "[growls] Uivos vêm de três direções da crista. Cada um é uma tribo, com a sua lei e o seu modo de caçar. [pause] A lua espera que você responda a um deles.",
  },
  haunted: {
    title: "Os mortos te dão um lugar",
    body: "[haunting] A névoa se abre em três corredores. Em cada um, os mortos fazem um trabalho diferente: chorar, escutar, atravessar. [whispers] Eles perguntam qual será o seu.",
  },
  hunter: {
    title: "O credo de quem resistiu",
    body: "[serious] Você não cedeu. Nem ao sangue, nem à lua, nem à névoa. [pause] Mas resistir sozinho não basta: há três jeitos antigos de continuar de pé neste vale.",
  },
};

function classEvent(lineage: Exclude<LineageKey, "human">): EventDef {
  const id = `ch_classe_${lineage}`;
  const list = CLASSES.filter((k) => k.lineage === lineage);
  return {
    id, title: LINEAGE_CLASS_TITLE[lineage].title, locationId: null, priority: 68, repeatable: true,
    trigger: { anyLocation: true, lineageAny: [lineage], classNone: true, cooldownMinutes: 1 },
    body: LINEAGE_CLASS_TITLE[lineage].body,
    choices: list.map((k, i) =>
      c(id, k.id, {
        label: `${k.name} — ${k.epithets.split(",")[0]}`,
        durationMinutes: 5,
        safe: i === 0,
        outcome: {
          text:
            `${k.description} ` +
            `Disciplinas: ${k.passive.name} (passiva), ${k.powers.map((p) => p.name).join(" e ")}. ` +
            `Perdição — ${k.bane.name}: ${k.bane.description} ` +
            `Compulsão — ${k.compulsion.name}: ${k.compulsion.description} ` +
            `(${RESOURCE_NAME[lineage]} sobe ao usar poderes.)`,
          effects: [{ op: "setClass", classId: k.id }],
        },
      }),
    ),
  };
}

export const ACT_EVENTS: EventDef[] = [
  {
    id: "ch_despertar", title: "O Despertar", locationId: null, priority: 56, repeatable: true,
    trigger: { anyLocation: true, night: true, minMinute: 150, lineageAny: ["human"], cooldownMinutes: 30 },
    body: "[long pause] Às 2h40 o vale inteiro prende a respiração. [whispers] Quatro coisas vêm buscar você ao mesmo tempo: asas que batem no escuro, um uivo que sobe da crista, uma névoa fria que chama o seu nome — [pause] e, no fundo do peito, uma teimosia velha que diz não. [serious] Você só pode deixar entrar uma.",
    choices: [
      c("ch_despertar", "asas", {
        label: "Oferecer o pescoço às asas (Vampiro)", durationMinutes: 10,
        outcome: { text: "[gasps] Dentes. Frio. O coração para — e volta diferente. [dark laugh] A noite agora tem o seu gosto.", effects: [{ op: "awaken", lineage: "vampire" }, { op: "status", field: "stress", delta: 10 }] },
      }),
      c("ch_despertar", "uivo", {
        label: "Responder ao uivo (Lobisomem)", durationMinutes: 10,
        outcome: {
          text: "[growls] Você responde. O uivo volta de dentro do seu peito. Seus dentes afundam na gengiva, a coluna se dobra e cada osso encontra uma forma nova sob a pele. [breathing heavily] Quando consegue ficar de pé, a mata inteira tem cheiro — medo, sangue e uma matilha esperando pelo seu nome.",
          effects: [{ op: "awaken", lineage: "werewolf" }],
        },
      }),
      c("ch_despertar", "nevoa", {
        label: "Deixar a névoa entrar (Assombrado)", durationMinutes: 10,
        outcome: { text: "[haunting] A névoa entra pela boca e pelos olhos. Quando sai, deixa vozes. [whispers] Os mortos do vale agora falam com você.", effects: [{ op: "awaken", lineage: "haunted" }, { op: "status", field: "bodyTemp", delta: -0.4 }] },
      }),
      c("ch_despertar", "resistir", {
        label: "Resistir a todas (Caçador)", durationMinutes: 15, safe: true,
        outcome: { text: "[desperate] Você finca os pés no chão e diz não — para as asas, para a lua, para os mortos. [long pause] Elas recuam. Você continua humano. [serious] Mas agora enxerga cada uma delas.", effects: [{ op: "awaken", lineage: "hunter" }, { op: "status", field: "stress", delta: 15 }] },
      }),
    ],
  },
  classEvent("vampire"),
  classEvent("werewolf"),
  classEvent("haunted"),
  classEvent("hunter"),
  {
    id: "ch_encontro", title: "O Encontro", locationId: MEETING_LOCATION, priority: 69, repeatable: false,
    trigger: { flagsAll: ["ato2"], partyTogether: true },
    body: "[slowly] Sob a lona do acampamento abandonado, vocês se reencontram — mas não são mais as mesmas pessoas que embarcaram no bimotor. [pause] Olhos que refletem a luz. Mãos que não param de tremer. Alguém que fala com quem não está ali. [whispers] Na estaca principal, sob os 37 riscos de Iara, alguém gravou um risco novo. Para cada um de vocês.",
    choices: [
      c("ch_encontro", "revelar", {
        label: "Mostrar quem você se tornou", durationMinutes: 20,
        outcome: { text: "[relieved] Você conta tudo: o chamado, o preço, o poder. Ninguém foge. [pause] Pela primeira vez desde a queda, vocês são um grupo — um grupo estranho, mas um grupo.", effects: [{ op: "flag", key: "encontro_feito" }, { op: "flag", key: "grupo_unido" }, { op: "clue", key: "o_encontro" }, { op: "status", field: "stress", delta: -20 }] },
      }),
      c("ch_encontro", "esconder", {
        label: "Esconder o que você é", durationMinutes: 10, safe: true,
        outcome: { text: "[nervous] Você sorri, diz que está bem, esconde as marcas. [pause] Os outros fazem o mesmo. [whispers] Todo mundo sabe que todo mundo está mentindo.", effects: [{ op: "flag", key: "encontro_feito" }, { op: "flag", key: "segredos_no_grupo" }, { op: "clue", key: "o_encontro" }, { op: "status", field: "stress", delta: 5 }] },
      }),
    ],
  },
];

export const ACT_CLUES: ClueDef[] = [
  { key: "o_encontro", title: "O Encontro", text: "O grupo se reuniu, transformado. Agora é a hora da verdade: Tavares, a carga, e a voz de Iara às 23h40." },
];
