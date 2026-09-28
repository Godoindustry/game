"use client";
/**
 * Trilha de terror: efeitos por PESSOA e SITUAÇÃO em public/audio/<pessoa>/<situacao>.mp3
 * (créditos em public/audio/CREDITOS.md).
 *
 * Reage ao estado do jogo (sem regra nova) e manda tudo para o diretor de áudio:
 *  - evento que começa → som da pessoa/criatura em cena (às vezes seguido de uma risada);
 *  - morte, mordida, linhagem despertada, compulsão, alívio do estresse, toque de alma,
 *    viagem (passos), fogueira acesa, fratura → um efeito (nunca vários ao mesmo tempo);
 *  - UM fundo por vez: luta de chefe > fogueira > rio > poço > noite > floresta de dia.
 * Voz (narrador/personagens) sempre por cima: o diretor abaixa o resto enquanto alguém fala.
 */
import { useEffect, useRef } from "react";
import type { GameState } from "./useGame";
import type { AudioCategory } from "../audioMixer";
import { audioDirector } from "./audioDirector";
import { EVENT_WANTED, playCue } from "./choiceSfx";

/** Sons de cada pessoa/criatura e do cenário (caminho sem .mp3). */
export const HORROR = {
  jogador: {
    gritoMorte: "jogador/grito-morte",
    gritoMordida: "jogador/grito-mordida",
    panico: "jogador/panico-compulsao",
    alivio: ["jogador/suspiro-alivio-1", "jogador/suspiro-alivio-2"],
  },
  iara: { aparicao: "iara/aparicao-coral", suspiro: "iara/suspiro", choro: "iara/choro", chamado: "iara/sussurro-chamado", numeros: "iara/sussurro-numeros", passosSalto: "iara/passos-salto" },
  mae: { grito: "mae-das-asas/grito-aparicao", risada: "mae-das-asas/risada", filhas: "mae-das-asas/filhas-risada", vampira: "mae-das-asas/vampira-olhar" },
  lobo: { rosnado: "lobo-de-ambar/rosnado", uivo: "lobo-de-ambar/uivo", distante: "lobo-de-ambar/uivo-distante", eco: "lobo-de-ambar/uivo-eco" },
  bichos: { rugido: "bichos/rugido-selvagem" },
  tavares: { entrada: "tavares/tensao-entrada", sarcastica: "tavares/risada-sarcastica", cruel: "tavares/risada-cruel", espingarda: ["tavares/espingarda-1", "tavares/espingarda-2", "tavares/espingarda-3"] },
  desconhecido: { assobio: "desconhecido/assobio" },
  almas: {
    murmurios: "almas/murmurios",
    sussurros: ["almas/sussurro-arrepiante", "almas/sussurro-submundo"],
    ola: "almas/sussurro-ola",
    demoniaca: "almas/risada-demoniaca",
    maligna: "almas/risada-maligna",
  },
  cenario: {
    noite: "cenario/ambiente-noite",
    dia: "cenario/floresta-dia",
    luta: "cenario/luta-chefe",
    despertar: "cenario/despertar",
    encontro: "cenario/encontro",
    fogueiraAcender: "cenario/fogueira-acender",
    fogueira: "cenario/fogueira",
    rio: "cenario/rio",
    poco: "cenario/poco-gotas",
    galhos: ["cenario/galho-quebrando-1", "cenario/galho-quebrando-2"],
    osso: "cenario/osso-quebrando",
    passos: [
      "cenario/mato-passo", "cenario/mato-arbusto", "cenario/mato-folhas", "cenario/mato-grama", "cenario/mato-campo-seco",
      "cenario/passos-floresta", "cenario/passos-trilha", "cenario/passos-terra", "cenario/passos-caminhada",
    ],
    passosConcreto: "cenario/passos-concreto",
    ventoInverno: "cenario/vento-inverno",
    ventoForte: "cenario/vento-forte",
    zumbido: "cenario/zumbido",
    arco: "cenario/arco",
  },
} as const;

