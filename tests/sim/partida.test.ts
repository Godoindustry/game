/* eslint-disable @typescript-eslint/no-explicit-any -- o robô lê o JSON da API como a tela lê, sem tipar cada campo */
/**
 * Simulação de partidas completas com 1 a 4 jogadores-robô, pela API real (SQLite em memória).
 * Não roda na suíte normal: `SIM=1 npx vitest run tests/sim` (relatório em SIM_OUT ou no console).
 *
 * Cada robô lê o próprio estado como a tela lê: responde eventos (rolando o D20 no "aparelho"),
 * cuida do corpo (sangue, sede, fome, frio, sono), pega itens e segue a bússola de objetivo.
 * Tudo o que parecer defeito vira uma anotação no relatório.
 */
import { describe, it } from "vitest";
import fs from "node:fs";
import { act, freshApp, registered, VALID_SHEET, type Client } from "../helpers";
import { resetRateLimits } from "@/server/http/core";
import { getDb } from "@/server/db/database";
import { loadCampaignCharacters, saveCharacter } from "@/server/services/stateRepo";
import { addItem } from "@/server/engine/inventory";
import { VALE_SILENTE } from "@/server/content/valeSilente";
import { randomUUID } from "node:crypto";

const RUN = !!process.env.SIM;
const MAX_ROUNDS = Number(process.env.SIM_ROUNDS ?? 450);
const SEEDS = (process.env.SIM_SEEDS ?? "alfa,bravo,charlie").split(",");
const COUNTS = (process.env.SIM_PLAYERS ?? "1,2,3,4").split(",").map(Number);

type S = any; // estado do cliente (formato de getState)

interface Bot {
  name: string;
  client: Client;
  rnd: () => number;
  lastObjective: string;
  objectiveSince: number;
  visits: Record<string, number>;
  talked: boolean;
  lastLoc: string;
  waterSpots: Set<string>;
}

interface Report {
  players: number;
  seed: string;
  rounds: number;
  minutes: number;
  ending: string | null;
  deaths: string[];
  awakenedRound: number | null;
  reunitedRound: number | null;
  events: Record<string, number>;
  actions: Record<string, number>;
  rolls: number;
  issues: Record<string, { count: number; example: string }>;
  finalLocations: string[];
  progress: string;
  objectivesEnd: string[];
  timeline: string[];
}

function mulberry(seedStr: string) {
  let a = [...seedStr].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHEETS = [
  { name: "Ana Ribeiro", profession: "enfermagem" },
  { name: "Bruno Tavo", profession: "mecanico", sex: "masculino" },
  { name: "Carla Guia", profession: "guia" },
  { name: "Davi Atleta", profession: "atleta", sex: "masculino" },
];

function note(r: Report, key: string, example: string) {
  const it = (r.issues[key] ??= { count: 0, example });
  it.count++;
}

const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object |\bnull\b(?!\s*\))/;

function scanState(r: Report, bot: Bot, s: S) {
  const texts: string[] = [];
  for (const l of s.log ?? []) texts.push(l.text);
  if (s.event) {
    texts.push(s.event.title, s.event.body);
    for (const c of s.event.choices) texts.push(c.label, c.reason ?? "");
  }
  if (s.objective) texts.push(s.objective.label, s.objective.hint);
  if (s.urgent) texts.push(s.urgent.label, s.urgent.hint);
  for (const t of texts) if (t && BAD_TEXT.test(t)) note(r, "Texto quebrado na tela (undefined/NaN/null)", `${bot.name}: ${t.slice(0, 160)}`);
  for (const t of texts) if (t && /\[(whispers|pause|gasps|sighs|long pause|slowly|serious|nervous)\]/.test(t)) note(r, "Tag de voz aparecendo no texto da tela", `${bot.name}: ${t.slice(0, 120)}`);
  const me = s.me;
  if (me) {
    for (const [k, v] of Object.entries(me.status ?? {})) if (typeof v === "number" && !Number.isFinite(v)) note(r, "Número inválido na ficha", `${bot.name} status.${k}=${v}`);
    for (const [k, v] of Object.entries(me.health ?? {})) if (typeof v === "number" && !Number.isFinite(v)) note(r, "Número inválido na ficha", `${bot.name} health.${k}=${v}`);
    if (me.alive && s.campaign.status === "active" && !s.pending) {
      const anything =
        (s.event?.participating && s.event.choices.some((c: any) => c.available)) ||
        s.here.actions.some((a: any) => a.available) ||
        s.map.travel.some((t: any) => t.available);
      if (!anything) note(r, "Jogador sem nenhuma ação possível (trava)", `${bot.name} em ${s.here.name}, evento=${s.event?.id ?? "-"}`);
    }
    if (s.event?.participating && !s.pending && !s.event.choices.some((c: any) => c.available)) {
      note(r, "Evento sem nenhuma escolha disponível", `${bot.name}: ${s.event.id} (${s.event.choices.map((c: any) => c.reason).join(" | ")})`);
    }
    if (s.event && !s.event.participating && s.here.actions.length === 0) {
      note(r, "Fora do evento do outro, mas sem ações livres", `${bot.name}: evento ${s.event.id}`);
    }
  }
}

