"use client";
/**
 * Trilha de terror: efeitos por PESSOA e SITUAÇÃO em public/audio/<pessoa>/<situacao>.mp3
 * (créditos em public/audio/CREDITOS.md).
 *
 * Reage ao estado do jogo, sem regra nova:
 *  - evento que começa → som da pessoa/criatura em cena (às vezes seguido de uma risada);
 *  - confronto com chefe → música de luta em loop; noite → ambiente noturno em loop, baixo;
 *  - morte, mordida, linhagem despertada, compulsão, alívio do estresse e toque de alma → estalos;
 *  - começar a caminhar → passos no mato (à noite, às vezes um galho quebra atrás);
 *  - fogueira acesa, fratura → estalos; lugar com fogo, rio, poço ou floresta de dia → som do lugar em loop.
 * Tudo em volume baixo, com fade, e só depois do primeiro gesto do usuário (regra do navegador).
 */
import { useEffect, useRef } from "react";
import type { GameState } from "./useGame";
import { mixVolume, onMixChange, useMixer, type AudioCategory } from "../audioMixer";

const BASE = "/audio";

/** Sons de cada pessoa/criatura e do cenário (caminho sem .mp3). */
export const HORROR = {
  jogador: {
    gritoMorte: "jogador/grito-morte",
    gritoMordida: "jogador/grito-mordida",
    panico: "jogador/panico-compulsao",
    alivio: ["jogador/suspiro-alivio-1", "jogador/suspiro-alivio-2"],
  },
  iara: { aparicao: "iara/aparicao-coral", suspiro: "iara/suspiro", chamado: "iara/sussurro-chamado", numeros: "iara/sussurro-numeros" },
  mae: { grito: "mae-das-asas/grito-aparicao", risada: "mae-das-asas/risada", filhas: "mae-das-asas/filhas-risada" },
  lobo: { rosnado: "lobo-de-ambar/rosnado", uivo: "lobo-de-ambar/uivo", distante: "lobo-de-ambar/uivo-distante", eco: "lobo-de-ambar/uivo-eco" },
  bichos: { rugido: "bichos/rugido-selvagem" },
  tavares: { entrada: "tavares/tensao-entrada", sarcastica: "tavares/risada-sarcastica", cruel: "tavares/risada-cruel" },
  almas: {
    murmurios: "almas/murmurios",
    sussurros: ["almas/sussurro-arrepiante", "almas/sussurro-submundo"],
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
    passos: ["cenario/mato-passo", "cenario/mato-arbusto", "cenario/mato-folhas", "cenario/mato-grama", "cenario/mato-campo-seco", "cenario/passos-floresta"],
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
  [/^vs_cacada$/, { sound: HORROR.tavares.cruel, vol: 0.45 }],
  // Iara, a Voz
  [/^ch_iara_sinal$/, { sound: HORROR.iara.numeros, vol: 0.6 }],
  [/^ch_iara$/, { sound: HORROR.iara.aparicao, then: { sound: HORROR.iara.chamado, afterMs: 5500, vol: 0.45 } }],
  [/^ch_iara_furia$/, { sound: HORROR.almas.demoniaca, vol: 0.5 }],
  [/^vs_febre$/, { sound: HORROR.iara.suspiro, vol: 0.5 }],
  [/^vs_celular$/, { sound: HORROR.iara.chamado, vol: 0.5 }],
  // Almas do vale
  [/^vs_vozes$/, { sound: HORROR.cenario.galhos[0], vol: 0.5, then: { sound: HORROR.almas.sussurros[0], afterMs: 1400, vol: 0.55 } }],
  [/^vs_nevoa$/, { sound: HORROR.almas.sussurros[1], vol: 0.5 }],
  [/^vs_tumulo$/, { sound: HORROR.almas.murmurios, vol: 0.4 }],
  // Mato, água e bichos
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
  vampire: HORROR.mae.grito,
  werewolf: HORROR.lobo.uivo,
  haunted: HORROR.iara.aparicao,
  hunter: HORROR.cenario.encontro,
};

/** Toque/sussurro de alma nas linhas do diário (encontros noturnos). */
const SOUL_LINE = /(frio atravessa|diz seu nome|seu nome.*névoa|silhueta de névoa|alma para ao seu lado)/i;

const pick = (s: string | readonly string[]) => (typeof s === "string" ? s : s[Math.floor(Math.random() * s.length)]);

function eventIdOf(state: GameState): string | null {
  return state.event?.id ?? null;
}

function fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void) {
  const from = a.volume;
  const start = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - start) / ms);
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

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
}

type LoopInfo = { el: HTMLAudioElement; cat: AudioCategory; base: number; fading: boolean };

