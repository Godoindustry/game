/**
 * Gera o cenário andável de cada local (grade de tiles 16×16), de forma
 * determinística: o mesmo local sempre tem a mesma cara. Não depende do Phaser
 * (dá para testar em Node). O motor (engine.ts) só desenha o resultado.
 *
 * Coordenadas: tiles (tx, ty) → pixels (tx*16, ty*16). Hotspots usam pixels.
 */

export const T = 16;
export const W = 32; // largura do mundo em tiles
export const H = 24; // altura do mundo em tiles
const COLS = 28; // colunas do tileset.png (448 / 16)

/** Índice de frame no tileset a partir de (coluna, linha). */
export const f = (cx: number, cy: number) => cy * COLS + cx;

/** Objetos do tileset: origem (coluna, linha), tamanho em tiles e quais linhas colidem (a partir de baixo). */
export const PROPS = {
  pine:       { cx: 6,  cy: 10, w: 2, h: 2, solidRows: 1 },
  round:      { cx: 0,  cy: 10, w: 2, h: 2, solidRows: 1 },
  dead:       { cx: 0,  cy: 28, w: 2, h: 2, solidRows: 1 },
  boulder:    { cx: 12, cy: 10, w: 2, h: 2, solidRows: 2 },
  stump:      { cx: 6,  cy: 18, w: 2, h: 2, solidRows: 1 },
  bush:       { cx: 9,  cy: 15, w: 1, h: 1, solidRows: 1 },
  bush2:      { cx: 0,  cy: 6,  w: 1, h: 1, solidRows: 1 },
  bush3:      { cx: 10, cy: 16, w: 1, h: 1, solidRows: 1 },
  grave:      { cx: 9,  cy: 7,  w: 1, h: 1, solidRows: 1 },
  cross:      { cx: 8,  cy: 7,  w: 1, h: 1, solidRows: 1 },
  stone:      { cx: 10, cy: 7,  w: 1, h: 1, solidRows: 1 },
  oval:       { cx: 1,  cy: 7,  w: 1, h: 1, solidRows: 1 },
  house:      { cx: 0,  cy: 0,  w: 4, h: 3, solidRows: 2 },
  stonehouse: { cx: 4,  cy: 0,  w: 4, h: 3, solidRows: 2 },
  hut:        { cx: 16, cy: 0,  w: 3, h: 2, solidRows: 1 },
  sign:       { cx: 14, cy: 8,  w: 1, h: 1, solidRows: 1 },
  crate:      { cx: 2,  cy: 6,  w: 1, h: 1, solidRows: 1 },
  box:        { cx: 11, cy: 4,  w: 1, h: 1, solidRows: 1 },
  pot:        { cx: 1,  cy: 6,  w: 1, h: 1, solidRows: 1 },
  fence:      { cx: 6,  cy: 27, w: 5, h: 1, solidRows: 1 },
  gate:       { cx: 6,  cy: 28, w: 5, h: 2, solidRows: 1 },
  lantern:    { cx: 11, cy: 27, w: 1, h: 2, solidRows: 1 },
  cave:       { cx: 8,  cy: 22, w: 3, h: 2, solidRows: 2 },
  well:       { cx: 3,  cy: 7,  w: 1, h: 1, solidRows: 1 },
} as const;
export type PropKey = keyof typeof PROPS;

/** Enfeites de chão (sem colisão). */
const DECOR = [f(0, 5), f(1, 8), f(4, 15), f(0, 18), f(1, 18), f(3, 12)];
const GRASS = f(22, 11);
const GRASS_DARK = f(23, 11);
const DIRT = f(21, 16);
const WATER = f(20, 8);
const PLANK = f(25, 8);
const VOID = -1; // abismo (desenhado em preto)
const CLIFF = [f(15, 14), f(16, 14), f(17, 14)];

/** Texturas desenhadas no código (engine.ts): destroços, antena, barraca, fogueira. */
export type CustomKey = "plane" | "antenna" | "tent" | "firepit";