type Cue = { sound: string | readonly string[]; vol?: number; then?: { sound: string; afterMs: number; vol?: number } };

/** Evento (id) → quem está em cena. */
const EVENT_CUE: [RegExp, Cue][] = [
  // Mãe das Asas e suas filhas
  [/^ch_ninho$/, { sound: HORROR.mae.filhas, vol: 0.4 }],
  [/^ch_(mae|mae_furia|trono)$/, { sound: HORROR.mae.grito, then: { sound: HORROR.mae.risada, afterMs: 2600 } }],
  [/^vs_asas$/, { sound: HORROR.mae.filhas, vol: 0.45 }],
  // Lobo de Âmbar
  [/^(ch_ambar|ch_ambar_final)$/, { sound: HORROR.lobo.rosnado, then: { sound: HORROR.lobo.eco, afterMs: 3500, vol: 0.45 } }],
  [/^vs_uivo$/, { sound: HORROR.lobo.uivo }],
  [/^ch_lua_cheia$/, { sound: HORROR.lobo.eco }],
  [/^ch_carcaca$/, { sound: HORROR.lobo.distante, vol: 0.45 }],
  // Tavares e os donos da carga
  [/^ch_tavares$/, { sound: HORROR.tavares.entrada, then: { sound: HORROR.tavares.sarcastica, afterMs: 4200, vol: 0.5 } }],
  [/^vs_cacada$/, { sound: HORROR.tavares.cruel, vol: 0.45, then: { sound: HORROR.tavares.espingarda[1], afterMs: 2600, vol: 0.5 } }],
  // Iara, a Voz
  // Salto alto no meio da mata, onde ninguém deveria estar — e então os números.
  [/^ch_iara_sinal$/, { sound: HORROR.iara.passosSalto, vol: 0.55, then: { sound: HORROR.iara.numeros, afterMs: 5200, vol: 0.6 } }],
  [/^ch_iara$/, { sound: HORROR.iara.aparicao, then: { sound: HORROR.iara.chamado, afterMs: 5500, vol: 0.45 } }],
  [/^ch_iara_furia$/, { sound: HORROR.almas.demoniaca, vol: 0.5 }],
  [/^vs_febre$/, { sound: HORROR.iara.choro, vol: 0.45 }],
  [/^vs_celular$/, { sound: HORROR.iara.chamado, vol: 0.5 }],
  // Almas do vale
  [/^vs_vozes$/, { sound: HORROR.cenario.galhos[0], vol: 0.5, then: { sound: HORROR.almas.ola, afterMs: 1400, vol: 0.55 } }],
  [/^vs_nevoa$/, { sound: HORROR.almas.sussurros[1], vol: 0.5 }],
  [/^vs_tumulo$/, { sound: HORROR.almas.murmurios, vol: 0.4 }],
  // Mato, água e bichos
  // Alguém assobia feliz numa mata onde ninguém deveria estar.
  [/^vs_acampamento$/, { sound: HORROR.desconhecido.assobio, vol: 0.35 }],
  [/^vs_queixadas$/, { sound: HORROR.bichos.rugido, vol: 0.5 }],
  [/^vs_trilha$/, { sound: HORROR.cenario.galhos[1], vol: 0.5 }],
  [/^vs_poco$/, { sound: HORROR.cenario.poco, vol: 0.45 }],
  // Atos
  [/^ch_despertar$/, { sound: HORROR.cenario.despertar }],
  [/^ch_encontro$/, { sound: HORROR.cenario.encontro }],
];

/** Eventos em que o chefe está em cena: tocam a música de luta. */
const FIGHT = /^ch_(mae|mae_furia|ambar|ambar_final|tavares|iara)$/;

const LINEAGE_CUE: Record<string, string> = {
  vampire: HORROR.mae.vampira,
  werewolf: HORROR.lobo.uivo,
  haunted: HORROR.iara.aparicao,
  hunter: HORROR.cenario.arco,
};

