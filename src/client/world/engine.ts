/**
 * Motor do mundo andável (Phaser 3). Só roda no navegador: GameWorld.tsx
 * importa este arquivo dinamicamente.
 *
 * O servidor continua sendo a fonte da verdade: aqui só há movimento, visual e
 * "intenção de interagir". Quem decide o que acontece é o React (menus) e a API.
 */
import * as Phaser from "phaser";
import type { DayPhase } from "../game/Scene";
import { buildLayout, entryPoint, hashString, isBlocked, PROPS, T, W, H, type Hotspot, type Layout } from "./layout";

// ── Contrato com o React ─────────────────────────────────────────────────────
export interface WorldView {
  locationId: string;
  terrain: string;
  name: string;
  x: number;
  y: number;
  water: boolean;
  neighbors: { to: string; name: string; x: number | null; y: number | null }[];
  phase: DayPhase;
  night: boolean;
  rain: boolean;
  fire: boolean;
  danger: number;
  me: { id: string; name: string; sprite: number; alive: boolean } | null;
  party: { id: string; name: string; sprite: number }[];
  npc: { id: string; name: string; sprite: number } | null;
  ground: { id: string; name: string; itemId: string }[];
  /** id do hotspot → tem ação disponível agora (mostra marcador). */
  avail: Record<string, boolean>;
  pending: { type: string; target: string | null; startMs: number; endMs: number } | null;
  /** Menu, evento ou tela por cima: congela o controle. */
  locked: boolean;
}

export interface WorldCallbacks {
  onInteract: (h: Hotspot) => void;
  onNear: (h: Hotspot | null) => void;
  onScare: (kind: "morcego" | "alma") => void;
}

export const CHAR_SHEETS = 25;
const SPEED = 58;
const REACH = 22;
const DIR = { down: 0, up: 1, left: 2, right: 3 } as const;

type Walker = {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Text;
  sheet: number;
  home: { x: number; y: number };
  goal: { x: number; y: number } | null;
  wait: number;
};
type Creature = {
  sprite: Phaser.GameObjects.Sprite;
  kind: "morcego" | "alma";
  vx: number;
  vy: number;
  t: number;
  gone: number; // ms até reaparecer
};

export class WorldScene extends Phaser.Scene {
  private view!: WorldView;
  private cb!: WorldCallbacks;
  private font = "monospace";
  private layout!: Layout;
  private built: Phaser.GameObjects.GameObject[] = [];
  private maps: Phaser.Tilemaps.Tilemap[] = [];
  private player!: Phaser.GameObjects.Sprite;
  private playerShadow!: Phaser.GameObjects.Image;
  private playerSheet = 1;
  private facing: number = DIR.down;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private joy = { x: 0, y: 0 };
  private tapTarget: { x: number; y: number; hotspot: Hotspot | null } | null = null;
  private hotspots: Hotspot[] = [];
  private markers = new Map<string, Phaser.GameObjects.Image>();
  private near: Hotspot | null = null;
  private exitArmed = true;
  private walkers: Walker[] = [];
  private creatures: Creature[] = [];
  private dark!: Phaser.GameObjects.Image;
  private darkTex: Phaser.Textures.CanvasTexture | null = null;
  private tint!: Phaser.GameObjects.Rectangle;
  private rain!: Phaser.GameObjects.TileSprite;
  private fog!: Phaser.GameObjects.TileSprite;
  private flame: Phaser.GameObjects.Sprite | null = null;
  private progress!: Phaser.GameObjects.Graphics;
  private builtFor = "";
  private prevLocation: string | null = null;
  private lastScare = 0;
  private ready = false;

  constructor() {
    super("world");
  }

  init(data: { view: WorldView; cb: WorldCallbacks; font: string }) {
    this.view = data.view;
    this.cb = data.cb;
    this.font = data.font || "monospace";
  }

