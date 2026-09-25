/** Constantes de balanceamento. Alterar aqui reflete em todo o motor e nos testes. */

export const ATTR_MIN = 1;
export const ATTR_MAX_CREATION = 6; // sem contar bônus de profissão
export const ATTR_MAX_ABSOLUTE = 8;
export const ATTR_POINTS_TO_DISTRIBUTE = 24; // além do mínimo 1 em cada um dos 12 atributos
export const MAX_EXPERIENCES = 2;

/** Duração base (minutos de jogo) das ações. */
export const ACTION_MINUTES = {
  quick: 2, // comer, beber, analgésico, pegar/largar
  examinar: 5,
  coletar_agua: 5,
  procurar: 10,
  ferver_agua: 10,
  tratar_ferimento: 15,
  acender_fogueira: 15,
  coletar_lenha: 20,
  montar_abrigo: 30,
  descansar: 30,
  esperar: 15,
  conversar: 5,
  equipar: 3,
} as const;

/** Tempo extra para tirar algo do compartimento principal da mochila (acessibilidade). */
export const BACKPACK_MAIN_ACCESS_MINUTES = 2;

export const SLEEP_OPTIONS_HOURS = [2, 4, 8] as const;

export const POCKETS_BASE_ML = 800;
export const HANDS_MAX_ML = 12000;

export const NIGHT_START = 18 * 60 + 30;
export const NIGHT_END = 5 * 60 + 45;

export const FIRE_DURATION_MINUTES = 180;
export const PAINKILLER_MINUTES = 360;