/** Toque/sussurro de alma nas linhas do diário (encontros noturnos). */
const SOUL_LINE = /(frio atravessa|diz seu nome|seu nome.*névoa|silhueta de névoa|alma para ao seu lado)/i;

const pick = (s: string | readonly string[]) => (typeof s === "string" ? s : s[Math.floor(Math.random() * s.length)]);

function eventIdOf(state: GameState): string | null {
  return state.event?.id ?? null;
}

/** Sons que furam o intervalo entre efeitos (chefe, morte, transformação). */
const IMPORTANT = new Set<string>([
  HORROR.mae.grito, HORROR.lobo.rosnado, HORROR.lobo.uivo, HORROR.tavares.entrada, HORROR.iara.aparicao,
  HORROR.cenario.despertar, HORROR.cenario.encontro, HORROR.jogador.gritoMorte,
]);
/** Sons naturalmente mais baixos na vida real (arquivos já normalizados; isto é só a proporção). */
const QUIETER: Record<string, number> = Object.fromEntries([
  ...HORROR.cenario.passos.map((s) => [s, 0.6]),
  ...HORROR.cenario.galhos.map((s) => [s, 0.75]),
  [HORROR.almas.murmurios, 0.75],
]);

interface Seen {
  event: string | null;
  log: number;
  alive: boolean | null;
  bitten: number;
  lineage: string | null;
  stress: number;
  moving: boolean;
  fire: boolean;
  fractures: number;
  location: string | null;
  indoor: boolean;
}

