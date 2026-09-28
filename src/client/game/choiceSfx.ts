/**
 * Som imediato de cada escolha e do D20 — toca DENTRO do toque do jogador, então o
 * celular nunca bloqueia (autoplay exige gesto).
 *
 * Cada regra aponta para o som ideal (`want`). Se o arquivo ainda não foi baixado, o
 * diretor usa `fallback` (um som que já existe) ou fica em silêncio. Os sons que faltam
 * estão em PIXABAY_WANTED — é a lista de download (docs/AUDIOS-PIXABAY.md). Basta o
 * arquivo aparecer em public/audio/<want>.mp3 para passar a tocar.
 */
import { audioDirector } from "./audioDirector";

export interface SoundCue {
  want: string;
  fallback?: string;
  vol?: number;
}

/** Sons que ainda não existem em public/audio: o que buscar no Pixabay e onde tocam. */
export const PIXABAY_WANTED: Record<string, { search: string; where: string; seconds: string }> = {
  "jogador/grito-socorro": { search: "shouting help / hey over here (de preferência uma voz que sirva para homem e mulher)", where: "Gritar pelo piloto, Acenar e gritar, Chamar por alguém, Pedir ajuda", seconds: "1–3" },
  "jogador/respiracao-correndo": { search: "running breathing panic / out of breath running", where: "Correr, Fugir", seconds: "3–6" },
  "jogador/respiracao-contida": { search: "holding breath scared / nervous breathing", where: "Ficar imóvel, Prender a respiração, Deitar no chão, Observar em silêncio", seconds: "3–5" },
  "jogador/golpe": { search: "punch impact struggle / body hit fight", where: "Golpear, Derrubar o capanga, Acabar com isso, Tomar a chave de roda", seconds: "1–2" },
  "jogador/gemido-dor": { search: "pain groan short", where: "Enfaixar, tratar ferimento, morder a língua", seconds: "1–3" },
  "jogador/beber-agua": { search: "drinking water gulp", where: "Beber da poça, Beber do córrego", seconds: "2–3" },
  "cenario/metal-forcando": { search: "metal door creak force / crowbar metal", where: "Forçar a porta, Alavanca, Forçar o cadeado, Pular a cerca", seconds: "2–4" },
  "cenario/cinto-fivela": { search: "seatbelt unbuckle", where: "Soltar o cinto (começo do jogo)", seconds: "1" },
  "cenario/lanterna-clique": { search: "flashlight click on off", where: "Lanterna, Apagar a luz", seconds: "0.5–1" },
  "cenario/radio-chiado": { search: "radio static tuning / walkie talkie static", where: "Ligar e sintonizar o rádio, cena do rádio", seconds: "3–6" },
  "cenario/sinalizador": { search: "flare gun shot / signal flare", where: "Disparar o sinalizador", seconds: "2–4" },
  "cenario/agua-mergulho": { search: "dive into water splash", where: "Mergulhar até a luz", seconds: "2–3" },
  "cenario/papel-folhear": { search: "paper page turn / notebook pages", where: "Ler o diário, Levar o mapa, Ler a lápide", seconds: "1–2" },
  "cenario/pedras": { search: "stones rocks moving / rock drop", where: "Cobrir a cova com pedras", seconds: "2–3" },
  "cenario/corda": { search: "rope climbing / rope tension", where: "Descer usando a corda, Fixar uma corda", seconds: "2–4" },
  "cenario/helicoptero": { search: "helicopter flyby distant", where: "Evento Rotor ao longe / Céu aberto", seconds: "5–10" },
  "cenario/motor-carro": { search: "car engine approaching night / off road vehicle", where: "Eventos Motor na ponte e Faróis entre as árvores", seconds: "5–8" },
  "cenario/aviao-destrocos": { search: "plane crash aftermath / metal creaking fire", where: "Abertura: Silêncio depois do impacto", seconds: "5–8" },
  "cenario/celular-vibrando": { search: "phone vibrate / cellphone static interference", where: "Evento 23h40 (o celular)", seconds: "2–4" },
  "dado/rolando": { search: "dice roll wooden table", where: "Botão ROLAR D20", seconds: "1–2" },
  "dado/sucesso": { search: "success sting dark / mysterious positive hit", where: "Resultado do D20: sucesso", seconds: "1–2" },
  "dado/falha": { search: "horror sting fail / suspense hit low", where: "Resultado do D20: falha", seconds: "1–2" },
};

