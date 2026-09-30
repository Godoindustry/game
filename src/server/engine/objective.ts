/**
 * Bússola de objetivo: escolhe a rota de fuga mais adiantada e a próxima etapa,
 * e aponta a necessidade urgente do corpo. Puro e só de leitura — não altera estado.
 */
import type { CharacterState, GameContent, ObjectiveCondition, ObjectiveRoute, WorldState } from "./types";
import { hasItem, itemDef } from "./inventory";
import { neighbors } from "./actions";
import { isSheltered } from "./physiology";

export type ResourceKey = "agua" | "agua_limpa" | "frutos" | "lenha" | "abrigo" | "itens";

/**
 * O que um local oferece, do jeito que o jogador descobre: água e abrigo se veem de longe;
 * frutos, lenha e "ainda há coisas aqui" só depois de pisar lá.
 */
export function locationResources(world: WorldState, content: GameContent, locationId: string): { key: ResourceKey; label: string }[] {
  const loc = content.locations[locationId];
  const st = world.locations[locationId];
  if (!loc || !st?.discovered) return [];
  const out: { key: ResourceKey; label: string }[] = [];
  const w = loc.properties.water;
  if (w === "rain") out.push({ key: "agua_limpa", label: "Água da chuva (limpa)" });
  else if (w) out.push({ key: "agua", label: w === "lake" ? "Água do poço (tratar)" : "Água do córrego (tratar)" });
  if (isSheltered(world, content, locationId)) out.push({ key: "abrigo", label: "Abrigo" });
  if (!st.visited) return out;
  if (loc.properties.forage) out.push({ key: "frutos", label: "Frutos e raízes" });
  if (loc.properties.woodSource) out.push({ key: "lenha", label: "Lenha" });
  const left = (loc.properties.loot ?? []).some((e, i) => (st.loot[i] ?? 0) > 0);
  if (left) out.push({ key: "itens", label: st.examined ? "Ainda há coisas aqui" : "Examine: pode haver coisas" });
  return out;
}

/** Local conhecido mais perto (em passos de trilha) que oferece um dos recursos. */
export function nearestWith(char: CharacterState, world: WorldState, content: GameContent, keys: ResourceKey[]): { id: string; name: string; steps: number } | null {
  const start = char.status.locationId;
  const seen = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const steps = seen.get(cur)!;
    if (locationResources(world, content, cur).some((r) => keys.includes(r.key))) {
      return { id: cur, name: content.locations[cur].name, steps };
    }
    for (const n of neighbors(world, content, cur)) {
      if (!seen.has(n.to) && world.locations[n.to]?.discovered) {
        seen.set(n.to, steps + 1);
        queue.push(n.to);
      }
    }
  }
  return null;
}

const where = (hit: { name: string; steps: number } | null, here: string, far: string) =>
  !hit ? far : hit.steps === 0 ? here : `Mais perto: ${hit.name}${hit.steps > 1 ? ` (${hit.steps} caminhos)` : ""}.`;

function holds(char: CharacterState, world: WorldState, c: ObjectiveCondition): boolean {
  if (c.hasAnyItem && !c.hasAnyItem.some((i) => hasItem(char, i))) return false;
  if (c.hasAllItems && !c.hasAllItems.every((i) => hasItem(char, i))) return false;
  if (c.flagsAll && !c.flagsAll.every((f) => !!world.flags[f])) return false;
  if (c.flagsAny && !c.flagsAny.some((f) => !!world.flags[f])) return false;
  if (c.eventSeen && world.eventHistory[c.eventSeen] === undefined) return false;
  return true;
}

export interface ObjectiveView {
  routeId: string;
  routeTitle: string;
  label: string;
  hint: string;
  stepIndex: number; // 0-based: etapa atual
  totalSteps: number;
  targetLocationId: string | null;
  targetName: string | null;
  targetOnMap: boolean; // já descoberto: aparece no mapa e pode ser selecionado
  bearing: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  others: { title: string; done: number; total: number }[];
}

