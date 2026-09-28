/**
 * Progresso narrativo derivado do mundo persistido.
 *
 * Não grava um "ato atual" separado: flags, pistas, eventos e locais visitados
 * continuam sendo a fonte da verdade. Isso mantém saves antigos compatíveis e
 * evita que uma atualização de interface dessynchronize a campanha.
 */
import type { BossPresentationDef, GameContent, StoryCondition, WorldState } from "./types";

export function storyConditionMet(world: WorldState, condition: StoryCondition): boolean {
  if (condition.flagsAll?.some((flag) => !world.flags[flag])) return false;
  if (condition.flagsAny && !condition.flagsAny.some((flag) => world.flags[flag])) return false;
  if (condition.cluesAny && !condition.cluesAny.some((clue) => world.clues.includes(clue))) return false;
  if (condition.eventsAny && !condition.eventsAny.some((event) => event in world.eventHistory)) return false;
  if (condition.visitedAny && !condition.visitedAny.some((id) => world.locations[id]?.visited)) return false;
  if (condition.visitedAll?.some((id) => !world.locations[id]?.visited)) return false;
  if (condition.minMinute !== undefined && world.minute < condition.minMinute) return false;
  if (condition.ending !== undefined && !!world.ending !== condition.ending) return false;
  return true;
}

function bossView(world: WorldState, boss: BossPresentationDef, activeEventId: string | null) {
  const active = !!activeEventId && boss.eventIds.includes(activeEventId);
  const resolved = storyConditionMet(world, boss.resolvedWhen);
  const introduced = active || resolved || storyConditionMet(world, boss.introducedWhen);
  let stageIndex = 0;
  boss.stages.forEach((stage, index) => {
    if (storyConditionMet(world, stage.condition)) stageIndex = index;
  });
  return {
    id: boss.id,
    title: boss.title,
    epithet: boss.epithet,
    active,
    introduced,
    resolved,
    stage: Math.min(stageIndex + 1, boss.stages.length),
    stages: boss.stages.length,
    stageLabel: resolved ? "Confronto resolvido" : boss.stages[stageIndex]?.label ?? "À espreita",
    locationIds: boss.locationIds,
    artPosition: boss.artPosition,
  };
}

export function campaignStory(world: WorldState, content: GameContent, activeEventId: string | null) {
  const acts = content.acts ?? [];
  const completed = acts.map((act) => storyConditionMet(world, act.completeWhen));
  const firstIncomplete = completed.findIndex((done) => !done);
  const actIndex = acts.length ? (firstIncomplete < 0 ? acts.length - 1 : firstIncomplete) : 0;
  const act = acts[actIndex];
  const milestones = act?.milestones.map((milestone) => ({
    id: milestone.id,
    label: milestone.label,
    done: storyConditionMet(world, milestone.condition),
  })) ?? [];
  const milestoneDone = milestones.filter((milestone) => milestone.done).length;
  const actFraction = milestones.length ? milestoneDone / milestones.length : 0;
  const overallProgress = acts.length
    ? Math.round(Math.min(1, (completed.slice(0, actIndex).filter(Boolean).length + actFraction) / acts.length) * 100)
    : 0;

  const bosses = (content.bosses ?? []).map((boss) => bossView(world, boss, activeEventId));
  const visibleBosses = bosses.filter((boss) => boss.introduced);
  const boss = bosses.find((candidate) => candidate.active)
    ?? [...visibleBosses].reverse().find((candidate) => !candidate.resolved)
    ?? [...visibleBosses].reverse()[0]
    ?? null;

  return {
    targetRealMinutes: content.targetRealMinutes ?? ([90, 130] as [number, number]),
    progress: overallProgress,
    phase: act
      ? {
          id: act.id,
          index: actIndex + 1,
          total: acts.length,
          title: act.title,
          subtitle: act.subtitle,
          briefing: act.briefing,
          targetRealMinutes: act.targetRealMinutes,
          regionId: act.regionId,
          artPosition: act.artPosition,
          milestones,
          completedMilestones: milestoneDone,
        }
      : null,
    acts: acts.map((entry, index) => ({
      id: entry.id,
      index: index + 1,
      title: entry.title,
      subtitle: entry.subtitle,
      status: completed[index] ? ("completed" as const) : index === actIndex ? ("current" as const) : ("locked" as const),
      artPosition: entry.artPosition,
    })),
    boss,
    bosses: bosses.map(({ id, title, introduced, resolved, stage, stages }) => ({ id, title, introduced, resolved, stage, stages })),
  };
}