/**
 * Primeira regra que casar com o texto da escolha vence. Só ações com som inequívoco:
 * nada de "sair"/"seguir" genérico (tocava passo no mato dentro da cabine do avião).
 */
const CHOICE_RULES: [RegExp, SoundCue][] = [
  [/grit|chamar por|acenar|pedir ajuda/i, { want: "jogador/grito-socorro" }],
  [/uiv/i, { want: "lobo-de-ambar/uivo", vol: 0.7 }],
  [/cinto/i, { want: "cenario/cinto-fivela" }],
  [/forçar a porta|forçar o cadeado|alavanca|pular a cerca|quadriciclo/i, { want: "cenario/metal-forcando" }],
  [/fogo|chama|fogueira|incendiar/i, { want: "cenario/fogueira-acender" }],
  [/sinalizador/i, { want: "cenario/sinalizador" }],
  [/rádio|sintoniz|frequência|fios/i, { want: "cenario/radio-chiado" }],
  [/lanterna|apagar a luz/i, { want: "cenario/lanterna-clique" }],
  [/mergulh/i, { want: "cenario/agua-mergulho" }],
  [/beber/i, { want: "jogador/beber-agua" }],
  [/corr(a|er)|fug(a|ir)/i, { want: "jogador/respiracao-correndo", fallback: "cenario/passos-floresta" }],
  [/golpe|derrubar|acabar com isso|tomar a chave/i, { want: "jogador/golpe" }],
  [/imóvel|prender a respiração|deitar no chão|em silêncio/i, { want: "jogador/respiracao-contida" }],
  [/subir na árvore|enfiar no mato|arbust/i, { want: "cenario/mato-arbusto" }],
  [/pedras/i, { want: "cenario/pedras" }],
  [/corda/i, { want: "cenario/corda" }],
  [/diário|mapa|lápide|ler /i, { want: "cenario/papel-folhear" }],
  [/enfaix|tratar|língua/i, { want: "jogador/gemido-dor" }],
  [/descans|fechar os olhos/i, { want: "jogador/suspiro-alivio-1" }],
];

/** Eventos cujo som de chegada ainda falta (os que já existem ficam em horrorAudio.ts). */
export const EVENT_WANTED: Record<string, SoundCue> = {
  vs_despertar: { want: "cenario/aviao-destrocos", vol: 0.7 },
  vs_helicoptero: { want: "cenario/helicoptero" },
  vs_resgate: { want: "cenario/helicoptero", vol: 0.6 },
  vs_radio: { want: "cenario/radio-chiado", vol: 0.7 },
  vs_donos_carga: { want: "cenario/motor-carro" },
  vs_cacada: { want: "cenario/motor-carro" },
  vs_celular: { want: "cenario/celular-vibrando" },
};

export function choiceCue(label: string): SoundCue | null {
  return CHOICE_RULES.find(([re]) => re.test(label))?.[1] ?? null;
}

/** Todas as regras (para o teste que confere se cada som existe ou está na lista). */
export const ALL_CUES: SoundCue[] = [...CHOICE_RULES.map(([, cue]) => cue), ...Object.values(EVENT_WANTED)];

export function playCue(cue: SoundCue | null | undefined): void {
  if (!cue) return;
  audioDirector().sting(cue.want, cue.vol ?? 1, { important: true, fallback: cue.fallback });
}

export function playChoice(label: string): void {
  playCue(choiceCue(label));
}

export const DICE: Record<"rolling" | "success" | "failure", SoundCue> = {
  rolling: { want: "dado/rolando" },
  // Sem reserva: um suspiro ou galho quebrando no resultado do dado não faz sentido.
  success: { want: "dado/sucesso", vol: 0.8 },
  failure: { want: "dado/falha" },
};
