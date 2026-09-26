"use client";
/**
 * GameWorld — o mundo andável. Monta o Phaser (import dinâmico, só no navegador),
 * traduz o estado do servidor para a cena e desenha por cima os controles de
 * celular, o prompt de interação, os menus de ação e o diálogo de eventos.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "../game/useGame";
import { ACTION_LABEL } from "../game/useGame";
import { dayPhase } from "../game/Scene";
import { EventCard } from "../game/Panels";
import type { Hotspot } from "./layout";
import type { WorldCallbacks, WorldScene, WorldView } from "./engine";

type Act = (type: string, params?: Record<string, unknown>) => void;
type Option = { key: string; label: string; minutes: number; available: boolean; reason: string | null; run: () => void };

const NPC_SPRITE: Record<string, number> = { piloto: 8 };

function fmtMin(m: number) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

/** Visual (1–25) estável por personagem, sem repetir dentro do grupo. */
function spriteMap(state: GameState) {
  const pool = [5, 3, 25, 2, 13, 12, 17, 10, 14, 16, 18, 22, 1, 6, 4];
  const out: Record<string, number> = {};
  const used: number[] = [];
  const h = (s: string) => { let x = 7; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x; };
  for (const p of [...state.party].sort((a, b) => a.characterId.localeCompare(b.characterId))) {
    let i = h(p.characterId) % pool.length;
    while (used.includes(pool[i]) && used.length < pool.length) i = (i + 1) % pool.length;
    used.push(pool[i]);
    out[p.characterId] = pool[i];
  }
  return out;
}