/** Próximo passo até o alvo: BFS pelas ligações conhecidas; senão, o vizinho mais perto em linha reta. */
function stepToward(s: S, target: string | null, bearingTo: { x: number; y: number } | null): string | null {
  const here = s.here.locationId;
  const open = s.map.travel.filter((t: any) => t.available);
  if (!open.length || !target || target === here) return null;
  const adj = new Map<string, string[]>();
  for (const l of s.map.links) {
    (adj.get(l.from) ?? adj.set(l.from, []).get(l.from)!).push(l.to);
    (adj.get(l.to) ?? adj.set(l.to, []).get(l.to)!).push(l.from);
  }
  const prev = new Map<string, string>([[here, here]]);
  const q = [here];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === target) break;
    for (const n of adj.get(cur) ?? []) if (!prev.has(n)) { prev.set(n, cur); q.push(n); }
  }
  if (prev.has(target)) {
    let cur = target;
    while (prev.get(cur) !== here) cur = prev.get(cur)!;
    if (open.some((t: any) => t.to === cur)) return cur;
  }
  if (!bearingTo) return null;
  const locs = new Map(s.map.locations.map((l: any) => [l.id, l]));
  const d = (id: string) => { const l: any = locs.get(id); return l ? Math.hypot(l.x - bearingTo.x, l.y - bearingTo.y) : 1e9; };
  const best = [...open].sort((a: any, b: any) => d(a.to) - d(b.to))[0];
  const hereLoc: any = locs.get(here);
  return best && hereLoc && d(best.to) < Math.hypot(hereLoc.x - bearingTo.x, hereLoc.y - bearingTo.y) ? best.to : null;
}