export type HotspotKind = "search" | "wood" | "fire" | "camp" | "water" | "landmark" | "exit" | "grave" | "item" | "npc";

export interface Hotspot {
  id: string;
  kind: HotspotKind;
  x: number; // pixel (centro)
  y: number;
  label: string;
  to?: string; // saídas
}

export interface PlacedProp { key: PropKey; tx: number; ty: number }
export interface PlacedCustom { key: CustomKey; x: number; y: number; w: number; h: number } // pixels, âncora = base
export interface Exit { to: string; name: string; side: "N" | "S" | "L" | "O"; tx: number; ty: number }

export interface Layout {
  ground: number[][]; // frame por tile (VOID = abismo)
  decor: number[][]; // frame ou -1
  blocked: Uint8Array; // W*H
  props: PlacedProp[];
  customs: PlacedCustom[];
  hotspots: Hotspot[];
  exits: Exit[];
  spawn: { x: number; y: number };
  firepit: { x: number; y: number } | null;
  npcSpot: { x: number; y: number };
  itemSpots: { x: number; y: number }[];
}

export interface LayoutInput {
  locationId: string;
  terrain: string;
  name: string;
  x: number; // posição no mapa-múndi (%)
  y: number;
  water: boolean;
  neighbors: { to: string; name: string; x: number | null; y: number | null }[];
}

// ── RNG determinístico ──────────────────────────────────────────────────────
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashString = hash;