export function currentObjective(char: CharacterState, world: WorldState, content: GameContent): ObjectiveView | null {
  const meeting = meetingObjective(char, world, content);
  if (meeting) return meeting;
  const routes = content.objectives ?? [];
  let best: { route: ObjectiveRoute; done: boolean[]; ratio: number } | null = null;
  const scored = routes.map((route) => {
    const done = route.steps.map((s) => !!s.done && s.done.some((c) => holds(char, world, c)));
    return { route, done, ratio: done.filter(Boolean).length / route.steps.length };
  });
  for (const s of scored) if (!best || s.ratio > best.ratio) best = s; // empate: a primeira rota
  if (!best) return null;
  const idx = best.done.findIndex((d) => !d);
  const stepIndex = idx === -1 ? best.route.steps.length - 1 : idx;
  const step = best.route.steps[stepIndex];
  // Alvo: o primeiro local conhecido (descoberto, ou visível desde o início, como a antena).
  const known = (l: string) => !!world.locations[l]?.discovered || !content.locations[l]?.hiddenInitially;
  const target = step.locations?.find(known) ?? null;
  const from = content.locations[char.status.locationId];
  const to = target ? content.locations[target] : null;
  return {
    routeId: best.route.id,
    routeTitle: best.route.title,
    label: step.label,
    hint: step.hint,
    stepIndex,
    totalSteps: best.route.steps.length,
    targetLocationId: target,
    targetName: to?.name ?? null,
    targetOnMap: !!target && !!world.locations[target]?.discovered,
    bearing: to && from && to.id !== from.id ? { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } } : null,
    others: scored
      .filter((s) => s !== best)
      .map((s) => ({ title: s.route.title, done: s.done.filter(Boolean).length, total: s.route.steps.length })),
  };
}

/**
 * Ato II: todos despertaram e o grupo precisa se reunir. Até o Encontro, a bússola aponta
 * para o ponto de encontro — sem isso cada um segue a própria rota e o grupo nunca se vê.
 */
function meetingObjective(char: CharacterState, world: WorldState, content: GameContent): ObjectiveView | null {
  const target = content.meetingLocation;
  if (!target || !world.flags.ato2 || world.flags.encontro_feito) return null;
  const from = content.locations[char.status.locationId];
  const to = content.locations[target];
  const here = char.status.locationId === target;
  return {
    routeId: "encontro",
    routeTitle: "O Encontro",
    label: here ? "Espere o grupo aqui" : `Reúna o grupo: ${to?.name ?? target}`,
    hint: here
      ? "O Encontro começa quando todos os sobreviventes estiverem neste local. Descanse ou espere."
      : "Todos precisam chegar ao mesmo lugar. Use as rotas até lá.",
    stepIndex: 0,
    totalSteps: 1,
    targetLocationId: target,
    targetName: to?.name ?? null,
    targetOnMap: !!world.locations[target]?.discovered,
    bearing: to && from && !here ? { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } } : null,
    others: [],
  };
}

/** Necessidade do corpo que deve vir antes do objetivo (ordem = prioridade). */
export function urgentNeed(char: CharacterState, world?: WorldState, content?: GameContent): { label: string; hint: string } | null {
  if (!char.alive) return null;
  const s = char.status;
  const near = (keys: ResourceKey[]) => (world && content ? nearestWith(char, world, content, keys) : null);
  const carries = (prop: "water" | "food") =>
    !!content && char.inventory.some((i) => !!itemDef(content, i.itemId).properties[prop] && !(prop === "water" && i.contaminated));
  if (char.wounds.some((w) => !w.healed && w.bleedingRate > 0)) {
    return hasItem(char, "atadura")
      ? { label: "Estanque o sangramento", hint: "Toque no seu retrato → Corpo e ferimentos → Enfaixar. Só a atadura para o sangue; remédio não." }
      : { label: "Você está sangrando sem atadura", hint: "Procure uma atadura (destroços, acampamento) ou peça a alguém do grupo. Analgésico só tira a dor." };
  }
  if (s.bodyTemp < 35.5) {
    return { label: "Aqueça-se", hint: `Fogueira (galhos + fósforos ou isqueiro), abrigo e roupas secas. ${where(near(["abrigo", "lenha"]), "Aqui dá para se abrigar ou juntar lenha.", "")}`.trim() };
  }
  if (s.thirst >= 70) {
    if (carries("water")) return { label: "Beba água", hint: "Abra a mochila e beba a sua garrafa." };
    return { label: "Beba água", hint: where(near(["agua_limpa", "agua"]), "Aqui tem água: beba da fonte ou encha a garrafa.", "Procure córrego, poço ou o tambor de chuva do acampamento.") };
  }
  if (char.health.infection >= 50) return { label: "Infecção avançando", hint: "Limpe os ferimentos com antisséptico." };
  if (s.hunger >= 75) {
    if (carries("food")) return { label: "Coma algo", hint: "Abra a mochila e coma." };
    return { label: "Coma algo", hint: `Use "Procurar recursos" onde há frutos. ${where(near(["frutos"]), "Aqui tem frutos e raízes.", "Mata, trilha e beira d'água costumam ter.")}` };
  }
  if (s.fatigue >= 85) return { label: "Durma", hint: "De preferência em abrigo, perto do fogo." };
  return null;
}
