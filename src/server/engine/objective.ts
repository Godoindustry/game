/**
 * Bússola de objetivo: escolhe a rota de fuga mais adiantada e a próxima etapa,
 * e aponta a necessidade urgente do corpo. Puro e só de leitura — não altera estado.
 */
import type { CharacterState, GameContent, ObjectiveCondition, ObjectiveRoute, WorldState } from "./types";
import { hasItem } from "./inventory";

function holds(char: CharacterState, world: WorldState, c: ObjectiveCondition): boolean {
  if (c.hasAnyItem && !c.hasAnyItem.some((i) => hasItem(char, i))) return false;
  if (c.hasAllItems && !c.hasAllItems.every((i) => hasItem(char, i))) return false;
  if (c.flagsAll && !c.flagsAll.every((f) => !!world.flags[f])) return false;
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

/** Necessidade do corpo que deve vir antes do objetivo (ordem = prioridade). */
export function urgentNeed(char: CharacterState): { label: string; hint: string } | null {
  if (!char.alive) return null;
  const s = char.status;
  if (char.wounds.some((w) => !w.healed && w.bleedingRate > 0)) return { label: "Estanque o sangramento", hint: "Abra o personagem e trate o ferimento com uma atadura." };
  if (s.bodyTemp < 35.5) return { label: "Aqueça-se", hint: "Fogueira, abrigo e roupas secas. Parado no frio, você piora." };
  if (s.thirst >= 70) return { label: "Beba água", hint: "Córrego e poço têm água — trate antes de beber." };
  if (char.health.infection >= 50) return { label: "Infecção avançando", hint: "Limpe os ferimentos com antisséptico." };
  if (s.hunger >= 75) return { label: "Coma algo", hint: "Abra a mochila. Procurar em cada local pode render comida." };
  if (s.fatigue >= 85) return { label: "Durma", hint: "De preferência em abrigo, perto do fogo." };
  return null;
}