export function GameWorld({
  state, offset, busy, onAct, onCancel, onOpen, onEncounter, sound,
}: {
  state: GameState;
  offset: number;
  busy: boolean;
  onAct: Act;
  onCancel: () => void;
  onOpen: (what: "bag" | "char" | "map") => void;
  onEncounter: (kind: "morcego" | "alma") => Promise<boolean>;
  sound: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const [near, setNear] = useState<Hotspot | null>(null);
  const [menu, setMenu] = useState<Hotspot | "pause" | null>(null);
  const [talk, setTalk] = useState("");
  const [scare, setScare] = useState<string | null>(null);
  const [eventOpen, setEventOpen] = useState(true);
  // Caixa de texto com o que acabou de acontecer (novas mensagens do diário).
  const lastLogId = state.log[state.log.length - 1]?.id ?? 0;
  const [seenLog, setSeenLog] = useState(lastLogId);
  const [toast, setToast] = useState<{ id: number; text: string; kind: string }[]>([]);
  if (lastLogId !== seenLog) {
    const fresh = state.log.filter((l) => l.id > seenLog && ["result", "narrative", "npc", "death"].includes(l.kind));
    setSeenLog(lastLogId);
    if (fresh.length) setToast(fresh.slice(-3).map((l) => ({ id: l.id, text: l.text, kind: l.kind })));
  }
  const sfx = useSfx(sound);

  const me = state.me;
  const sprites = useMemo(() => spriteMap(state), [state]);
  const inEvent = !!state.event && !state.pending;
  const lastEvent = state.event?.instanceId;
  // Novo evento reabre o diálogo (derivado: não precisa de efeito).
  const [seenEvent, setSeenEvent] = useState<string | undefined>(undefined);
  if (lastEvent !== seenEvent) { setSeenEvent(lastEvent); setEventOpen(true); }

  // ── Opções por hotspot (tudo vem do estado do servidor) ────────────────────
  const hereAct = useCallback(
    (type: string, match?: (p: Record<string, unknown>) => boolean) =>
      state.here.actions.filter((a) => a.type === type && (!match || match(a.params))),
    [state.here.actions],
  );
  const optionsFor = useCallback(
    (h: Hotspot): Option[] => {
      const fromHere = (types: string[]) =>
        types.flatMap((t) => hereAct(t)).map((a) => ({
          key: `${a.type}-${JSON.stringify(a.params)}`, label: a.label, minutes: a.minutes, available: a.available, reason: a.reason,
          run: () => onAct(a.type, a.params),
        }));
      const fromInventory = (type: string) =>
        (me?.inventory ?? []).flatMap((it) => it.actions.filter((a) => a.type === type).map((a) => ({
          key: `${type}-${it.id}`, label: `${a.label}: ${it.name}`, minutes: a.minutes, available: a.available, reason: a.reason,
          run: () => onAct(a.type, a.params),
        })));
      switch (h.kind) {
        case "landmark":
        case "grave":
          return fromHere(["examinar"]);
        case "search":
          return fromHere(["procurar", "examinar"]);
        case "wood":
          return fromHere(["coletar_lenha"]);
        case "fire":
          return [...fromHere(["acender_fogueira"]), ...fromInventory("ferver_agua"), ...(state.here.fire ? fromHere(["descansar"]) : [])];
        case "camp":
          return fromHere(["montar_abrigo", "descansar", "dormir"]);
        case "water":
          return [...fromInventory("coletar_agua"), ...fromInventory("purificar_agua")];
        case "item": {
          const g = state.here.ground.find((x) => `item-${x.id}` === h.id);
          if (!g) return [];
          return [{ key: g.id, label: `Pegar ${g.name}${g.quantity > 1 ? ` ×${g.quantity}` : ""}`, minutes: g.minutes, available: g.available, reason: g.reason,
            run: () => onAct("pegar_item", { groundItemId: g.id }) }];
        }
        case "exit": {
          const t = state.map.travel.find((x) => x.to === h.to);
          if (!t) return [];
          return [{ key: t.to, label: `Caminhar até ${t.name}`, minutes: t.estimatedMinutes, available: t.available, reason: t.reason,
            run: () => onAct("mover", { to: t.to }) }];
        }
        default:
          return [];
      }
    },
    [hereAct, me, onAct, state.here.fire, state.here.ground, state.map.travel],
  );

  const view: WorldView = useMemo(() => {
    const locMap = new Map(state.map.locations.map((l) => [l.id, l]));
    const here = locMap.get(state.here.locationId);
    const canAct = !!me?.alive && !state.pending && state.here.actions.length > 0;
    const avail: Record<string, boolean> = {};
    const probe = (id: string, kind: Hotspot["kind"]) => { avail[id] = canAct && optionsFor({ id, kind, x: 0, y: 0, label: "" }).some((o) => o.available); };
    for (const k of ["landmark", "grave", "wood", "fire", "camp", "water"] as const) probe(k, k);
    for (let i = 0; i < 3; i++) probe(`search-${i}`, "search");
    for (const g of state.here.ground) avail[`item-${g.id}`] = canAct && g.available;
    if (state.here.npc) avail.npc = canAct;
    const pend = state.pending;
    return {
      locationId: state.here.locationId,
      terrain: here?.terrain ?? "mata",
      name: state.here.name,
      x: here?.x ?? 50,
      y: here?.y ?? 50,
      water: !!state.here.water,
      neighbors: state.map.travel.map((t) => ({ to: t.to, name: t.name, x: locMap.get(t.to)?.x ?? null, y: locMap.get(t.to)?.y ?? null })),
      phase: dayPhase(state.campaign.clock),
      night: state.campaign.night,
      rain: state.campaign.weather === "chuva",
      fire: state.here.fire,
      danger: here?.danger ?? 1,
      me: me ? { id: me.id, name: me.name, sprite: sprites[me.id] ?? 5, alive: me.alive } : null,
      party: state.party
        .filter((p) => !p.isMe && p.alive && p.locationId === state.here.locationId)
        .map((p) => ({ id: p.characterId, name: p.name, sprite: sprites[p.characterId] ?? 3 })),
      npc: state.here.npc ? { id: state.here.npc.id, name: state.here.npc.name, sprite: NPC_SPRITE[state.here.npc.id] ?? 24 } : null,
      ground: state.here.ground.map((g) => ({ id: g.id, name: g.name, itemId: g.itemId })),
      avail,
      pending: pend
        ? { type: pend.type, target: pend.target, startMs: Date.parse(pend.submittedAt) - offset, endMs: Date.parse(pend.completesAt) - offset }
        : null,
      locked: !!menu || (inEvent && eventOpen) || state.campaign.status === "finished",
    };
  }, [state, me, sprites, offset, optionsFor, menu, inEvent, eventOpen]);

  // ── Monta o Phaser uma vez ─────────────────────────────────────────────────
  const viewRef = useRef(view);
  const cbRef = useRef<WorldCallbacks>({ onInteract: () => {}, onNear: () => {}, onScare: () => {} });
  useEffect(() => {
    viewRef.current = view;
    sceneRef.current?.setView(view);
  }, [view]);
  useEffect(() => {
    cbRef.current = {
      onInteract: (h) => {
        if (h.kind === "npc") { setMenu(h); sfx("voice-1"); return; }
        setMenu(h);
        sfx("menu-1");
      },
      onNear: (h) => setNear(h),
      onScare: (kind) => {
        sfx("alert");
        // O servidor decide o que o ataque custa; o texto chega pelo diário (caixa de texto).
        void onEncounter(kind).then((happened) => {
          if (!happened) setScare(kind === "morcego" ? "Algo passa rente à sua cabeça e some na treva." : "Um vulto atravessa a névoa e se desfaz.");
        });
      },
    };
  }, [sfx, onEncounter]);

  useEffect(() => {
    let game: import("phaser").Game | null = null;
    let cancelled = false;
    (async () => {
      const Phaser = await import("phaser");
      const { WorldScene } = await import("./engine");
      if (cancelled || !host.current) return;
      const font = getComputedStyle(document.documentElement).getPropertyValue("--font-lcd").trim() || "monospace";
      const scene = new WorldScene();
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        backgroundColor: "#05030a",
        pixelArt: true,
        roundPixels: true,
        scale: { mode: Phaser.Scale.RESIZE, width: host.current.clientWidth, height: host.current.clientHeight },
        audio: { noAudio: true },
        banner: false,
        scene: [],
      });
      game.scene.add("world", scene, true, {
        view: viewRef.current,
        font: `${font}, monospace`,
        cb: {
          onInteract: (h: Hotspot) => cbRef.current.onInteract(h),
          onNear: (h: Hotspot | null) => cbRef.current.onNear(h),
          onScare: (k: "morcego" | "alma") => cbRef.current.onScare(k),
        },
      });
      sceneRef.current = scene;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __world?: unknown }).__world = scene;
    })();
    return () => {
      cancelled = true;
      sceneRef.current = null;
      game?.destroy(true);
    };
  }, []);

  // Some o aviso de susto depois de um tempo
  useEffect(() => {
    if (!scare) return;
    const t = setTimeout(() => setScare(null), 3800);
    return () => clearTimeout(t);
  }, [scare]);

  // A caixa de texto some sozinha depois de um tempo proporcional ao texto.
  useEffect(() => {
    if (!toast.length) return;
    const chars = toast.reduce((n, t) => n + t.text.length, 0);
    const t = setTimeout(() => setToast([]), Math.min(14000, 4000 + chars * 35));
    return () => clearTimeout(t);
  }, [toast]);

  // Música: tema de dia/noite (pacote CC0), só com som ligado
  useMusic(sound && state.campaign.status === "active", state.campaign.night);

  const openMenu = menu && menu !== "pause" ? menu : null;
  const options = openMenu ? optionsFor(openMenu) : [];
  const close = () => setMenu(null);
  const run = (o: Option) => { o.run(); close(); };
  const pend = state.pending;

  return (
    <div className="world" data-tut-id="map">
      <div ref={host} className="world-canvas" />

      {/* Local atual */}
      <div className="world-place">
        <span className="world-place-name">{state.here.name}</span>
        {state.here.fire && <span className="world-chip">🔥</span>}
        {state.here.sheltered && <span className="world-chip">⛺</span>}
      </div>

      {/* Ação em andamento */}
      {pend && (
        <div className="world-pending" data-tut-id="pending">
          <span>{ACTION_LABEL[pend.type] ?? "Agindo"}…</span>
          {pend.waitingFor.length > 0 && <span className="muted"> esperando {pend.waitingFor.join(", ")}</span>}
          <button className="btn btn-xs" onClick={onCancel} disabled={busy}>Cancelar</button>
        </div>
      )}

      {/* O que aconteceu (resultado da ação, narração, fala do NPC) */}
      {toast.length > 0 && !menu && !(inEvent && eventOpen) && (
        <button className="world-say" onClick={() => setToast([])} aria-live="polite">
          {toast.map((t) => (
            <span key={t.id} className={`world-say-line world-say-${t.kind}`}>{t.text}</span>
          ))}
          <span className="world-say-next">▼</span>
        </button>
      )}

      {/* Susto noturno */}
      {scare && <div className="world-scare" role="status">{scare}</div>}

      {/* Prompt de interação */}
      {near && !menu && !pend && me?.alive && !(inEvent && eventOpen) && (
        <button className="world-prompt" onClick={() => sceneRef.current?.pressA()}>
          <span className="world-key">A</span> {promptVerb(near)} <b>{near.label}</b>
        </button>
      )}

      {/* Controles de toque */}
      <Joystick onMove={(x, y) => sceneRef.current?.setJoystick(x, y)} />
      <div className="world-buttons">
        <button className="world-btn world-btn-b" onClick={() => { setMenu(menu ? null : "pause"); sfx("menu-2"); }} aria-label="Menu">B</button>
        <button className="world-btn world-btn-a" onClick={() => sceneRef.current?.pressA()} aria-label="Interagir">A</button>
      </div>

      {/* Evento: caixa de diálogo */}
      {inEvent && state.event && (
        eventOpen ? (
          <div className="world-dialog" data-tut-id="event">
            <button className="world-dialog-min" onClick={() => setEventOpen(false)} aria-label="Minimizar">▾</button>
            <EventCard state={state} event={state.event} onAct={onAct} busy={busy} />
          </div>
        ) : (
          <button className="world-prompt world-prompt-event" onClick={() => setEventOpen(true)}>
            <span className="world-key">!</span> {state.event.title}
          </button>
        )
      )}

      {/* Menu de ação de um ponto do cenário */}
      {openMenu && (
        <div className="world-menu" role="dialog" aria-label={openMenu.label}>
          <div className="world-menu-title">{openMenu.label}</div>
          {openMenu.kind === "npc" ? (
            <form
              className="stack-sm"
              onSubmit={(e) => { e.preventDefault(); if (!talk.trim()) return; onAct("conversar", { message: talk.trim() }); setTalk(""); close(); }}
            >
              <div className="tiny muted">5 min por fala</div>
              <input className="input" autoFocus maxLength={300} placeholder="O que você diz?" value={talk} onChange={(e) => setTalk(e.target.value)} />
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-primary" disabled={busy || !talk.trim() || !state.here.actions.length}>Falar</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={close}>Voltar</button>
              </div>
            </form>
          ) : (
            <>
              {options.length === 0 && <div className="tiny muted">{openMenu.kind === "water" ? "Você precisa de uma garrafa vazia para encher." : "Nada a fazer aqui agora."}</div>}
              {options.map((o) => (
                <button key={o.key} className="world-opt" disabled={busy || !o.available} onClick={() => run(o)} title={o.reason ?? undefined}>
                  <span>▸ {o.label}</span>
                  <span className="world-opt-min">{o.available ? fmtMin(o.minutes) : o.reason}</span>
                </button>
              ))}
              <button className="world-opt world-opt-back" onClick={close}>Voltar</button>
            </>
          )}
        </div>
      )}

      {/* Menu geral (B) */}
      {menu === "pause" && (
        <div className="world-menu" role="dialog" aria-label="Menu">
          <div className="world-menu-title">Menu</div>
          <button className="world-opt" onClick={() => { close(); onOpen("bag"); }}>▸ Mochila <span className="world-opt-min">{me?.load.weightKg}kg</span></button>
          <button className="world-opt" onClick={() => { close(); onOpen("char"); }}>▸ Personagem</button>
          <button className="world-opt" onClick={() => { close(); onOpen("map"); }}>▸ Mapa do vale</button>
          {hereAct("tomar_analgesico").map((a) => (
            <button key="analg" className="world-opt" disabled={busy || !a.available} onClick={() => { onAct(a.type, a.params); close(); }}>▸ {a.label}</button>
          ))}
          {hereAct("esperar").map((a) => (
            <button key="esperar" className="world-opt" disabled={busy || !a.available} onClick={() => { onAct(a.type, a.params); close(); }}>
              ▸ {a.label}
            </button>
          ))}
          <button className="world-opt world-opt-back" onClick={close}>Voltar ao jogo</button>
        </div>
      )}
    </div>
  );
}

