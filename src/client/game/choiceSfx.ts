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
  "jogador/respiracao-correndo": { search: "running breathing panic / out of breath running", where: "Correr, Fugir", seconds: "3–6" },
  "jogador/respiracao-contida": { search: "holding breath scared / nervous breathing", where: "Ficar imóvel, Prender a respiração, Deitar no chão, Observar em silêncio", seconds: "3–5" },
  "jogador/gemido-dor": { search: "pain groan short", where: "Enfaixar, tratar ferimento, morder a língua", seconds: "1–3" },
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
  "cenario/celular-vibrando": { search: "phone vibrate / cellphone static interference", where: "Evento 23h40 (o celular)", seconds: "2–4" },
};

/**
 * Primeira regra que casar com o texto da escolha vence. Só ações com som inequívoco:
 * nada de "sair"/"seguir" genérico (tocava passo no mato dentro da cabine do avião).
 */
const CHOICE_RULES: [RegExp, SoundCue][] = [
  [/oferecer o pescoço|próprio sangue/i, { want: "mae-das-asas/vampira-olhar" }],
  [/uiv/i, { want: "lobo-de-ambar/uivo", vol: 0.7 }],
  [/cinto/i, { want: "cenario/cinto-fivela" }],
  [/forçar a porta|forçar o cadeado|alavanca|pular a cerca|quadriciclo/i, { want: "cenario/metal-forcando" }],
  [/fogo|chama|fogueira|incendiar/i, { want: "cenario/fogueira-acender" }],
  [/sinalizador/i, { want: "cenario/sinalizador" }],
  [/rádio|sintoniz|frequência|fios/i, { want: "cenario/radio-chiado" }],
  [/lanterna|apagar a luz/i, { want: "cenario/lanterna-clique" }],
  [/mergulh/i, { want: "cenario/agua-mergulho" }],
  [/quebrar.*(?:garrafa|vidro)|(?:garrafa|vidro).*quebr/i, { want: "cenario/vidro-quebrando" }],
  [/beber da poça/i, { want: "jogador/engasgo" }],
  [/beber/i, { want: "jogador/beber-agua" }],
  [/oferecer água/i, { want: "cenario/garrafa-abrindo", vol: 0.75 }],
  [/corr(a|er)|fug(a|ir)/i, { want: "jogador/respiracao-correndo", fallback: "cenario/passos-floresta" }],
  [/espingarda/i, { want: "tavares/espingarda-1" }],
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
  vs_helicoptero: { want: "cenario/helicoptero" },
  vs_resgate: { want: "cenario/helicoptero", vol: 0.6 },
  vs_radio: { want: "cenario/radio-chiado", vol: 0.7 },
  vs_radio_final: { want: "cenario/radio-chiado", vol: 0.7 },
  vs_donos_carga: { want: "cenario/motor-carro" },
  vs_cacada: { want: "cenario/motor-carro" },
  vs_celular: { want: "cenario/celular-vibrando" },
};

/**
 * Grito em português, por situação e pelo sexo da personagem — gerado por voz (não há
 * grito em pt-BR no Pixabay): `npm run audio:shouts` cria cada um e guarda na biblioteca
 * do Supabase. Até lá o som simplesmente não toca.
 */
export const SHOUTS: { choice: RegExp; slug: string; line: string }[] = [
  { choice: /gritar pelo piloto/i, slug: "piloto", line: "Piloto?! Tem alguém aí?!" },
  { choice: /acenar e gritar/i, slug: "helicoptero", line: "Aqui! Aqui embaixo! Socorro!" },
  { choice: /chamar por alguém/i, slug: "estacao", line: "Ô de casa! Tem alguém aí?!" },
  { choice: /pedir ajuda/i, slug: "ajuda", line: "Ei! Por favor, me ajuda!" },
];

export type Sex = "feminino" | "masculino" | string;

export function shoutId(slug: string, sex: Sex): string {
  return `jogador/grito-${sex === "feminino" ? "f" : "m"}-${slug}`;
}

export function choiceCue(label: string, sex: Sex = "masculino"): SoundCue | null {
  const shout = SHOUTS.find((s) => s.choice.test(label));
  // Enquanto a versão falada em pt-BR ainda não foi gerada, nunca deixa o gesto mudo.
  if (shout) return { want: shoutId(shout.slug, sex), fallback: "jogador/grito-morte" };
  return CHOICE_RULES.find(([re]) => re.test(label))?.[1] ?? null;
}

/** Ações do inventário/local que não passam pelos botões de escolha narrativa. */
export const ACTION_CUES: Record<string, SoundCue> = {
  beber: { want: "jogador/beber-agua", vol: 0.85 },
  coletar_agua: { want: "cenario/agua-vertendo", vol: 0.75 },
  purificar_agua: { want: "cenario/garrafa-abrindo", vol: 0.7 },
  ferver_agua: { want: "cenario/agua-vertendo", vol: 0.65 },
};

/** Todas as regras (para o teste que confere se cada som existe ou está na lista). */
export const ALL_CUES: SoundCue[] = [...CHOICE_RULES.map(([, cue]) => cue), ...Object.values(EVENT_WANTED), ...Object.values(ACTION_CUES)];

export function playCue(cue: SoundCue | null | undefined): void {
  if (!cue) return;
  audioDirector().sting(cue.want, cue.vol ?? 1, { important: true, fallback: cue.fallback });
}

export function playChoice(label: string, sex?: Sex): void {
  playCue(choiceCue(label, sex));
}

export function playAction(type: string): void {
  playCue(ACTION_CUES[type]);
}

export const DICE: Record<"rolling" | "success" | "failure", SoundCue> = {
  // O rolamento acompanha a animação sem encobrir voz, ambiente ou o som do resultado.
  rolling: { want: "dado/rolando", vol: 0.28 },
  // Sem reserva: um suspiro ou galho quebrando no resultado do dado não faz sentido.
  success: { want: "dado/sucesso", vol: 0.8 },
  failure: { want: "dado/falha" },
};