// ── Geração ─────────────────────────────────────────────────────────────────
export function buildLayout(input: LayoutInput): Layout {
  const r = rng(hash(input.locationId));
  const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const pick = <X,>(arr: readonly X[]) => arr[Math.floor(r() * arr.length)];

  const ground = Array.from({ length: H }, () => Array<number>(W).fill(GRASS));
  const decor = Array.from({ length: H }, () => Array<number>(W).fill(-1));
  const blocked = new Uint8Array(W * H);
  // "reserved": tiles que não recebem obstáculos aleatórios (trilhas, clareiras, hotspots).
  const reserved = new Uint8Array(W * H);
  const props: PlacedProp[] = [];
  const customs: PlacedCustom[] = [];
  const hotspots: Hotspot[] = [];
  const idx = (tx: number, ty: number) => ty * W + tx;
  const inside = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < W && ty < H;
  const block = (tx: number, ty: number) => inside(tx, ty) && (blocked[idx(tx, ty)] = 1);
  const reserve = (tx: number, ty: number, rad = 0) => {
    for (let y = ty - rad; y <= ty + rad; y++) for (let x = tx - rad; x <= tx + rad; x++) if (inside(x, y)) reserved[idx(x, y)] = 1;
  };
  const free = (tx: number, ty: number, w = 1, h = 1) => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (!inside(x, y) || blocked[idx(x, y)] || reserved[idx(x, y)]) return false;
    return true;
  };
  const place = (key: PropKey, tx: number, ty: number, force = false) => {
    const p = PROPS[key];
    if (!force && !free(tx, ty, p.w, p.h)) return false;
    props.push({ key, tx, ty });
    for (let y = ty + p.h - p.solidRows; y < ty + p.h; y++) for (let x = tx; x < tx + p.w; x++) block(x, y);
    return true;
  };
  const px = (t: number) => t * T + T / 2;

  // Variação do gramado
  for (let ty = 0; ty < H; ty++)
    for (let tx = 0; tx < W; tx++) {
      const n = Math.sin(tx * 0.45 + input.x) + Math.cos(ty * 0.5 + input.y) + r() * 0.6;
      if (n > 1.2) ground[ty][tx] = GRASS_DARK;
    }

  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  const t = input.terrain;
  const treeKinds: PropKey[] =
    t === "mata" ? ["pine", "pine", "round", "dead"] :
    t === "trilha" || t === "penhasco" || t === "rochedo" ? ["dead", "dead", "pine", "boulder"] :
    t === "estação" ? ["dead", "pine", "dead"] :
    t === "lago" || t === "córrego" ? ["round", "pine", "round"] :
    ["pine", "round", "dead"];

  // ── Saídas: lado do mapa conforme a direção real do vizinho ──
  const exits: Exit[] = [];
  const usedBySide: Record<string, number[]> = { N: [], S: [], L: [], O: [] };
  for (const n of input.neighbors) {
    const dx = (n.x ?? input.x + 10) - input.x;
    const dy = (n.y ?? input.y) - input.y;
    let side: Exit["side"];
    if (Math.abs(dx) > Math.abs(dy)) side = dx > 0 ? "L" : "O";
    else side = dy > 0 ? "S" : "N";
    // No mirante o norte é abismo: a saída vai para a lateral.
    if (input.terrain === "penhasco" && side === "N") side = dx >= 0 ? "L" : "O";
    const horizontal = side === "N" || side === "S";
    const len = horizontal ? W : H;
    const ratio = horizontal ? 0.5 + (dx / (Math.abs(dy) + 1e-3)) * 0.25 : 0.5 + (dy / (Math.abs(dx) + 1e-3)) * 0.25;
    let pos = Math.round(Math.min(len - 5, Math.max(4, ratio * len)));
    while (usedBySide[side].some((p) => Math.abs(p - pos) < 6)) pos = pos + 6 < len - 4 ? pos + 6 : pos - 12;
    pos = Math.min(len - 5, Math.max(input.terrain === "penhasco" && !horizontal ? 8 : 4, pos));
    usedBySide[side].push(pos);
    const tx = side === "L" ? W - 1 : side === "O" ? 0 : pos;
    const ty = side === "S" ? H - 1 : side === "N" ? 0 : pos;
    exits.push({ to: n.to, name: n.name, side, tx, ty });
  }

  // Trilhas de terra do centro até cada saída (reservadas para não virar mato).
  const carve = (x0: number, y0: number, x1: number, y1: number) => {
    let x = x0, y = y0;
    let guard = 200;
    while ((x !== x1 || y !== y1) && guard-- > 0) {
      for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) if (inside(x + ox, y + oy)) { ground[y + oy][x + ox] = DIRT; reserve(x + ox, y + oy); }
      if (x !== x1 && (y === y1 || r() < 0.55)) x += Math.sign(x1 - x);
      else if (y !== y1) y += Math.sign(y1 - y);
    }
    for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) if (inside(x + ox, y + oy)) { ground[y + oy][x + ox] = DIRT; reserve(x + ox, y + oy); }
  };
  for (const e of exits) {
    const ex = Math.min(W - 2, e.tx), ey = Math.min(H - 2, e.ty);
    carve(cx - 1, cy + 1, ex, ey);
    reserve(e.tx, e.ty, 2);
  }

  // Clareira central
  for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 4; x <= cx + 4; x++) reserve(x, y);

  // ── Terreno específico ──
  let firepit: Layout["firepit"] = null;
  let landmark = { x: px(cx), y: px(cy - 3), label: "Examinar a área" };
  const spots = {
    search: [] as { x: number; y: number; label: string }[],
    wood: null as null | { x: number; y: number },
    camp: null as null | { x: number; y: number; label: string },
    water: null as null | { x: number; y: number; label: string },
  };
  let npcSpot = { x: px(cx + 3), y: px(cy - 1) };

  const addWaterStrip = (rowY: number) => {
    // Córrego atravessando o mapa de oeste a leste, com uma ponte no meio.
    for (let x = 0; x < W; x++) {
      for (let y = rowY; y < rowY + 3; y++) {
        const bridge = x >= cx - 1 && x <= cx + 1;
        ground[y][x] = bridge ? PLANK : WATER;
        if (!bridge) block(x, y);
        reserve(x, y);
      }
    }
  };

  switch (t) {
    case "destroços": {
      customs.push({ key: "plane", x: px(cx) - 8, y: px(cy - 2) + 8, w: 64, h: 32 });
      for (let x = cx - 5; x <= cx + 2; x++) block(x, cy - 3);
      for (let x = cx - 4; x <= cx + 1; x++) block(x, cy - 2);
      landmark = { x: px(cx + 3), y: px(cy - 1), label: "Os destroços" };
      place("crate", cx - 6, cy + 3, true);
      place("box", cx + 5, cy + 2, true);
      place("pot", cx - 7, cy + 1, true);
      spots.search.push({ x: px(cx - 6), y: px(cy + 4), label: "Caixas espalhadas" }, { x: px(cx - 2), y: px(cy - 1), label: "Compartimento de carga" });
      spots.wood = { x: px(cx + 7), y: px(cy + 4) };
      place("dead", cx + 7, cy + 2, true);
      break;
    }
    case "mata": {
      landmark = { x: px(cx), y: px(cy - 2), label: "Mata fechada" };
      spots.search.push({ x: px(cx - 4), y: px(cy + 2), label: "Arbustos" }, { x: px(cx + 5), y: px(cy - 2), label: "Raízes e folhas" });
      place("bush", cx - 5, cy + 2, true); place("bush3", cx - 4, cy + 3, true);
      place("stump", cx + 5, cy - 4, true);
      spots.wood = { x: px(cx + 5), y: px(cy - 2) };
      // Pequeno cemitério esquecido na mata
      for (let i = 0; i < 4; i++) place(i % 2 ? "cross" : "grave", cx - 9 + i * 2, cy - 5, true);
      place("lantern", cx - 10, cy - 6, true);
      hotspots.push({ id: "grave", kind: "grave", x: px(cx - 6), y: px(cy - 4), label: "Túmulos sem nome" });
      break;
    }
    case "acampamento": {
      customs.push({ key: "tent", x: px(cx - 3), y: px(cy - 1) + 8, w: 32, h: 24 });
      block(cx - 4, cy - 1); block(cx - 3, cy - 1); block(cx - 2, cy - 1);
      spots.camp = { x: px(cx - 3), y: px(cy + 1), label: "Barraca" };
      firepit = { x: px(cx + 2), y: px(cy + 1) };
      place("crate", cx + 5, cy - 2, true); place("pot", cx + 6, cy - 2, true);
      spots.search.push({ x: px(cx + 5), y: px(cy - 1), label: "Caixotes do acampamento" });
      spots.wood = { x: px(cx - 7), y: px(cy + 3) };
      place("stump", cx - 8, cy + 1, true);
      landmark = { x: px(cx), y: px(cy - 2), label: "Acampamento" };
      break;
    }
    case "trilha": {
      landmark = { x: px(cx + 2), y: px(cy - 3), label: "Marcas na trilha" };
      place("boulder", cx + 3, cy - 5, true); place("boulder", cx - 6, cy - 4, true);
      spots.search.push({ x: px(cx - 5), y: px(cy - 2), label: "Entre as pedras" });
      spots.wood = { x: px(cx + 6), y: px(cy + 3) };
      place("dead", cx + 6, cy + 1, true);
      place("cross", cx - 2, cy - 4, true);
      break;
    }
    case "córrego": {
      addWaterStrip(cy - 1);
      spots.water = { x: px(cx - 4), y: px(cy + 2) + 4, label: "Margem do córrego" };
      spots.search.push({ x: px(cx + 6), y: px(cy + 4), label: "Margem de pedras" });
      place("oval", cx + 7, cy + 5, true);
      spots.wood = { x: px(cx - 7), y: px(cy - 4) };
      place("dead", cx - 8, cy - 6, true);
      landmark = { x: px(cx), y: px(cy - 3), label: "A ponte" };
      break;
    }
    case "lago": {
      // Poço escuro: lago 9-slice
      const lx = cx - 3, ly = cy - 5, lw = 7, lh = 4;
      for (let y = 0; y < lh; y++)
        for (let x = 0; x < lw; x++) {
          const cxs = x === 0 ? 19 : x === lw - 1 ? 21 : 20;
          const cys = y === 0 ? 7 : y === lh - 1 ? 9 : 8;
          ground[ly + y][lx + x] = f(cxs, cys);
          block(lx + x, ly + y);
          reserve(lx + x, ly + y);
        }
      spots.water = { x: px(cx), y: px(ly + lh) + 4, label: "Beira do poço" };
      spots.search.push({ x: px(cx + 6), y: px(cy + 2), label: "Juncos" });
      place("bush2", cx + 7, cy + 2, true);
      spots.wood = { x: px(cx - 7), y: px(cy + 3) };
      place("stump", cx - 8, cy + 1, true);
      landmark = { x: px(cx - 4), y: px(cy), label: "Água parada" };
      break;
    }
    case "estação": {
      place("stonehouse", cx - 2, cy - 7, true);
      customs.push({ key: "antenna", x: px(cx + 4), y: px(cy - 5) + 8, w: 16, h: 64 });
      block(cx + 4, cy - 5);
      // Cerca de ferro com portão
      place("fence", cx - 8, cy - 3, true); place("gate", cx - 3, cy - 4, true); place("fence", cx + 2, cy - 3, true);
      for (let x = cx - 3; x <= cx + 1; x++) blocked[idx(x, cy - 3)] = x === cx - 1 ? 0 : 1;
      npcSpot = { x: px(cx + 1), y: px(cy - 5) };
      landmark = { x: px(cx - 1), y: px(cy - 2), label: "Portão da estação" };
      spots.search.push({ x: px(cx + 6), y: px(cy + 1), label: "Galpão de ferramentas" });
      place("box", cx + 6, cy, true); place("crate", cx + 7, cy, true);
      spots.wood = { x: px(cx - 7), y: px(cy + 3) };
      place("dead", cx - 8, cy + 1, true);
      break;
    }
    case "penhasco": {
      // Abismo ao norte
      for (let y = 0; y < 6; y++) for (let x = 0; x < W; x++) { ground[y][x] = y === 5 ? CLIFF[x % 3] : VOID; block(x, y); reserve(x, y); }
      landmark = { x: px(cx), y: px(7), label: "Beira do abismo" };
      spots.search.push({ x: px(cx - 6), y: px(cy + 2), label: "Pedras soltas" });
      place("boulder", cx - 8, cy + 1, true);
      spots.wood = { x: px(cx + 6), y: px(cy + 3) };
      place("dead", cx + 6, cy + 1, true);
      break;
    }
    case "rochedo": {
      place("boulder", cx - 1, cy - 5, true); place("boulder", cx + 2, cy - 6, true); place("stone", cx + 1, cy - 3, true);
      landmark = { x: px(cx + 1), y: px(cy - 2), label: "O marco de pedra" };
      spots.search.push({ x: px(cx - 5), y: px(cy + 2), label: "Fendas na rocha" });
      place("boulder", cx - 7, cy, true);
      place("cave", cx + 6, cy + 1, true);
      break;
    }
    default: {
      spots.search.push({ x: px(cx - 4), y: px(cy + 2), label: "Arredores" });
    }
  }

  // Lugar para fogueira e abrigo em qualquer local que não tenha um próprio.
  if (!firepit) firepit = { x: px(cx + 2), y: px(cy + 2) };
  if (!spots.camp) spots.camp = { x: px(cx - 3), y: px(cy + 2), label: "Lugar para abrigo" };
  if (input.water && !spots.water) spots.water = { x: px(cx), y: px(cy + 4), label: "Água" };

  hotspots.push({ id: "landmark", kind: "landmark", ...landmark });
  spots.search.forEach((s, i) => hotspots.push({ id: `search-${i}`, kind: "search", ...s }));
  if (spots.wood) hotspots.push({ id: "wood", kind: "wood", ...spots.wood, label: "Galhos secos" });
  hotspots.push({ id: "fire", kind: "fire", ...firepit, label: "Fogueira" });
  hotspots.push({ id: "camp", kind: "camp", ...spots.camp });
  if (spots.water) hotspots.push({ id: "water", kind: "water", ...spots.water });
  for (const h of hotspots) reserve(Math.floor(h.x / T), Math.floor(h.y / T), 1);
  customs.push({ key: "firepit", x: firepit.x, y: firepit.y + 8, w: 16, h: 16 });

  // ── Borda de árvores (2 tiles), com vãos nas saídas ──
  const nearExit = (tx: number, ty: number) => exits.some((e) => Math.abs(e.tx - tx) <= 2 && Math.abs(e.ty - ty) <= 2);
  for (let ty = -1; ty < H; ty += 2)
    for (let tx = -1; tx < W; tx += 2) {
      const edge = tx <= 1 || ty <= 1 || tx >= W - 3 || ty >= H - 3;
      if (!edge) continue;
      if (nearExit(tx, ty) || nearExit(tx + 1, ty + 1)) continue;
      if (t === "penhasco" && ty < 6) continue;
      place(pick(treeKinds), tx, ty, true);
    }
  // Bloqueia a moldura externa (menos as saídas), mesmo onde não coube árvore.
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) if (!nearExit(x, y)) block(x, y);
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) if (!nearExit(x, y)) block(x, y);

  // ── Mato e enfeites aleatórios ──
  const density = t === "mata" ? 40 : t === "penhasco" || t === "rochedo" ? 12 : 20;
  for (let i = 0; i < density; i++) {
    const tx = ri(2, W - 4), ty = ri(2, H - 4);
    place(pick(i % 3 === 0 ? ["boulder", "oval"] as PropKey[] : treeKinds.concat(["bush", "bush2", "bush3"] as PropKey[])), tx, ty);
  }
  for (let i = 0; i < 70; i++) {
    const tx = ri(1, W - 2), ty = ri(1, H - 2);
    if (ground[ty][tx] === GRASS || ground[ty][tx] === GRASS_DARK) if (!blocked[idx(tx, ty)]) decor[ty][tx] = pick(DECOR);
  }

  // Placas de saída (logo para dentro do vão)
  for (const e of exits) {
    const sx = e.side === "L" ? W - 3 : e.side === "O" ? 2 : e.tx + 2;
    const sy = e.side === "S" ? H - 3 : e.side === "N" ? 2 : e.ty + 2;
    if (inside(sx, sy) && !blocked[idx(sx, sy)]) place("sign", sx, sy, true);
    hotspots.push({ id: `exit-${e.to}`, kind: "exit", x: px(e.tx), y: px(e.ty), label: e.name, to: e.to });
  }

  // Posições para itens no chão (em volta da clareira) e para chegar.
  const itemSpots: { x: number; y: number }[] = [];
  for (let i = 0; i < 24 && itemSpots.length < 12; i++) {
    const tx = ri(cx - 5, cx + 5), ty = ri(cy - 1, cy + 4);
    if (!blocked[idx(tx, ty)] && !hotspots.some((h) => Math.abs(h.x - px(tx)) < 18 && Math.abs(h.y - px(ty)) < 18)) itemSpots.push({ x: px(tx), y: px(ty) });
  }

  return { ground, decor, blocked, props, customs, hotspots, exits, spawn: { x: px(cx), y: px(cy + 2) }, firepit, npcSpot, itemSpots };
}

/** Ponto logo para dentro de uma saída (onde o jogador aparece ao chegar por ela). */
export function entryPoint(e: Exit) {
  const x = e.side === "L" ? W - 3 : e.side === "O" ? 2 : e.tx;
  const y = e.side === "S" ? H - 3 : e.side === "N" ? 2 : e.ty;
  return { x: x * T + T / 2, y: y * T + T / 2 };
}

export function isBlocked(l: Layout, x: number, y: number) {
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
  return l.blocked[ty * W + tx] === 1;
}