function promptVerb(h: Hotspot) {
  return ({ search: "Vasculhar", wood: "Recolher", fire: "Fogueira:", camp: "Abrigo:", water: "Água:", landmark: "Olhar", grave: "Ler", item: "Pegar", npc: "Falar com", exit: "Ir para" } as const)[h.kind];
}

// ── Joystick virtual (só aparece em telas de toque, via CSS) ──────────────────
function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const handle = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const max = r.width / 2;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
    setKnob({ x: dx, y: dy });
    const nx = dx / max, ny = dy / max;
    onMove(Math.abs(nx) < 0.2 ? 0 : nx, Math.abs(ny) < 0.2 ? 0 : ny);
  };
  const end = () => { active.current = null; setKnob({ x: 0, y: 0 }); onMove(0, 0); };
  return (
    <div
      ref={base}
      className="world-joy"
      onPointerDown={(e) => { active.current = e.pointerId; (e.target as HTMLElement).setPointerCapture(e.pointerId); handle(e); }}
      onPointerMove={(e) => { if (active.current === e.pointerId) handle(e); }}
      onPointerUp={end}
      onPointerCancel={end}
      aria-hidden="true"
    >
      <div className="world-joy-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

// ── Som ───────────────────────────────────────────────────────────────────────
function useSfx(enabled: boolean) {
  return useCallback(
    (name: string) => {
      if (!enabled) return;
      try {
        const a = new Audio(`/game/sounds/${name}.ogg`);
        a.volume = 0.45;
        void a.play().catch(() => {});
      } catch {}
    },
    [enabled],
  );
}

function useMusic(enabled: boolean, night: boolean) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const a = new Audio(`/game/musics/${night ? "theme-9" : "theme-3"}.ogg`);
    a.loop = true;
    a.volume = 0;
    ref.current = a;
    // Navegadores só tocam após um toque do jogador: tenta agora e no primeiro toque.
    const start = () => void a.play().catch(() => {});
    start();
    window.addEventListener("pointerdown", start, { once: true });
    const fade = setInterval(() => { if (a.volume < 0.22) a.volume = Math.min(0.22, a.volume + 0.02); }, 150);
    return () => {
      clearInterval(fade);
      window.removeEventListener("pointerdown", start);
      a.pause();
      ref.current = null;
    };
  }, [enabled, night]);
}