  preload() {
    this.load.spritesheet("tiles", "/game/background-elements/tileset.png", { frameWidth: T, frameHeight: T });
    for (let i = 1; i <= CHAR_SHEETS; i++) this.load.spritesheet(`c${i}`, `/game/characters/${i}.png`, { frameWidth: 16, frameHeight: 16 });
    for (const m of [2, 7, 9]) this.load.spritesheet(`m${m}`, `/game/monsters/${m}.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet("chest", "/game/items/little-treasure-chest.png", { frameWidth: 16, frameHeight: 16 });
    this.load.image("i-water", "/game/items/water-pot.png");
    this.load.image("i-med", "/game/items/medipack.png");
    this.load.image("i-food", "/game/items/food/onigiri.png");
    this.load.image("i-paper", "/game/items/scroll-empty.png");
    this.load.image("i-key", "/game/items/silver-key.png");
  }

  create() {
    makeTextures(this);
    this.makeAnims();
    this.cameras.main.setBackgroundColor("#05030a");
    this.cameras.main.setRoundPixels(true);

    const kb = this.input.keyboard!;
    // Sem "capture": as teclas continuam funcionando nos campos de texto do React.
    this.keys = kb.addKeys("UP,DOWN,LEFT,RIGHT,W,A,S,D,E,SPACE,ENTER", false) as Record<string, Phaser.Input.Keyboard.Key>;
    for (const k of ["E", "SPACE", "ENTER"]) this.keys[k].on("down", () => this.pressA());

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.view.locked || this.view.pending) return;
      const hs = this.hotspotAt(p.worldX, p.worldY);
      this.tapTarget = { x: hs ? hs.x : p.worldX, y: hs ? hs.y : p.worldY, hotspot: hs };
    });

    this.progress = this.add.graphics().setDepth(9500);
    this.scale.on("resize", () => this.fitCamera());
    this.build();
    this.ready = true;
  }

  // ── API chamada pelo React ────────────────────────────────────────────────
  setView(v: WorldView) {
    const prev = this.view;
    this.view = v;
    if (!this.ready) return;
    const key = this.buildKey(v);
    if (key !== this.builtFor) {
      if (prev.locationId !== v.locationId) this.prevLocation = prev.locationId;
      this.cameras.main.fadeOut(180, 5, 3, 10);
      this.cameras.main.once("camerafadeoutcomplete", () => {
        this.build();
        this.cameras.main.fadeIn(260, 5, 3, 10);
      });
      return;
    }
    this.syncDynamic();
  }
  setJoystick(x: number, y: number) {
    this.joy = { x, y };
    if (x || y) this.tapTarget = null;
  }
  pressA() {
    if (typeof document !== "undefined" && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "")) return;
    if (!this.ready || this.view.locked || this.view.pending || !this.view.me?.alive) return;
    const h = this.nearest();
    if (h) this.cb.onInteract(h);
  }

  // ── Construção do local ───────────────────────────────────────────────────
  private buildKey(v: WorldView) {
    // Reconstrói quando muda o local, os vizinhos, a fogueira, a noite ou quem está aqui.
    return [v.locationId, v.neighbors.map((n) => n.to).join(","), v.fire, v.night, v.phase, v.rain,
      v.party.map((p) => p.id).join(","), v.npc?.id ?? "", v.ground.map((g) => g.id).join(","), v.me?.sprite, v.me?.alive].join("|");
  }

  private build() {
    const v = this.view;
    const sameLocation = this.layout && this.builtFor.split("|")[0] === v.locationId;
    const keepPos = sameLocation && this.player ? { x: this.player.x, y: this.player.y } : null;
    for (const o of this.built) o.destroy();
    for (const m of this.maps) m.destroy();
    this.built = [];
    this.maps = [];
    this.walkers = [];
    this.creatures = [];
    this.markers.clear();
    this.flame = null;
    this.builtFor = this.buildKey(v);

    const L = (this.layout = buildLayout({
      locationId: v.locationId, terrain: v.terrain, name: v.name, x: v.x, y: v.y, water: v.water, neighbors: v.neighbors,
    }));

    // Chão + enfeites (tilemaps)
    for (const data of [L.ground, L.decor]) {
      const map = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
      const ts = map.addTilesetImage("tiles", "tiles", T, T, 0, 0)!;
      map.createLayer(0, ts, 0, 0)!.setDepth(-10);
      this.maps.push(map);
    }

    // Objetos do tileset, ordenados pela base (o jogador passa atrás das copas)
    for (const p of L.props) {
      const def = PROPS[p.key];
      const depth = (p.ty + def.h) * T;
      for (let j = 0; j < def.h; j++)
        for (let i = 0; i < def.w; i++) {
          const img = this.add.image((p.tx + i) * T, (p.ty + j) * T, "tiles", (def.cy + j) * 28 + def.cx + i).setOrigin(0).setDepth(depth);
          this.built.push(img);
        }
    }
    for (const c of L.customs) {
      if (c.key === "firepit") continue;
      this.built.push(this.add.image(c.x, c.y, c.key).setOrigin(0.5, 1).setDepth(c.y));
      if (c.key === "antenna") {
        const lamp = this.add.rectangle(c.x, c.y - c.h + 2, 3, 3, 0xff3030).setDepth(c.y + 1);
        this.tweens.add({ targets: lamp, alpha: 0.1, duration: 700, yoyo: true, repeat: -1, ease: "Stepped" });
        this.built.push(lamp);
      }
      if (c.key === "plane") {
        const smoke = this.add.particles(c.x + 10, c.y - 20, "puff", {
          speedY: { min: -14, max: -8 }, speedX: { min: -3, max: 5 }, lifespan: 2600, frequency: 260,
          alpha: { start: 0.45, end: 0 }, scale: { start: 0.6, end: 1.6 },
        }).setDepth(c.y + 2);
        this.built.push(smoke);
      }
    }

    // Fogueira (pedras sempre; chama quando acesa)
    if (L.firepit) {
      this.built.push(this.add.image(L.firepit.x, L.firepit.y + 8, "firepit").setOrigin(0.5, 1).setDepth(L.firepit.y - 4));
      if (v.fire) {
        this.flame = this.add.sprite(L.firepit.x, L.firepit.y + 5, "m2").setOrigin(0.5, 1).setDepth(L.firepit.y + 6).play("flame");
        this.built.push(this.flame);
        const sparks = this.add.particles(L.firepit.x, L.firepit.y - 6, "spark", {
          speedY: { min: -30, max: -14 }, speedX: { min: -6, max: 6 }, lifespan: 900, frequency: 180, alpha: { start: 1, end: 0 },
        }).setDepth(L.firepit.y + 7);
        this.built.push(sparks);
      }
    }

    // Placas com o nome do destino
    for (const e of L.exits) {
      const p = entryPoint(e);
      const arrow = e.side === "N" ? "↑" : e.side === "S" ? "↓" : e.side === "L" ? "→" : "←";
      const txt = this.label(`${arrow} ${e.name}`, p.x, p.y - 12, "#ecd6aa");
      this.built.push(txt);
    }

    // Hotspots do cenário + dinâmicos (itens no chão, NPC)
    this.hotspots = [...L.hotspots];
    v.ground.forEach((g, i) => {
      const spot = L.itemSpots[i % Math.max(1, L.itemSpots.length)] ?? L.spawn;
      const off = Math.floor(i / Math.max(1, L.itemSpots.length)) * 6;
      const x = spot.x + off, y = spot.y;
      const icon = itemIcon(g.itemId);
      const img = icon === "chest" ? this.add.sprite(x, y + 6, "chest", 0) : this.add.image(x, y + 4, icon);
      img.setOrigin(0.5, 1).setDepth(y);
      this.tweens.add({ targets: img, y: img.y - 2, duration: 600 + (i % 3) * 120, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      this.built.push(img);
      this.hotspots.push({ id: `item-${g.id}`, kind: "item", x, y, label: g.name });
    });

    if (v.npc) {
      const w = this.addWalker(v.npc.sprite, L.npcSpot.x, L.npcSpot.y, v.npc.name, "#c7a8ff");
      this.hotspots.push({ id: "npc", kind: "npc", x: w.sprite.x, y: w.sprite.y, label: v.npc.name });
    }

    // Jogador
    let start = keepPos ?? L.spawn;
    if (!keepPos && this.prevLocation) {
      const back = L.exits.find((e) => e.to === this.prevLocation);
      if (back) start = entryPoint(back);
    }
    this.playerSheet = v.me?.sprite ?? 1;
    this.playerShadow = this.add.image(start.x, start.y, "shadow").setDepth(start.y - 1);
    this.player = this.add.sprite(start.x, start.y, `c${this.playerSheet}`, 0).setOrigin(0.5, 1);
    this.player.setDepth(start.y);
    if (v.me && !v.me.alive) this.player.setTint(0x555566).setAngle(90);
    this.built.push(this.player, this.playerShadow);
    this.exitArmed = !L.hotspots.some((h) => h.kind === "exit" && Math.hypot(h.x - start.x, h.y - start.y) < 28);

    // Outros jogadores no mesmo local: andam por perto da clareira.
    v.party.forEach((p, i) => {
      const a = (i / Math.max(1, v.party.length)) * Math.PI * 2;
      this.addWalker(p.sprite, L.spawn.x + Math.cos(a) * 28, L.spawn.y + Math.sin(a) * 18, p.name, "#9fe0a0");
    });

    // Criaturas da noite
    if (v.night && v.me?.alive) {
      const n = Math.min(4, 1 + v.danger + (v.terrain === "mata" ? 1 : 0));
      for (let i = 0; i < n; i++) this.spawnCreature(i % 2 === 0 ? "morcego" : "alma");
    }

    // Camadas de atmosfera (fixas na tela)
    this.tint = this.add.rectangle(0, 0, 10, 10, 0x000000, 0).setScrollFactor(0).setDepth(9000);
    this.dark = this.add.image(0, 0, "__DEFAULT").setScrollFactor(0).setDepth(9001);
    this.rain = this.add.tileSprite(0, 0, 10, 10, "rain").setScrollFactor(0).setDepth(9002).setVisible(v.rain);
    this.fog = this.add.tileSprite(0, 0, 10, 10, "fog").setScrollFactor(0).setDepth(8999)
      .setAlpha(v.night || v.terrain === "penhasco" || v.terrain === "lago" ? 0.35 : 0.12);
    this.built.push(this.tint, this.dark, this.rain, this.fog);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, W * T, H * T);
    cam.startFollow(this.player, true, 0.14, 0.14);
    this.fitCamera();
    this.syncDynamic();
  }

  private label(text: string, x: number, y: number, color: string) {
    return this.add
      .text(x, y, text, { fontFamily: this.font, fontSize: "8px", color, stroke: "#05030a", strokeThickness: 2, resolution: 6 })
      .setOrigin(0.5, 1)
      .setDepth(8000);
  }

  private addWalker(sheet: number, x: number, y: number, name: string, color: string): Walker {
    const shadow = this.add.image(x, y, "shadow");
    const sprite = this.add.sprite(x, y, `c${sheet}`, 0).setOrigin(0.5, 1);
    const label = this.label(name, x, y - 17, color);
    this.built.push(shadow, sprite, label);
    const w: Walker = { sprite, shadow, label, sheet, home: { x, y }, goal: null, wait: 500 + Math.random() * 2000 };
    this.walkers.push(w);
    return w;
  }

  private spawnCreature(kind: "morcego" | "alma") {
    const key = kind === "morcego" ? "m9" : "m7";
    const edge = Math.random() * 4;
    const x = edge < 1 ? 20 : edge < 2 ? W * T - 20 : Math.random() * W * T;
    const y = edge >= 2 && edge < 3 ? 20 : edge >= 3 ? H * T - 20 : Math.random() * H * T;
    const sprite = this.add.sprite(x, y, key, 0).setOrigin(0.5, 1).setDepth(8500).setAlpha(kind === "alma" ? 0.75 : 1);
    this.built.push(sprite);
    this.creatures.push({ sprite, kind, vx: 0, vy: 0, t: Math.random() * 1000, gone: 0 });
  }

  /** Marcadores de "dá para fazer algo aqui". Atualizado sem reconstruir o mapa. */
  private syncDynamic() {
    for (const h of this.hotspots) {
      const on = !!this.view.avail[h.id] && h.kind !== "exit";
      let m = this.markers.get(h.id);
      if (on && !m) {
        m = this.add.image(h.x, h.y - 18, "marker").setDepth(8400);
        this.tweens.add({ targets: m, y: h.y - 22, duration: 420, yoyo: true, repeat: -1, ease: "Stepped", easeParams: [3] });
        this.markers.set(h.id, m);
        this.built.push(m);
      }
      m?.setVisible(on);
    }
    if (this.view.me && !this.view.me.alive) this.player?.setTint(0x555566);
  }

  private fitCamera() {
    const cam = this.cameras.main;
    const w = this.scale.width, h = this.scale.height;
    const zoom = Phaser.Math.Clamp(Math.round(Math.min(w, h) / 140), 2, 4);
    cam.setZoom(zoom);
    // Mundo menor que a tela: centraliza.
    const vw = w / zoom, vh = h / zoom;
    cam.setBounds(Math.min(0, (W * T - vw) / 2), Math.min(0, (H * T - vh) / 2), Math.max(W * T, vw), Math.max(H * T, vh));
    for (const o of [this.tint, this.dark, this.rain, this.fog]) {
      if (!o) continue;
      o.setPosition(w / 2, h / 2).setOrigin(0.5);
    }
    this.tint?.setSize(vw + 2, vh + 2);
    if (this.dark) {
      // Escuridão: canvas pequeno (1 px = 1 px do mundo) redesenhado a cada quadro.
      const dw = Math.ceil(vw) + 2, dh = Math.ceil(vh) + 2;
      if (!this.darkTex || this.darkTex.width !== dw || this.darkTex.height !== dh) {
        if (this.textures.exists("darkness")) this.textures.remove("darkness");
        this.darkTex = this.textures.createCanvas("darkness", dw, dh);
      }
      this.dark.setTexture("darkness").setDisplaySize(dw, dh);
    }
    this.rain?.setSize(vw + 2, vh + 2);
    this.fog?.setSize(vw + 2, vh + 2);
  }

  private makeAnims() {
    for (let i = 1; i <= CHAR_SHEETS; i++)
      for (const [name, d] of Object.entries(DIR)) {
        this.anims.create({ key: `c${i}-${name}`, frames: [0, 1, 2, 3].map((r) => ({ key: `c${i}`, frame: r * 4 + d })), frameRate: 8, repeat: -1 });
      }
    for (const m of [7, 9])
      for (const [name, d] of Object.entries(DIR))
        this.anims.create({ key: `m${m}-${name}`, frames: [0, 1, 2, 3].map((r) => ({ key: `m${m}`, frame: r * 4 + d })), frameRate: 7, repeat: -1 });
    this.anims.create({ key: "flame", frames: [0, 1, 2, 3].map((r) => ({ key: "m2", frame: r * 4 })), frameRate: 8, repeat: -1 });
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  update(_t: number, dtMs: number) {
    if (!this.player || !this.layout) return;
    const dt = Math.min(dtMs, 50) / 1000;
    const v = this.view;
    const alive = !!v.me?.alive;

    // Entrada
    let ix = 0, iy = 0;
    const k = this.keys;
    const typing = typeof document !== "undefined" && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "");
    if (!typing) {
      if (k.LEFT.isDown || k.A.isDown) ix -= 1;
      if (k.RIGHT.isDown || k.D.isDown) ix += 1;
      if (k.UP.isDown || k.W.isDown) iy -= 1;
      if (k.DOWN.isDown || k.S.isDown) iy += 1;
    }
    ix += this.joy.x;
    iy += this.joy.y;
    if (ix || iy) this.tapTarget = null;

    let auto: { x: number; y: number } | null = null;
    if (v.pending?.type === "mover" && v.pending.target) {
      const e = this.layout.exits.find((x) => x.to === v.pending!.target);
      if (e) auto = { x: e.tx * T + T / 2, y: e.ty * T + T / 2 };
    } else if (this.tapTarget) auto = this.tapTarget;

    const frozen = !alive || v.locked || (!!v.pending && v.pending.type !== "mover");
    if (frozen) { ix = 0; iy = 0; auto = null; this.tapTarget = null; }
    else if (v.pending) { ix = 0; iy = 0; }

    if (auto && !ix && !iy) {
      const dx = auto.x - this.player.x, dy = auto.y - this.player.y;
      const d = Math.hypot(dx, dy);
      if (d > 3) { ix = dx / d; iy = dy / d; }
      else if (this.tapTarget) {
        const hs = this.tapTarget.hotspot;
        this.tapTarget = null;
        if (hs && hs.kind !== "exit") this.cb.onInteract(hs);
      }
      if (this.tapTarget?.hotspot && this.tapTarget.hotspot.kind !== "exit" && d < REACH - 4) {
        const hs = this.tapTarget.hotspot;
        this.tapTarget = null;
        ix = 0; iy = 0;
        this.cb.onInteract(hs);
      }
    }

    const len = Math.hypot(ix, iy);
    if (len > 0) {
      ix /= Math.max(1, len);
      iy /= Math.max(1, len);
      const speed = SPEED * (v.pending?.type === "mover" ? 0.7 : 1);
      const moved = this.moveBody(this.player, ix * speed * dt, iy * speed * dt, !!v.pending);
      if (!moved && this.tapTarget) this.tapTarget = null;
      this.facing = Math.abs(ix) > Math.abs(iy) ? (ix < 0 ? DIR.left : DIR.right) : iy < 0 ? DIR.up : DIR.down;
      const anim = `c${this.playerSheet}-${Object.keys(DIR)[this.facing]}`;
      if (this.player.anims.currentAnim?.key !== anim || !this.player.anims.isPlaying) this.player.play(anim, true);
    } else {
      this.player.anims.stop();
      if (alive) this.player.setFrame(this.facing);
    }
    // Esperando uma ação: um "balanço" de quem está ocupado
    if (v.pending && v.pending.type !== "mover") this.player.setFrame(this.facing + (Math.floor(_t / 300) % 2) * 4);

    this.player.setDepth(this.player.y);
    this.playerShadow.setPosition(this.player.x, this.player.y).setDepth(this.player.y - 1);
    if (v.pending?.type === "mover") {
      const pct = Phaser.Math.Clamp((Date.now() - v.pending.startMs) / Math.max(1, v.pending.endMs - v.pending.startMs), 0, 1);
      this.player.setAlpha(pct > 0.85 ? 1 - (pct - 0.85) / 0.15 : 1);
    } else this.player.setAlpha(1);

    // Saídas: pisar no vão abre a pergunta "ir para…?"
    const exitHere = this.hotspots.find((h) => h.kind === "exit" && Math.hypot(h.x - this.player.x, h.y - this.player.y) < 16);
    if (!exitHere) this.exitArmed = true;
    else if (this.exitArmed && !frozen && !v.pending) {
      this.exitArmed = false;
      this.cb.onInteract(exitHere);
    }

    // Hotspot mais próximo (prompt "A")
    const n = frozen ? null : this.nearest();
    if (n?.id !== this.near?.id) {
      this.near = n;
      this.cb.onNear(n);
    }

    this.updateWalkers(dt);
    this.updateCreatures(dt, alive && !v.locked);
    this.drawAtmosphere(_t);
    this.drawProgress();
  }

  /** Move com colisão por eixo (desliza nas paredes). */
  private moveBody(s: Phaser.GameObjects.Sprite, dx: number, dy: number, ghost = false) {
    const L = this.layout;
    const hit = (x: number, y: number) =>
      !ghost && (isBlocked(L, x - 4, y - 1) || isBlocked(L, x + 4, y - 1) || isBlocked(L, x - 4, y - 5) || isBlocked(L, x + 4, y - 5));
    const ox = s.x, oy = s.y;
    const bx = Phaser.Math.Clamp(s.x + dx, 4, W * T - 4);
    if (!hit(bx, s.y)) s.x = bx;
    const by = Phaser.Math.Clamp(s.y + dy, 8, H * T - 1);
    if (!hit(s.x, by)) s.y = by;
    return Math.abs(s.x - ox) + Math.abs(s.y - oy) > 0.01;
  }

  private nearest(): Hotspot | null {
    let best: Hotspot | null = null;
    let bd = REACH;
    for (const h of this.hotspots) {
      if (h.kind === "exit") continue;
      const d = Math.hypot(h.x - this.player.x, h.y - (this.player.y - 4));
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  private hotspotAt(x: number, y: number): Hotspot | null {
    let best: Hotspot | null = null;
    let bd = 14;
    for (const h of this.hotspots) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  private updateWalkers(dt: number) {
    for (const w of this.walkers) {
      w.wait -= dt * 1000;
      if (!w.goal && w.wait <= 0) {
        w.goal = { x: w.home.x + (Math.random() - 0.5) * 40, y: w.home.y + (Math.random() - 0.5) * 28 };
      }
      if (w.goal) {
        const dx = w.goal.x - w.sprite.x, dy = w.goal.y - w.sprite.y;
        const d = Math.hypot(dx, dy);
        if (d < 2) {
          w.goal = null;
          w.wait = 1500 + Math.random() * 3500;
          w.sprite.anims.stop();
          w.sprite.setFrame(DIR.down);
        } else {
          const moved = this.moveBody(w.sprite, (dx / d) * 24 * dt, (dy / d) * 24 * dt);
          if (!moved) { w.goal = null; w.wait = 800; }
          const dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
          w.sprite.play(`c${w.sheet}-${dir}`, true);
        }
      }
      w.sprite.setDepth(w.sprite.y);
      w.shadow.setPosition(w.sprite.x, w.sprite.y).setDepth(w.sprite.y - 1);
      w.label?.setPosition(w.sprite.x, w.sprite.y - 17);
    }
    const npc = this.hotspots.find((h) => h.kind === "npc");
    if (npc && this.walkers[0]) { npc.x = this.walkers[0].sprite.x; npc.y = this.walkers[0].sprite.y; }
  }

  /** Morcegos e almas: vagam, perseguem quem está no escuro, fogem da fogueira. */
  private updateCreatures(dt: number, active: boolean) {
    const L = this.layout;
    const px = this.player.x, py = this.player.y - 6;
    const fireSafe = this.view.fire && L.firepit && Math.hypot(L.firepit.x - px, L.firepit.y - py) < 56;
    for (const c of this.creatures) {
      c.t += dt * 1000;
      if (c.gone > 0) {
        c.gone -= dt * 1000;
        if (c.gone <= 0) {
          c.sprite.setPosition(Math.random() < 0.5 ? 16 : W * T - 16, 20 + Math.random() * (H * T - 40)).setVisible(true);
        }
        continue;
      }
      const dx = px - c.sprite.x, dy = py - c.sprite.y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = c.kind === "morcego" ? 40 : 26;
      if (active && fireSafe && d < 110) { c.vx = (-dx / d) * speed; c.vy = (-dy / d) * speed; }
      else if (active && d < 90) { c.vx = (dx / d) * speed; c.vy = (dy / d) * speed; }
      else if (c.t > 1600) {
        c.t = 0;
        const a = Math.random() * Math.PI * 2;
        c.vx = Math.cos(a) * speed * 0.5;
        c.vy = Math.sin(a) * speed * 0.5;
      }
      // Voo ondulado do morcego
      const wob = c.kind === "morcego" ? Math.sin(c.t / 120) * 12 : Math.sin(c.t / 400) * 4;
      c.sprite.x = Phaser.Math.Clamp(c.sprite.x + c.vx * dt, 8, W * T - 8);
      c.sprite.y = Phaser.Math.Clamp(c.sprite.y + (c.vy + wob) * dt, 12, H * T - 4);
      const dir = Math.abs(c.vx) > Math.abs(c.vy) ? (c.vx < 0 ? "left" : "right") : c.vy < 0 ? "up" : "down";
      c.sprite.play(`${c.kind === "morcego" ? "m9" : "m7"}-${dir}`, true);

      if (active && d < 11 && !fireSafe && this.time.now - this.lastScare > 2500) {
        this.lastScare = this.time.now;
        this.cameras.main.shake(220, 0.012);
        this.cameras.main.flash(260, 150, 0, 20);
        // Empurra o jogador para longe da criatura (dx/dy apontam da criatura para ele)
        this.moveBody(this.player, (dx / d) * 18, (dy / d) * 18);
        c.sprite.setVisible(false);
        c.gone = 7000;
        this.cb.onScare(c.kind);
      }
    }
  }

  private drawAtmosphere(t: number) {
    const v = this.view;
    const cam = this.cameras.main;
    const phaseTint: Record<DayPhase, [number, number]> = { day: [0x000000, 0], dawn: [0xff7a50, 0.12], dusk: [0xa03c28, 0.2], night: [0x000000, 0] };
    const [color, alpha] = phaseTint[v.phase];
    this.tint.setFillStyle(color, alpha);
    if (this.rain.visible) { this.rain.tilePositionY -= 4; this.rain.tilePositionX += 1; }
    this.fog.tilePositionX = cam.scrollX * 0.6 + t * 0.004;
    this.fog.tilePositionY = cam.scrollY * 0.6;

    if (!v.night) {
      this.dark.setVisible(false);
      return;
    }
    // Noite: escuro quase total, com o raio da lanterna e a luz da fogueira abertos na treva.
    const tex = this.darkTex;
    if (!tex) return;
    this.dark.setVisible(true);
    const c = tex.getContext();
    const wv = cam.worldView;
    const flick = 1 + Math.sin(t / 90) * 0.05 + Math.sin(t / 37) * 0.03;
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, tex.width, tex.height);
    c.fillStyle = "rgba(5,3,10,0.93)";
    c.fillRect(0, 0, tex.width, tex.height);
    c.globalCompositeOperation = "destination-out";
    const hole = (x: number, y: number, r: number) => {
      const g = c.createRadialGradient(x, y, r * 0.15, x, y, r);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.6, "rgba(0,0,0,0.7)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    hole(this.player.x - wv.x + 1, this.player.y - 8 - wv.y + 1, 34 * flick);
    if (this.flame && this.layout.firepit) hole(this.layout.firepit.x - wv.x + 1, this.layout.firepit.y - wv.y + 1, 58 * flick);
    tex.refresh();
  }

  private drawProgress() {
    const g = this.progress;
    g.clear();
    const p = this.view.pending;
    if (!p) return;
    const pct = Phaser.Math.Clamp((Date.now() - p.startMs) / Math.max(1, p.endMs - p.startMs), 0, 1);
    const x = this.player.x - 10, y = this.player.y - 24;
    g.fillStyle(0x05030a, 1).fillRect(x - 1, y - 1, 22, 5);
    g.fillStyle(0x3a1e2c, 1).fillRect(x, y, 20, 3);
    g.fillStyle(0xff4a5a, 1).fillRect(x, y, Math.round(20 * pct), 3);
  }
}

// ── Ícone de item no chão ────────────────────────────────────────────────────
function itemIcon(itemId: string) {
  const id = itemId.toLowerCase();
  if (/agua|garrafa|cantil/.test(id)) return "i-water";
  if (/band|kit|curat|remed|analg|gaze|antis|pastilh/.test(id)) return "i-med";
  if (/barra|lata|comid|biscoi|fruta|castan|racao|pao|choc/.test(id)) return "i-food";
  if (/mapa|diario|caderno|papel|carta|bilhete|foto/.test(id)) return "i-paper";
  if (/chave|canivete|faca|alavanca|pe_de_cabra|ferramenta/.test(id)) return "i-key";
  return "chest";
}

/** Escolhe um visual (1–25) estável para um personagem. */
export function spriteFor(id: string, avoid: number[] = []) {
  const pool = [5, 3, 25, 2, 13, 12, 17, 10, 14, 16, 18, 22, 1, 6, 4];
  let i = hashString(id) % pool.length;
  for (let k = 0; k < pool.length && avoid.includes(pool[i]); k++) i = (i + 1) % pool.length;
  return pool[i];
}

// ── Texturas desenhadas no código ────────────────────────────────────────────
function makeTextures(scene: Phaser.Scene) {
  const tex = scene.textures;
  const canvas = (key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
    if (tex.exists(key)) return;
    const ct = tex.createCanvas(key, w, h)!;
    const c = ct.getContext();
    c.imageSmoothingEnabled = false;
    draw(c);
    ct.refresh();
  };
  const R = (c: CanvasRenderingContext2D, col: string, x: number, y: number, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

  // Destroços do bimotor
  canvas("plane", 64, 32, (c) => {
    R(c, "rgba(0,0,0,0.35)", 6, 26, 54, 4);
    // asa partida
    for (let y = 0; y < 8; y++) R(c, "#1b1f24", 14 - y, 20 + y, 34, 1);
    for (let y = 1; y < 7; y++) R(c, "#b9bec2", 15 - y, 20 + y, 32, 1);
    R(c, "#8b9196", 8, 26, 30, 1);
    // fuselagem
    R(c, "#1b1f24", 6, 9, 50, 13);
    R(c, "#d7dadc", 7, 10, 48, 11);
    R(c, "#aeb3b7", 7, 18, 48, 3);
    R(c, "#2f5fa8", 7, 15, 48, 2);
    for (let x = 16; x < 48; x += 5) { R(c, "#22303f", x, 11, 3, 2); R(c, "#7fb2d9", x, 11, 1, 1); }
    // nariz e hélice torta
    R(c, "#1b1f24", 56, 11, 4, 9); R(c, "#d7dadc", 56, 12, 3, 7); R(c, "#7fb2d9", 52, 11, 3, 3);
    R(c, "#333", 60, 8, 2, 7); R(c, "#333", 61, 15, 2, 6);
    // cauda rasgada
    for (let y = 9; y < 22; y += 2) R(c, "#3a2e2e", 6 + ((y * 7) % 3), y, 3, 2);
    R(c, "#1b1f24", 0, 22, 12, 6); R(c, "#c9ccce", 1, 23, 10, 4); R(c, "#2f5fa8", 1, 25, 10, 1);
    // queimado
    for (const [x, y] of [[20, 17], [33, 12], [42, 18], [27, 19]]) { R(c, "rgba(30,24,20,0.8)", x, y, 4, 2); R(c, "rgba(30,24,20,0.6)", x + 1, y - 1, 2, 1); }
  });

  // Antena da estação
  canvas("antenna", 16, 64, (c) => {
    for (let y = 4; y < 64; y++) {
      const spread = Math.round(((y - 4) / 60) * 5);
      R(c, "#1b1f24", 7 - spread, y, 1, 1); R(c, "#1b1f24", 8 + spread, y, 1, 1);
      if (y % 6 === 0) R(c, "#7a8088", 7 - spread, y, spread * 2 + 2, 1);
    }
    for (let y = 6; y < 60; y += 6) { const s = Math.round(((y - 4) / 60) * 5); for (let i = 0; i < s * 2; i++) R(c, "#5c6269", 7 - s + i, y + Math.floor(i / 2) % 6, 1, 1); }
    R(c, "#9aa0a8", 5, 18, 6, 4); R(c, "#1b1f24", 7, 0, 2, 5);
  });

  // Barraca abandonada
  canvas("tent", 32, 24, (c) => {
    R(c, "rgba(0,0,0,0.35)", 2, 21, 29, 3);
    for (let y = 2; y < 22; y++) {
      const half = Math.round(((y - 2) / 20) * 15);
      R(c, "#1e2412", 16 - half - 1, y, half * 2 + 2, 1);
      R(c, "#5b6b3a", 16 - half, y, half, 1);
      R(c, "#4a5830", 16, y, half, 1);
    }
    for (let y = 9; y < 22; y++) { const hw = Math.round(((y - 9) / 13) * 4); R(c, "#16140f", 16 - hw, y, hw * 2 + 1, 1); }
    R(c, "#caa", 0, 21, 3, 1); R(c, "#caa", 29, 21, 3, 1);
  });

  // Pedras da fogueira
  canvas("firepit", 16, 16, (c) => {
    R(c, "#2b2522", 4, 9, 8, 4);
    R(c, "#6b4226", 3, 10, 10, 2); R(c, "#4e2f1a", 5, 9, 6, 1);
    for (const [x, y] of [[2, 8], [6, 7], [10, 8], [13, 10], [1, 11], [4, 13], [9, 13], [12, 12]]) { R(c, "#5a5f66", x, y, 3, 2); R(c, "#8a8f95", x, y, 2, 1); }
  });

  canvas("light", 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.75)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  canvas("shadow", 12, 5, (c) => { R(c, "rgba(0,0,0,0.35)", 2, 0, 8, 5); R(c, "rgba(0,0,0,0.35)", 0, 1, 12, 3); });
  canvas("marker", 7, 6, (c) => {
    R(c, "#05030a", 0, 0, 7, 3); R(c, "#05030a", 1, 3, 5, 2); R(c, "#05030a", 2, 5, 3, 1);
    R(c, "#ffd24a", 1, 1, 5, 1); R(c, "#ffd24a", 2, 2, 3, 1); R(c, "#ffd24a", 2, 3, 3, 1); R(c, "#ffd24a", 3, 4, 1, 1);
  });
  canvas("puff", 6, 6, (c) => { R(c, "rgba(110,110,120,0.9)", 1, 0, 4, 6); R(c, "rgba(110,110,120,0.9)", 0, 1, 6, 4); });
  canvas("spark", 2, 2, (c) => R(c, "#ffc860", 0, 0, 2, 2));
  canvas("rain", 64, 64, (c) => {
    for (let i = 0; i < 26; i++) {
      const x = (i * 37) % 64, y = (i * 23) % 64;
      R(c, "rgba(190,210,235,0.55)", x, y, 1, 4);
    }
  });
  canvas("fog", 256, 128, (c) => {
    for (let i = 0; i < 9; i++) {
      const x = (i * 71) % 256, y = (i * 43) % 128, r = 30 + (i % 3) * 14;
      const g = c.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, "rgba(210,215,230,0.55)");
      g.addColorStop(1, "rgba(210,215,230,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 256, 128);
    }
  });
}