export function useHorrorAudio(state: GameState | null, enabled: boolean) {
  const loops = useRef<Record<string, LoopInfo>>({});
  const seen = useRef<Seen | null>(null);

  const play = (sound: string, vol = 0.55) => {
    if (!enabled) return;
    try {
      const a = new Audio(`${BASE}/${sound}.mp3`);
      // Os volumes das cenas foram calibrados antes do mixer: ×1,4 mantém o peso deles no padrão.
      a.volume = mixVolume("efeitos", Math.min(1, vol * 1.4));
      void a.play().catch(() => undefined);
      // O rosnado é longo: some em fade depois de alguns segundos.
      if (sound === HORROR.lobo.rosnado) setTimeout(() => fade(a, 0, 1500, () => a.pause()), 8000);
    } catch {
      /* áudio é enfeite, nunca quebra o jogo */
    }
  };
  const cue = (c: Cue) => {
    play(pick(c.sound), c.vol ?? 0.55);
    if (c.then) setTimeout(() => play(c.then!.sound, c.then!.vol ?? 0.5), c.then.afterMs);
  };

  const setLoop = (sound: string, on: boolean, base: number, cat: AudioCategory = "ambiente") => {
    const cur = loops.current[sound];
    if (on && enabled) {
      if (cur && !cur.el.paused) return;
      const info: LoopInfo = cur ?? { el: new Audio(`${BASE}/${sound}.mp3`), cat, base, fading: false };
      info.el.loop = true;
      info.el.volume = 0;
      info.fading = true;
      loops.current[sound] = info;
      void info.el.play().then(() => fade(info.el, mixVolume(cat, base), 2500, () => { info.fading = false; })).catch(() => undefined);
    } else if (cur && !cur.el.paused) {
      cur.fading = true;
      fade(cur.el, 0, 1500, () => { cur.el.pause(); cur.fading = false; });
    }
  };

  // Slider do mixer: os loops que estão tocando acompanham na hora.
  useEffect(() => {
    const unsubscribe = onMixChange(() => {
      for (const info of Object.values(loops.current)) {
        if (!info.el.paused && !info.fading) info.el.volume = mixVolume(info.cat, info.base);
      }
    });
    return unsubscribe;
  }, []);

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
    };
    const prev = seen.current;
    seen.current = now;
    if (!prev) return;

    if (now.event && now.event !== prev.event) {
      const hit = EVENT_CUE.find(([re]) => re.test(now.event!));
      if (hit) cue(hit[1]);
    }
    if (prev.alive && now.alive === false) play(HORROR.jogador.gritoMorte, 0.6);
    else if (now.bitten > prev.bitten) play(HORROR.jogador.gritoMordida, 0.45);
    if (prev.lineage === "human" && now.lineage && now.lineage !== "human") play(LINEAGE_CUE[now.lineage] ?? HORROR.cenario.encontro);

    const fresh = state.log.filter((l) => l.id > prev.log);
    if (fresh.some((l) => /Compulsão:/.test(l.text))) play(HORROR.jogador.panico, 0.5);
    else if (fresh.some((l) => l.kind === "narrative" && SOUL_LINE.test(l.text))) play(pick(HORROR.almas.sussurros), 0.5);
    else if (now.alive && prev.stress - now.stress >= 15) play(pick(HORROR.jogador.alivio), 0.45);

    if (now.moving && !prev.moving) {
      play(pick(HORROR.cenario.passos), 0.35);
      // À noite, às vezes algo pisa num galho atrás de você.
      if (state.campaign.night && Math.random() < 0.3) setTimeout(() => play(pick(HORROR.cenario.galhos), 0.4), 1800);
    }
    if (now.fire && !prev.fire && now.location === prev.location) play(HORROR.cenario.fogueiraAcender, 0.5);
    if (now.fractures > prev.fractures) play(HORROR.cenario.osso, 0.6);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, enabled]);

  // Loops: luta de chefe tem prioridade sobre o ambiente noturno.
  const eventId = state ? eventIdOf(state) : null;
  const fighting = !!eventId && FIGHT.test(eventId) && !!state?.event?.participating;
  const playing = !!state?.me?.alive && state?.campaign.status === "active";
  const nightBed = playing && !!state?.campaign.night && !fighting;
  // Som de lugar: floresta de dia ao ar livre; fogueira acesa; rio na ponte; gotas no poço.
  const dayBed = playing && !state?.campaign.night && !state?.here.indoor && !fighting;
  const fireBed = playing && !!state?.here.fire;
  const riverBed = playing && state?.here.water === "stream";
  const wellBed = playing && state?.here.water === "lake";
  useEffect(() => {
    // Volumes-base relativos DENTRO da categoria (o mixer multiplica por categoria e geral).
    setLoop(HORROR.cenario.luta, enabled && fighting, 0.7, "musica");
    setLoop(HORROR.cenario.noite, enabled && nightBed, 0.4);
    setLoop(HORROR.cenario.dia, enabled && dayBed, 0.3);
    setLoop(HORROR.cenario.fogueira, enabled && fireBed, 0.45);
    setLoop(HORROR.cenario.rio, enabled && riverBed, 0.4);
    setLoop(HORROR.cenario.poco, enabled && wellBed, 0.4);
    // Durante a luta, a música do mundo andável abaixa e a música do chefe assume.
    useMixer.getState().setDucked(enabled && fighting);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fighting, nightBed, dayBed, fireBed, riverBed, wellBed]);

  // Sai da tela: para tudo.
  useEffect(() => {
    const playing = loops.current;
    return () => {
      for (const info of Object.values(playing)) info.el.pause();
      useMixer.getState().setDucked(false);
    };
  }, []);
}