/** A decisão do robô para esta rodada. */
function decide(bot: Bot, s: S): { type: string; params: Record<string, unknown>; why: string } {
  const me = s.me;
  const pick = <T,>(xs: T[]) => xs[Math.floor(bot.rnd() * xs.length)];
  const avail = (t: string) => s.here.actions.find((a: any) => a.type === t && a.available);
  const itemAct = (t: string, filter: (i: any) => boolean = () => true) => {
    for (const i of me.inventory) if (filter(i)) for (const a of i.actions) if (a.type === t && a.available) return a;
    return null;
  };

  // 1) Sangrando: estanca primeiro (vale até no meio de um evento).
  for (const w of me.wounds) {
    if (w.bleedingRate > 0) {
      const opt = w.care?.find((o: any) => o.material === "atadura" && o.available);
      if (opt) return { type: "tratar_ferimento", params: { woundId: w.id, material: "atadura" }, why: "sangrando" };
    }
  }

  // 1b) Grupo: enfaixa quem está junto e divide comida/água de vez em quando.
  for (const it of me.inventory) {
    for (const f of it.friends ?? []) {
      if (!f.useOn?.available) continue;
      if (it.itemId === "atadura" && bot.rnd() < 0.6) return { type: "usar_em_amigo", params: { inventoryItemId: it.id, targetCharacterId: f.characterId }, why: `enfaixar ${f.name}` };
      if ((it.category === "comida" || it.category === "agua") && it.quantity > 1 && bot.rnd() < 0.15) {
        return { type: "usar_em_amigo", params: { inventoryItemId: it.id, targetCharacterId: f.characterId }, why: `dividir ${it.name} com ${f.name}` };
      }
    }
    if (it.category === "comida" && it.quantity > 2) {
      const f = (it.friends ?? []).find((x: any) => x.give?.available);
      if (f && bot.rnd() < 0.1) return { type: "dar_item", params: { inventoryItemId: it.id, targetCharacterId: f.characterId }, why: `passar ${it.name} para ${f.name}` };
    }
  }

  // 2) Evento: escolhe (preferindo o que não é seguro às vezes, para variar a história).
  if (s.event?.participating) {
    const choices = s.event.choices.filter((c: any) => c.available);
    // SIM_SMART: joga para vencer — evita adiar/fugir e prefere a maior chance no D20.
    const smart = () => {
      // A escolha segura (a de adiar) é a última da lista: o robô focado só a usa se não houver outra.
      const all = s.event.choices;
      const bold = choices.filter((x: any) => x.id !== all[all.length - 1].id && !/deixar|depois|fugir|ignorar|afastar|silêncio|imóvel|recuar|por enquanto|sair devagar/i.test(x.label));
      const pool = bold.length ? bold : choices;
      // A ação principal costuma vir primeiro; entre as com dado, evita as de chance muito baixa.
      return pool.find((x: any) => !x.roll || x.roll.chance >= 35) ?? pool[0];
    };
    const c = process.env.SIM_SMART ? smart() : bot.rnd() < 0.7 ? pick(choices) : choices[choices.length - 1];
    const params: Record<string, unknown> = { choiceId: c.id };
    if (c.roll?.client) params.d20 = [1 + Math.floor(bot.rnd() * 20), 1 + Math.floor(bot.rnd() * 20)].slice(0, c.roll.disadvantage ? 2 : 1);
    return { type: "escolha_evento", params, why: `evento ${s.event.id}${c.roll ? " (d20)" : ""}` };
  }

  // 3) Corpo.
  const st = me.status;
  if (s.here.water) bot.waterSpots.add(s.here.locationId);
  const cleanWater = me.inventory.some((i: any) => i.actions.some((a: any) => a.type === "beber") && !i.contaminated);
  const anyWater = me.inventory.some((i: any) => i.actions.some((a: any) => a.type === "beber"));
  if (st.thirst >= 50) {
    const drink = itemAct("beber", (i) => !i.contaminated) ?? itemAct("purificar_agua") ?? itemAct("ferver_agua");
    if (drink) return { type: drink.type, params: drink.params, why: "sede" };
    const fonte = avail("beber_fonte");
    if (fonte && (s.here.water === "rain" || st.thirst >= 65)) return { type: "beber_fonte", params: {}, why: "beber da fonte" };
    if (st.thirst >= 70) { const dirty = itemAct("beber"); if (dirty) return { type: "beber", params: dirty.params, why: "sede forte (água suja)" }; }
  }
  // Garrafa vazia perto da água: enche sempre (reserva).
  const fill = itemAct("coletar_agua");
  if (fill && (st.thirst >= 30 || !anyWater)) return { type: fill.type, params: fill.params, why: "encher garrafa" };
  if (st.thirst >= 60 && !cleanWater && !(st.thirst < 70 && anyWater) && !s.here.water) {
    let next: string | null = null;
    for (const w of bot.waterSpots) { const loc = s.map.locations.find((l: any) => l.id === w); next = stepToward(s, w, loc ? { x: loc.x, y: loc.y } : null); if (next) break; }
    if (next) return { type: "mover", params: { to: next }, why: "ir buscar água" };
    const unknown = s.map.travel.filter((t: any) => t.available).sort((a: any, b: any) => (bot.visits[a.to] ?? 0) - (bot.visits[b.to] ?? 0))[0];
    if (unknown) return { type: "mover", params: { to: unknown.to }, why: "procurar água" };
  }
  // Frio mata mais rápido que fome: fogo/abrigo primeiro; sem lenha aqui, vai onde tem.
  if (st.bodyTemp < 35.8) {
    for (const t of ["acender_fogueira", "montar_abrigo", "coletar_lenha"]) { const a = avail(t); if (a) return { type: t, params: a.params, why: "frio" }; }
    if (!s.here.sheltered) {
      const warm = s.map.locations.find((l: any) => l.id !== s.here.locationId && (l.resources ?? []).some((r: any) => r.key === "lenha" || r.key === "abrigo"));
      const next = warm ? stepToward(s, warm.id, { x: warm.x, y: warm.y }) : null;
      if (next) return { type: "mover", params: { to: next }, why: `frio → ${warm.name}` };
    }
  }
  if (st.hunger >= 55) {
    const eat = itemAct("comer"); if (eat) return { type: "comer", params: eat.params, why: "fome" };
    // Faminto num lugar sem frutos: vai para o mais perto que o aviso aponta.
    const forageHere = (s.here.resources ?? []).some((r: any) => r.key === "frutos");
    if (st.hunger >= 70 && !forageHere) {
      const spot = s.map.locations.find((l: any) => (l.resources ?? []).some((r: any) => r.key === "frutos") && l.id !== s.here.locationId);
      const next = spot ? stepToward(s, spot.id, { x: spot.x, y: spot.y }) : null;
      if (next) return { type: "mover", params: { to: next }, why: `buscar frutos em ${spot.name}` };
    }
    if (st.hunger >= 70) { const search = avail("procurar"); if (search) return { type: "procurar", params: {}, why: "procurar comida" }; }
  }
  if (st.bodyTemp < 35.8) {
    for (const t of ["acender_fogueira", "montar_abrigo", "coletar_lenha"]) { const a = avail(t); if (a) return { type: t, params: a.params, why: "frio" }; }
  }
  if (st.pain >= 60) { const pk = itemAct("tomar_analgesico"); if (pk) return { type: "tomar_analgesico", params: {}, why: "dor" }; }
  for (const w of me.wounds) {
    const opt = w.care?.find((o: any) => o.available);
    if (opt && bot.rnd() < 0.5) return { type: "tratar_ferimento", params: { woundId: w.id, material: opt.material }, why: `cuidar ferida (${opt.material})` };
  }
  if (st.fatigue >= 95 && !s.here.actions.some((a: any) => a.type === "dormir" && a.available)) { /* sem cama: segue */ }
  if (st.fatigue >= 80 || st.energy < 20) {
    const sleep = s.here.actions.find((a: any) => a.type === "dormir" && a.available && a.params.hours === 4) ?? avail("descansar");
    if (sleep) return { type: sleep.type, params: sleep.params, why: "cansaço" };
  }

  // 4) Itens no chão (os leves primeiro) e conversa com NPC uma vez.
  const ground = s.here.ground.filter((g: any) => g.available).sort((a: any, b: any) => a.weightG - b.weightG)[0];
  if (ground && bot.rnd() < 0.6) return { type: "pegar_item", params: { groundItemId: ground.id }, why: `pegar ${ground.name}` };
  if (s.here.npc && !bot.talked) {
    bot.talked = true;
    return { type: "conversar", params: { message: "Quem é você? O que aconteceu aqui? Precisamos sair do vale." }, why: "conversar NPC" };
  }

  // 5) Poderes de vez em quando.
  const power = me.power?.actions?.filter((a: any) => a.available) ?? [];
  if (power.length && bot.rnd() < 0.08) { const p = pick(power) as any; return { type: p.type, params: p.params, why: `poder ${p.label}` }; }

  // 6) Objetivo.
  const obj = s.objective;
  const target = obj?.targetLocationId ?? null;
  if (target && target !== s.here.locationId) {
    const next = stepToward(s, target, obj?.bearing?.to ?? null);
    if (next) return { type: "mover", params: { to: next }, why: `objetivo → ${obj.targetName}` };
  }
  // No alvo (ou sem alvo): explora o local; às vezes anda para um vizinho pouco visitado.
  const here = s.here.locationId;
  bot.visits[here] = (bot.visits[here] ?? 0) + 1;
  const examine = avail("examinar"), search = avail("procurar");
  if (target === here) {
    if (bot.visits[here] % 3 === 1 && examine) return { type: "examinar", params: {}, why: "examinar no alvo" };
    if (search && bot.rnd() < 0.6) return { type: "procurar", params: {}, why: "procurar no alvo" };
    const wait = avail("esperar");
    if (wait) return { type: "esperar", params: {}, why: "esperar no alvo" };
  }
  if (bot.rnd() < 0.35) {
    const open = s.map.travel.filter((t: any) => t.available).sort((a: any, b: any) => (bot.visits[a.to] ?? 0) - (bot.visits[b.to] ?? 0));
    if (open[0]) return { type: "mover", params: { to: open[0].to }, why: "explorar" };
  }
  if (examine && bot.rnd() < 0.4) return { type: "examinar", params: {}, why: "examinar" };
  if (search) return { type: "procurar", params: {}, why: "procurar" };
  const any = s.here.actions.find((a: any) => a.available);
  if (any) return { type: any.type, params: any.params, why: "qualquer" };
  const mv = s.map.travel.find((t: any) => t.available);
  if (mv) return { type: "mover", params: { to: mv.to }, why: "sem ação local" };
  return { type: "esperar", params: {}, why: "nada" };
}

