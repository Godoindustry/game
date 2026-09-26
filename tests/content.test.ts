import { describe, it, expect } from "vitest";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import type { ChoiceRequirements, Effect, OutcomeBranch, Outcome } from "@/server/engine/types";

/** Toda referência do conteúdo (pistas, itens, locais, finais, eventos) precisa existir. */
describe("Integridade do conteúdo — Vale Silente", () => {
  const problems: string[] = [];
  const need = (ok: boolean, what: string) => {
    if (!ok) problems.push(what);
  };
  const item = (id: string, where: string) => need(!!content.items[id], `${where}: item ${id}`);
  const loc = (id: string, where: string) => need(!!content.locations[id], `${where}: local ${id}`);

  const effects = (list: Effect[] | undefined, where: string) => {
    for (const e of list ?? []) {
      if (e.op === "clue") need(!!content.clues[e.key], `${where}: pista ${e.key}`);
      if (e.op === "end") need(!!content.endings[e.ending], `${where}: final ${e.ending}`);
      if (e.op === "addItem" || e.op === "removeItem" || e.op === "itemDurability" || e.op === "useCharge") item(e.item, where);
      if (e.op === "reveal") loc(e.location, where);
      if (e.op === "revealLink") {
        need(content.links.some((k) => (k.from === e.from && k.to === e.to) || (k.from === e.to && k.to === e.from)), `${where}: trilha ${e.from}-${e.to}`);
      }
    }
  };
  const reqs = (r: ChoiceRequirements | undefined, where: string) => {
    for (const i of [...(r?.hasItem ?? []), ...(r?.hasAnyItem ?? [])]) item(i, where);
    for (const k of r?.cluesAny ?? []) need(!!content.clues[k], `${where}: pista exigida ${k}`);
  };
  const outcome = (o: Outcome, where: string) => {
    effects(o.effects, where);
    for (const b of [o.success, o.failure] as (OutcomeBranch | undefined)[]) effects(b?.effects, where);
    if (o.check) for (const i of Object.keys(o.check.itemBonus ?? {})) item(i, where);
  };

  const ids = new Set<string>();
  for (const ev of content.events) {
    need(!ids.has(ev.id), `evento duplicado ${ev.id}`);
    ids.add(ev.id);
    if (ev.locationId) loc(ev.locationId, ev.id);
    if (ev.trigger.afterEvent) need(content.events.some((x) => x.id === ev.trigger.afterEvent), `${ev.id}: afterEvent ${ev.trigger.afterEvent}`);
    if (ev.trigger.hasItem) item(ev.trigger.hasItem, ev.id);
    need(ev.choices.some((c) => c.safe), `${ev.id}: sem escolha segura (usada no tempo esgotado)`);
    for (const ch of ev.choices) {
      need(ch.id.startsWith(`${ev.id}.`), `${ch.id}: id fora do padrão`);
      reqs(ch.requirements, ch.id);
      outcome(ch.outcome, ch.id);
    }
  }
  for (const [npc, rules] of Object.entries(content.npcRules)) {
    for (const [intent, r] of Object.entries(rules)) {
      reqs(r.requirements, `${npc}.${intent}`);
      outcome(r, `${npc}.${intent}`);
    }
  }
  for (const l of Object.values(content.locations)) {
    if (l.properties.examineClue) need(!!content.clues[l.properties.examineClue], `${l.id}: pista de exame`);
    for (const e of l.properties.loot ?? []) item(e.itemId, `${l.id}: loot`);
  }

  it("não tem referências quebradas", () => {
    expect(problems).toEqual([]);
  });

  it("toda pista pode ser encontrada e todo final pode ser alcançado", () => {
    const text = JSON.stringify({ e: content.events, n: content.npcRules, l: content.locations });
    for (const k of Object.keys(content.clues)) expect(text, `pista ${k}`).toContain(`"${k}"`);
    for (const k of Object.keys(content.endings).filter((k) => k !== "morte")) expect(text, `final ${k}`).toContain(`"ending":"${k}"`);
  });
});