export function useHorrorAudio(state: GameState | null, enabled: boolean) {
  const seen = useRef<Seen | null>(null);
  const delayed = useRef<number[]>([]);

  // Tudo passa pelo diretor: intervalo entre efeitos, um fundo só, e voz sempre por cima.
  const play = (sound: string, base?: number) => {
    if (!enabled) return;
    audioDirector().sting(sound, base ?? QUIETER[sound] ?? 1, {
      important: IMPORTANT.has(sound),
      // O rosnado original é longo: some em fade depois de alguns segundos.
      fadeOutAfterMs: sound === HORROR.lobo.rosnado ? 8000 : undefined,
    });
  };
  const cue = (c: Cue) => {
    play(pick(c.sound), c.vol);
    if (c.then) delayed.current.push(window.setTimeout(() => play(c.then!.sound, c.then!.vol), c.then.afterMs));
  };

  // Estalos: reagem a MUDANÇAS (nunca ao estado já existente quando a tela abre).
  useEffect(() => {
    if (!state) return;
    const me = state.me;
    const bite = me?.health.diseases.find((d) => d.key === "mordida");
    const now: Seen = {
      event: eventIdOf(state),
      log: state.log[state.log.length - 1]?.id ?? 0,
      alive: me ? me.alive : null,
      bitten: bite ? Number(/\((\d)/.exec(bite.label)?.[1] ?? 1) : 0,
      lineage: me?.lineage.key ?? null,
      stress: me?.status.stress ?? 0,
      moving: state.pending?.type === "mover",
      fire: !!state.here.fire,
      fractures: me?.wounds.filter((w) => w.type === "fratura").length ?? 0,
      location: state.here.locationId,
      indoor: !!state.here.indoor,
    };
    const prev = seen.current;
    seen.current = now;
    if (!prev) {
      // Abertura: "O zumbido nos ouvidos é a primeira coisa que volta."
      if (now.event === "vs_despertar" && state.campaign.round <= 1) play(HORROR.cenario.zumbido, 0.6);
      return;
    }

    if (now.event && now.event !== prev.event) {
      const hit = EVENT_CUE.find(([re]) => re.test(now.event!));
      if (hit) cue(hit[1]);
      else if (enabled) playCue(EVENT_WANTED[now.event]);
    }
    if (prev.alive && now.alive === false) play(HORROR.jogador.gritoMorte);
    else if (now.bitten > prev.bitten) play(HORROR.jogador.gritoMordida);
    if (prev.lineage === "human" && now.lineage && now.lineage !== "human") play(LINEAGE_CUE[now.lineage] ?? HORROR.cenario.encontro);

    const fresh = state.log.filter((l) => l.id > prev.log);
    if (fresh.some((l) => /Compulsão:/.test(l.text))) play(HORROR.jogador.panico);
    else if (fresh.some((l) => l.kind === "narrative" && SOUL_LINE.test(l.text))) play(pick(HORROR.almas.sussurros));
    else if (now.alive && prev.stress - now.stress >= 15) play(pick(HORROR.jogador.alivio));

    if (now.moving && !prev.moving) {
      // Saindo de lugar fechado (estação, capela), o primeiro passo é em piso duro.
      play(prev.indoor ? HORROR.cenario.passosConcreto : pick(HORROR.cenario.passos));
      // À noite, às vezes algo pisa num galho atrás de você.
      if (state.campaign.night && Math.random() < 0.3) {
        delayed.current.push(window.setTimeout(() => play(pick(HORROR.cenario.galhos)), 1800));
      }
    }
    if (now.fire && !prev.fire && now.location === prev.location) play(HORROR.cenario.fogueiraAcender);
    if (now.fractures > prev.fractures) play(HORROR.cenario.osso);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, enabled]);

  // UM fundo só, por prioridade: luta > fogueira > rio > poço > noite > dia ao ar livre.
  const eventId = state ? eventIdOf(state) : null;
  const fighting = !!eventId && FIGHT.test(eventId) && !!state?.event?.participating;
  const playing = !!state?.me?.alive && state?.campaign.status === "active";
  const bed: { sound: string; cat: AudioCategory } | null = !enabled || !playing
    ? null
    : fighting
      ? { sound: HORROR.cenario.luta, cat: "musica" }
      : state?.here.fire
        ? { sound: HORROR.cenario.fogueira, cat: "ambiente" }
        : state?.here.water === "stream"
          ? { sound: HORROR.cenario.rio, cat: "ambiente" }
          : state?.here.water === "lake"
            ? { sound: HORROR.cenario.poco, cat: "ambiente" }
            // Vento ao ar livre: tempestade quando chove, vento gelado em noite de frio.
            : !state?.here.indoor && state?.campaign.weather === "chuva"
              ? { sound: HORROR.cenario.ventoForte, cat: "ambiente" }
            : !state?.here.indoor && state?.campaign.night && (state?.campaign.temperature ?? 99) <= 8
              ? { sound: HORROR.cenario.ventoInverno, cat: "ambiente" }
            : state?.campaign.night
              ? { sound: HORROR.cenario.noite, cat: "ambiente" }
              : !state?.here.indoor
                ? { sound: HORROR.cenario.dia, cat: "ambiente" }
                : null;
  const bedSound = bed?.sound ?? null;
  const bedCat = bed?.cat ?? "ambiente";
  useEffect(() => {
    audioDirector().setBed(bedSound, 1, bedCat);
  }, [bedSound, bedCat]);

  // Ruídos da mata: só ao ar livre e à noite, raros (45–90 s). Passos soltos com o jogador
  // parado, ou galhos dentro do avião, soavam sem sentido.
  const outdoorsAtNight = !!state?.campaign.night && !state?.here.indoor;
  useEffect(() => {
    if (!enabled || !playing || !outdoorsAtNight) return;
    const pool: readonly string[] = [...HORROR.cenario.galhos, HORROR.lobo.distante];
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        audioDirector().sting(pick(pool), 0.42);
        schedule();
      }, 45_000 + Math.random() * 45_000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [enabled, playing, outdoorsAtNight]);

  // Sai da tela: para tudo. Adiado para a remontagem imediata do React (StrictMode) não
  // calar a primeira narração.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      delayed.current.forEach(window.clearTimeout);
      delayed.current = [];
      window.setTimeout(() => {
        if (!mounted.current) audioDirector().stopAll();
      }, 0);
    };
  }, []);
}