async function simulate(players: number, seed: string): Promise<Report> {
  await freshApp({ FIXED_SEED: `sim-${seed}`, ROUND_TIMEOUT_SECONDS: 300 });
  const r: Report = {
    players, seed, rounds: 0, minutes: 0, ending: null, deaths: [], awakenedRound: null, reunitedRound: null,
    events: {}, actions: {}, rolls: 0, issues: {}, finalLocations: [], objectivesEnd: [], timeline: [], progress: "",
  };
  const bots: Bot[] = [];
  for (let i = 0; i < players; i++) {
    const u = await registered(SHEETS[i].name.split(" ")[0]);
    bots.push({ name: SHEETS[i].name, client: u.client, rnd: mulberry(`${seed}:${i}`), lastObjective: "", objectiveSince: 0, visits: {}, talked: false, lastLoc: "", waterSpots: new Set(["abrigo", "ponte", "lago"]) }); // a dica de sede diz: "Córrego e poço têm água"
  }
  const owner = bots[0].client;
  const camp = await owner.post("/api/campaigns", { name: `Sim ${players}p ${seed}`, mode: players === 1 ? "solo" : "coop" });
  const id = camp.body.id as string;
  for (const b of bots.slice(1)) {
    const inv = await owner.post(`/api/campaigns/${id}/invites`);
    const acc = await b.client.post("/api/invites/accept", { code: inv.body.code });
    if (acc.status !== 200) note(r, "Falha ao aceitar convite", JSON.stringify(acc.body));
  }
  for (let i = 0; i < players; i++) {
    const ch = await bots[i].client.post(`/api/campaigns/${id}/character`, { ...VALID_SHEET, ...SHEETS[i] });
    if (ch.status !== 200) note(r, "Falha ao criar personagem", `${SHEETS[i].name}: ${JSON.stringify(ch.body)}`);
  }
  const start = await owner.post(`/api/campaigns/${id}/start`);
  if (start.status !== 200) { note(r, "Falha ao iniciar", JSON.stringify(start.body)); return r; }

  // SIM_FARTURA=1: tira fome/sede da equação para achar travas de HISTÓRIA.
  if (process.env.SIM_FARTURA) {
    for (const ch of await loadCampaignCharacters(id)) {
      for (const [item, qty] of [["biscoito", 4], ["sardinha", 6], ["garrafa_agua", 4], ["atadura", 4], ["pastilhas", 2]] as const) addItem(ch, VALE_SILENTE, randomUUID, item, qty);
      await saveCharacter(ch);
    }
  }
  const seenEvents = new Set<string>();
  let lastRound = 0, stuckSince = 0;
  for (let step = 0; step < MAX_ROUNDS * 2; step++) {
    resetRateLimits();
    const states: S[] = [];
    for (const b of bots) {
      const res = await b.client.post(`/api/campaigns/${id}/sync`);
      if (res.status >= 500) note(r, "Erro 500 no sync", JSON.stringify(res.body).slice(0, 200));
      states.push(res.body);
    }
    // Fartura: despensa reposta a cada 10 rodadas (simula comida/água renováveis).
    if (process.env.SIM_FARTURA && step % 10 === 9) {
      for (const ch of await loadCampaignCharacters(id)) {
        if (!ch.alive) continue;
        const has = (it: string) => ch.inventory.filter((x) => x.itemId === it).reduce((n, x) => n + (x.quantity ?? 1), 0);
        if (has("sardinha") < 2) addItem(ch, VALE_SILENTE, randomUUID, "sardinha", 3);
        if (has("garrafa_agua") < 2) addItem(ch, VALE_SILENTE, randomUUID, "garrafa_agua", 2);
        if (has("atadura") < 1) addItem(ch, VALE_SILENTE, randomUUID, "atadura", 2);
        await saveCharacter(ch);
      }
    }
    const s0 = states[0];
    r.rounds = s0.campaign.round;
    r.minutes = s0.campaign.minute;
    if (s0.campaign.status !== "active") break;
    if (r.rounds > MAX_ROUNDS) break;

    // Evento novo (por instância).
    for (let i = 0; i < bots.length; i++) {
      const s = states[i];
      if (s.event && !seenEvents.has(s.event.instanceId)) {
        seenEvents.add(s.event.instanceId);
        r.events[s.event.id] = (r.events[s.event.id] ?? 0) + 1;
        r.timeline.push(`R${r.rounds} ${s.campaign.clock} D${s.campaign.day}: evento ${s.event.id} para ${s.event.participants.join(", ")}`);
      }
    }
    for (let i = 0; i < bots.length; i++) {
      const me = states[i].me;
      if (!me) continue;
      const key = `${bots[i].name}:dead`;
      if (!me.alive && !seenEvents.has(key)) {
        seenEvents.add(key);
        r.timeline.push(`R${r.rounds} ${s0.campaign.clock} D${s0.campaign.day}: ☠ ${bots[i].name} morreu (${me.deathCause}) em ${states[i].here.name}`);
      }
      const bleeding = me.alive && me.wounds.some((w: any) => w.bleedingRate > 0);
      const hasBandage = me.inventory?.some((it: any) => it.itemId === "atadura");
      if (bleeding && !hasBandage && !seenEvents.has(`${bots[i].name}:semAtadura:${r.rounds}`)) {
        seenEvents.add(`${bots[i].name}:semAtadura:${r.rounds}`);
        note(r, "Sangrando sem nenhuma atadura (depende de achar/receber)", `${bots[i].name} R${r.rounds} em ${states[i].here.name}, vida ${me.health.health}`);
      }
      if (me.alive && me.status.thirst >= 85) note(r, "Sede crítica (≥85)", `${bots[i].name} R${r.rounds} em ${states[i].here.name}; água aqui: ${states[i].here.water ?? "não"}; garrafas: ${me.inventory.filter((it: any) => it.actions.some((a: any) => a.type === "beber" || a.type === "coletar_agua")).map((it: any) => it.name).join(",") || "nenhuma"}`);
    }
    if (s0.acts.allAwakened && r.awakenedRound === null) { r.awakenedRound = r.rounds; r.timeline.push(`R${r.rounds} ${s0.campaign.clock}: todos despertos (Ato II)`); }
    if (s0.acts.reunited && r.reunitedRound === null) { r.reunitedRound = r.rounds; r.timeline.push(`R${r.rounds} ${s0.campaign.clock}: grupo reunido`); }

    for (let i = 0; i < bots.length; i++) {
      const b = bots[i], s = states[i];
      scanState(r, b, s);
      if (!s.me?.alive || s.pending) continue;
      // Objetivo parado por muito tempo.
      const objKey = `${s.objective?.routeId}:${s.objective?.label}`;
      if (objKey !== b.lastObjective) { b.lastObjective = objKey; b.objectiveSince = r.rounds; }
      else if (r.rounds - b.objectiveSince === 60) note(r, "Objetivo parado 60 rodadas", `${b.name}: "${s.objective?.label}" em ${s.here.name} (alvo ${s.objective?.targetName ?? "-"}) rotas=${JSON.stringify(s.map.travel.map((t: any) => [t.to, t.available, t.reason]))} links=${s.map.links.length} descobertos=${s.map.locations.map((l: any) => l.id).join(",")} vida=${Math.round(s.me.health.health)} sede=${Math.round(s.me.status.thirst)}`);

      const d = decide(b, s);
      if (process.env.SIM_TRACE === String(i)) {
        for (const l of s.log ?? []) {
          if (l.id > ((b as any).lastLogId ?? 0) && ["result", "event"].includes(l.kind)) r.timeline.push(`    [${l.kind}] ${l.text.replace(/\s+/g, " ").slice(0, 260)}`);
        }
        (b as any).lastLogId = Math.max((b as any).lastLogId ?? 0, ...(s.log ?? []).map((l: any) => l.id));
        const st = s.me.status;
        r.timeline.push(`  · R${r.rounds} ${s.campaign.clock} ${s.here.locationId} sede${Math.round(st.thirst)} fome${Math.round(st.hunger)} temp${st.bodyTemp.toFixed(1)} molh${Math.round(st.wetness ?? 0)} fogo${s.here.fire ? 1 : 0} vida${Math.round(s.me.health.health)} fad${Math.round(st.fatigue)} sangue${s.me.wounds.filter((w: any) => w.bleedingRate > 0).length} inv[${s.me.inventory.map((it: any) => it.itemId + (it.contaminated ? "*" : "")).join(",")}] → ${d.type} (${d.why})`);
      }
      // Coerência: se a tela diz que dá, o servidor tem que aceitar.
      const res = await act(b.client, id, d.type, d.params);
      r.actions[d.type] = (r.actions[d.type] ?? 0) + 1;
      if (d.params.d20) r.rolls++;
      if (res.status >= 500) note(r, "Erro 500 ao agir", `${b.name} ${d.type}: ${JSON.stringify(res.body).slice(0, 200)}`);
      else if (res.status !== 200 && res.body?.code !== "rodada_mudou" && res.body?.code !== "acao_pendente") {
        note(r, "Tela oferece ação que o servidor recusa", `${b.name} ${d.type} (${d.why}) ${JSON.stringify(d.params).slice(0, 80)} → ${res.status} ${res.body?.error ?? JSON.stringify(res.body).slice(0, 120)}`);
      }
    }

    // Todos jogaram e a rodada não andou?
    const after = (await owner.post(`/api/campaigns/${id}/sync`)).body;
    if (after.campaign.status === "active") {
      if (after.campaign.round === lastRound) {
        if (++stuckSince === 5) {
          const pend = await getDb().all<{ character_id: string; type: string; completes_at: string }>("SELECT character_id,type,completes_at FROM player_actions WHERE campaign_id=? AND status='pending'", id);
          note(r, "Rodada não avança com todos tendo jogado", `R${after.campaign.round} pendentes=${JSON.stringify(pend)} party=${JSON.stringify(after.party.map((p: any) => [p.name, p.alive, p.acted]))}`);
        }
      } else { stuckSince = 0; lastRound = after.campaign.round; }
      if (stuckSince > 12) break;
    }
  }

  const final = await Promise.all(bots.map(async (b) => (await b.client.get(`/api/campaigns/${id}/state`)).body));
  const f0 = final[0];
  r.ending = f0.ending ? `${f0.ending.type}:${f0.ending.key} (${f0.ending.title})` : null;
  r.deaths = f0.party.filter((p: any) => !p.alive).map((p: any) => `${p.name}: ${p.deathCause}`);
  r.progress = `${f0.story?.progress ?? 0}% · fase ${f0.story?.phase?.index}/${f0.story?.phase?.total} "${f0.story?.phase?.title}" · pistas ${f0.clues?.length ?? 0} · chefes ${(f0.story?.bosses ?? []).filter((b: any) => b.resolved).map((b: any) => b.id).join(",") || "-"}`;
  r.finalLocations = f0.party.map((p: any) => `${p.name}@${p.locationId}`);
  r.objectivesEnd = final.map((s: S, i: number) => `${bots[i].name}: ${s.objective?.label ?? "-"} (${s.story?.phase?.title ?? "-"})`);
  if (players > 1 && r.awakenedRound !== null && r.reunitedRound === null && !r.ending?.startsWith("defeat")) note(r, "Grupo despertou mas nunca se reuniu", r.finalLocations.join(", "));
  if (players > 1 && r.awakenedRound === null) note(r, "Ato II nunca começou (alguém sem despertar/classe)", r.objectivesEnd.join(" | "));
  for (const [ev, n] of Object.entries(r.events)) if (n >= 5) note(r, "Evento repetindo muitas vezes (loop)", `${ev} ×${n}`);
  if (!r.ending) note(r, "Partida não terminou no limite de rodadas", `R${r.rounds}, ${Math.round(r.minutes / 60)}h de jogo; ${r.objectivesEnd.join(" | ")}`);
  return r;
}

describe.skipIf(!RUN)("Simulação de partidas", () => {
  it("1 a 4 jogadores", async () => {
    const reports: Report[] = [];
    for (const n of COUNTS) {
      for (const seed of SEEDS) {
        const t0 = Date.now();
        const rep = await simulate(n, seed);
        reports.push(rep);
        console.log(`[sim] ${n}p ${seed}: R${rep.rounds} ${Math.round(rep.minutes / 60)}h fim=${rep.ending ?? "-"} problemas=${Object.keys(rep.issues).length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
    }
    const out = process.env.SIM_OUT;
    if (out) fs.writeFileSync(out, JSON.stringify(reports, null, 2));
  }, 60 * 60 * 1000);
});
