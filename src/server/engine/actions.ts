/**
 * Catálogo de ações: validação (antes de aceitar) e resolução (depois da espera).
 * Toda ação passa por validateAction no servidor, que calcula a duração oficial —
 * o cliente nunca informa duração, custo nem resultado.
 */
import type {
  ActionInput,
  ActionReport,
  ActiveEvent,
  CharacterState,
  Container,
  GameContent,
  InvItem,
  LinkDef,
  WorldState,
} from "./types";
import { CONTAINERS } from "./types";
import { ACTION_MINUTES, FIRE_DURATION_MINUTES, PAINKILLER_MINUTES, SLEEP_OPTIONS_HOURS } from "./constants";
import {
  accessMinutes,
  addItem,
  canCarryExtra,
  containerUsedMl,
  encumbranceMultiplier,
  equippedBackpack,
  findItem,
  fitsIn,
  hasItem,
  itemDef,
  pickContainer,
  removeInvItem,
  removeItem,
} from "./inventory";
import { type Activity, isNight, isSheltered, fireActive, passTime, clamp, computePain } from "./physiology";
import { applyEffects, linkKey, meetsRequirements, revealLocation, rollCheck, type EffectContext } from "./effects";
import { choiceById, eventById } from "./events";
import { hasExperience } from "./character";

export type Validation = { ok: true; minutes: number; activity: Activity } | { ok: false; error: string };

export interface ValidateContext {
  char: CharacterState;
  world: WorldState;
  content: GameContent;
  activeEvent: ActiveEvent | null;
}

// ---------- Deslocamento ----------
export function neighbors(world: WorldState, content: GameContent, locationId: string): LinkDef[] {
  return content.links
    .filter((l) => l.from === locationId || l.to === locationId)
    .filter((l) => !l.hidden || world.revealedLinks.includes(linkKey(l.from, l.to)))
    .map((l) => (l.from === locationId ? l : { ...l, from: l.to, to: l.from }));
}

export function lightSource(char: CharacterState, content: GameContent): InvItem | undefined {
  const lights = char.inventory.filter((i) => itemDef(content, i.itemId).properties.light && (i.battery ?? 0) > 0);
  return lights.find((i) => i.itemId === "lanterna") ?? lights[0];
}

export function travelMinutes(char: CharacterState, world: WorldState, content: GameContent, link: LinkDef): number {
  let mult = encumbranceMultiplier(char, content) * (100 / Math.max(char.health.mobility, 20));
  if (isNight(content, world.minute)) mult *= lightSource(char, content) ? 1.15 : 1.6;
  if (char.status.energy < 15) mult *= 1.3;
  mult *= 1.1 - char.attrs.orientacao * 0.025 - (hasExperience(char, "orientacao") ? 0.05 : 0);
  return Math.max(5, Math.round(link.minutes * mult));
}

// ---------- Validação ----------
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function validateAction(ctx: ValidateContext, action: ActionInput): Validation {
  const { char, world, content, activeEvent } = ctx;
  if (!char.alive) return { ok: false, error: "Seu personagem está morto." };
  const inEvent = activeEvent?.participants.includes(char.id) ?? false;
  if (inEvent && action.type !== "escolha_evento") return { ok: false, error: "Responda ao evento em andamento primeiro." };
  if (!inEvent && action.type === "escolha_evento") return { ok: false, error: "Não há evento aguardando sua decisão." };

  const p = action.params ?? {};
  const loc = content.locations[char.status.locationId];
  const locState = world.locations[char.status.locationId];
  const quick = (item: InvItem): Validation => ({ ok: true, minutes: ACTION_MINUTES.quick + accessMinutes(item), activity: "idle" });

  switch (action.type) {
    case "examinar":
      return { ok: true, minutes: ACTION_MINUTES.examinar, activity: "light" };
    case "procurar":
      return { ok: true, minutes: ACTION_MINUTES.procurar, activity: "light" };
    case "esperar":
      return { ok: true, minutes: ACTION_MINUTES.esperar, activity: "idle" };
    case "descansar":
      return { ok: true, minutes: ACTION_MINUTES.descansar, activity: "rest" };
    case "dormir": {
      const hours = Number(p.hours);
      if (!SLEEP_OPTIONS_HOURS.includes(hours as 2)) return { ok: false, error: "Escolha dormir 2, 4 ou 8 horas." };
      if (char.status.fatigue < 20) return { ok: false, error: "Você está alerta demais para dormir agora." };
      return { ok: true, minutes: hours * 60, activity: "sleep" };
    }
    case "mover": {
      const link = neighbors(world, content, char.status.locationId).find((l) => l.to === p.to);
      if (!link) return { ok: false, error: "Não há caminho conhecido até esse local." };
      if (char.status.energy < 5) return { ok: false, error: "Você está exausto demais para caminhar. Descanse." };
      return { ok: true, minutes: travelMinutes(char, world, content, link), activity: "walk" };
    }
    case "comer": {
      const it = findItem(char, p.inventoryItemId);
      if (!it) return { ok: false, error: "Item não está no seu inventário." };
      if (!itemDef(content, it.itemId).properties.food) return { ok: false, error: "Isso não é comestível." };
      return quick(it);
    }
    case "beber": {
      const it = findItem(char, p.inventoryItemId);
      if (!it) return { ok: false, error: "Item não está no seu inventário." };
      if (!itemDef(content, it.itemId).properties.water) return { ok: false, error: "Não há o que beber nisso." };
      return quick(it);
    }
    case "coletar_agua": {
      if (!loc?.properties.water) return { ok: false, error: "Não há água aqui." };
      const it = findItem(char, p.inventoryItemId);
      if (!it || !itemDef(content, it.itemId).properties.fillsTo) return { ok: false, error: "Você precisa de um recipiente vazio." };
      return { ok: true, minutes: ACTION_MINUTES.coletar_agua + accessMinutes(it), activity: "light" };
    }
    case "purificar_agua": {
      const it = findItem(char, p.inventoryItemId);
      if (!it || !itemDef(content, it.itemId).properties.water) return { ok: false, error: "Escolha uma garrafa com água." };
      if (!it.contaminated) return { ok: false, error: "Essa água já está tratada." };
      if (!hasItem(char, "pastilhas")) return { ok: false, error: "Você não tem pastilhas de purificação." };
      return quick(it);
    }
    case "ferver_agua": {
      const it = findItem(char, p.inventoryItemId);
      if (!it || !itemDef(content, it.itemId).properties.water) return { ok: false, error: "Escolha uma garrafa com água." };
      if (!it.contaminated) return { ok: false, error: "Essa água já está tratada." };
      if (!fireActive(world, char.status.locationId)) return { ok: false, error: "Precisa de uma fogueira acesa aqui." };
      if (!char.inventory.some((i) => itemDef(content, i.itemId).properties.pot)) return { ok: false, error: "Precisa de um recipiente de metal." };
      return { ok: true, minutes: ACTION_MINUTES.ferver_agua, activity: "light" };
    }
    case "tratar_ferimento": {
      const w = char.wounds.find((x) => x.id === p.woundId && !x.healed);
      if (!w) return { ok: false, error: "Ferimento não encontrado." };
      const needsBandage = w.bleedingRate > 0 || !w.bandaged || (["fratura", "entorse"].includes(w.type) && !w.splinted);
      const canBandage = needsBandage && hasItem(char, "atadura");
      const canDisinfect = !w.disinfected && hasItem(char, "antisseptico") && w.type !== "contusao" && w.type !== "entorse";
      if (!canBandage && !canDisinfect) return { ok: false, error: "Você não tem material útil para esse ferimento." };
      const it = char.inventory.find((i) => i.itemId === "atadura" || i.itemId === "antisseptico")!;
      return { ok: true, minutes: ACTION_MINUTES.tratar_ferimento + accessMinutes(it), activity: "light" };
    }
    case "tomar_analgesico": {
      const it = char.inventory.find((i) => i.itemId === "analgesico");
      if (!it) return { ok: false, error: "Você não tem analgésico." };
      if (char.health.painkillerUntil > world.minute) return { ok: false, error: "Você já tomou uma dose. Espere o efeito passar." };
      return quick(it);
    }
    case "montar_abrigo": {
      if (!loc?.properties.canBuildShelter) return { ok: false, error: "O terreno aqui não permite montar abrigo." };
      if (locState?.shelterBuilt || isSheltered(world, content, char.status.locationId)) return { ok: false, error: "Já existe abrigo aqui." };
      if (char.status.energy < 10) return { ok: false, error: "Energia insuficiente para montar um abrigo." };
      return { ok: true, minutes: ACTION_MINUTES.montar_abrigo, activity: "heavy" };
    }
    case "acender_fogueira": {
      if (loc?.properties.indoor) return { ok: false, error: "Não é seguro acender fogo aqui dentro." };
      if (!hasItem(char, "galhos_secos")) return { ok: false, error: "Você precisa de galhos secos." };
      if (!char.inventory.some((i) => itemDef(content, i.itemId).properties.ignition)) return { ok: false, error: "Você não tem como acender fogo." };
      return { ok: true, minutes: ACTION_MINUTES.acender_fogueira, activity: "light" };
    }
    case "coletar_lenha": {
      if (!loc?.properties.woodSource) return { ok: false, error: "Não há lenha aproveitável aqui." };
      if (!canCarryExtra(char, content, itemDef(content, "galhos_secos").weightG)) return { ok: false, error: "Você não aguenta carregar mais peso." };
      if (!pickContainer(char, content, "galhos_secos", 1)) return { ok: false, error: "Não há espaço para carregar lenha (mãos e mochila cheias)." };
      return { ok: true, minutes: ACTION_MINUTES.coletar_lenha, activity: "heavy" };
    }
    case "pegar_item": {
      const g = world.ground.find((x) => x.id === p.groundItemId && x.locationId === char.status.locationId);
      if (!g) return { ok: false, error: "Esse item não está aqui." };
      const qty = p.quantity === undefined ? g.quantity : Number(p.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > g.quantity) return { ok: false, error: "Quantidade inválida." };
      const def = itemDef(content, g.itemId);
      if (!canCarryExtra(char, content, def.weightG * qty)) return { ok: false, error: "Peso excede o que você consegue carregar." };
      if (!def.clothing && !pickContainer(char, content, g.itemId, qty)) return { ok: false, error: "Não há espaço (volume) para esse item." };
      if (def.clothing && !pickContainer(char, content, g.itemId, qty) && !fitsIn(char, content, "hands", g.itemId, qty)) {
        return { ok: false, error: "Não há espaço (volume) para esse item." };
      }
      return { ok: true, minutes: ACTION_MINUTES.quick, activity: "idle" };
    }
    case "largar_item": {
      const it = findItem(char, p.inventoryItemId);
      if (!it) return { ok: false, error: "Item não está no seu inventário." };
      if (it.container === "equipped") return { ok: false, error: "Desequipe antes de largar." };
      const qty = p.quantity === undefined ? it.quantity : Number(p.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > it.quantity) return { ok: false, error: "Quantidade inválida." };
      return { ok: true, minutes: 1, activity: "idle" };
    }
    case "mover_item": {
      const it = findItem(char, p.inventoryItemId);
      const target = str(p.container) as Container;
      if (!it) return { ok: false, error: "Item não está no seu inventário." };
      if (!CONTAINERS.includes(target) || target === "equipped") return { ok: false, error: "Compartimento inválido." };
      if (it.container === "equipped") return { ok: false, error: "Desequipe antes de mover." };
      if (it.container === target) return { ok: false, error: "O item já está aí." };
      if (!fitsIn(char, content, target, it.itemId, it.quantity)) return { ok: false, error: "Não cabe nesse compartimento." };
      return { ok: true, minutes: ACTION_MINUTES.quick, activity: "idle" };
    }
    case "equipar": {
      const it = findItem(char, p.inventoryItemId);
      if (!it) return { ok: false, error: "Item não está no seu inventário." };
      const cl = itemDef(content, it.itemId).clothing;
      if (!cl) return { ok: false, error: "Isso não pode ser vestido." };
      if (it.container === "equipped") return { ok: false, error: "Já está equipado." };
      const occupied = char.inventory.find((i) => i.container === "equipped" && itemDef(content, i.itemId).clothing?.slot === cl.slot);
      if (occupied && cl.slot === "costas") {
        const check = simulateBackpackSwap(char, content, it);
        if (!check.ok) return check;
      } else if (occupied) {
        return { ok: false, error: `Tire ${itemDef(content, occupied.itemId).name} antes.` };
      }
      return { ok: true, minutes: cl.slot === "costas" ? 5 : ACTION_MINUTES.equipar, activity: "idle" };
    }
    case "desequipar": {
      const it = findItem(char, p.inventoryItemId);
      if (!it || it.container !== "equipped") return { ok: false, error: "Item não está equipado." };
      const cl = itemDef(content, it.itemId).clothing;
      if (cl?.slot === "costas" && char.inventory.some((i) => i.container === "backpack_main" || i.container === "backpack_side")) {
        return { ok: false, error: "Esvazie a mochila antes de tirá-la (ou equipe outra para trocar)." };
      }
      if (!pickContainer(char, content, it.itemId, 1) && !fitsIn(char, content, "hands", it.itemId, 1)) {
        return { ok: false, error: "Sem espaço para guardar essa peça." };
      }
      return { ok: true, minutes: ACTION_MINUTES.equipar, activity: "idle" };
    }
    case "conversar": {
      const npc = Object.values(content.npcs).find((n) => n.locationId === char.status.locationId);
      if (!npc || !world.flags[npc.presentFlag] || world.flags[npc.goneFlag]) return { ok: false, error: "Não há ninguém aqui para conversar." };
      const msg = str(p.message).trim();
      if (msg.length < 1 || msg.length > 300) return { ok: false, error: "Mensagem deve ter entre 1 e 300 caracteres." };
      return { ok: true, minutes: ACTION_MINUTES.conversar, activity: "idle" };
    }
    case "escolha_evento": {
      const ev = activeEvent && eventById(content, activeEvent.eventId);
      const choice = ev && choiceById(ev, p.choiceId);
      if (!ev || !choice) return { ok: false, error: "Escolha inválida para este evento." };
      const req = meetsRequirements(char, world, content, choice.requirements);
      if (!req.ok) return { ok: false, error: req.reason };
      return { ok: true, minutes: choice.durationMinutes, activity: "light" };
    }
    default:
      return { ok: false, error: "Ação desconhecida." };
  }
}

function simulateBackpackSwap(char: CharacterState, content: GameContent, newBag: InvItem): Validation {
  const def = itemDef(content, newBag.itemId).properties;
  const main = containerUsedMl(char, content, "backpack_main") - (newBag.container === "backpack_main" ? itemDef(content, newBag.itemId).volumeMl : 0);
  const side = containerUsedMl(char, content, "backpack_side") - (newBag.container === "backpack_side" ? itemDef(content, newBag.itemId).volumeMl : 0);
  if (main + side > (def.capacityMl ?? 0) + (def.sideMl ?? 0)) {
    return { ok: false, error: "O conteúdo da mochila atual não cabe na nova." };
  }
  return { ok: true, minutes: 5, activity: "idle" };
}

// ---------- Resolução ----------
export interface ResolveContext extends EffectContext {
  npcIntent?: string;
}

export function resolveAction(
  char: CharacterState,
  action: ActionInput,
  minutes: number,
  activity: Activity,
  ctx: ResolveContext,
): ActionReport {
  const { world, content } = ctx;
  const report: ActionReport = {
    characterId: char.id,
    actionType: action.type,
    success: null,
    summary: "",
    lines: ctx.lines,
    effects: ctx.applied,
    minutes,
    tags: [],
  };
  const p = action.params ?? {};
  const loc = content.locations[char.status.locationId];
  const locState = world.locations[char.status.locationId];
  const tags = report.tags;
  const pass = (m: number, act: Activity) => {
    const rep = passTime(char, world, content, ctx.minute, m, act);
    ctx.minute += m;
    ctx.lines.push(...rep.notes);
  };

  switch (action.type) {
    case "examinar": {
      pass(minutes, "light");
      if (locState && !locState.examined) {
        locState.examined = true;
        ctx.lines.push(loc?.properties.examineText ?? "Você observa os arredores com atenção.");
        if (loc?.properties.examineClue) applyEffects(char, [{ op: "clue", key: loc.properties.examineClue }], ctx);
        for (const [a, b] of loc?.properties.examineRevealsLinks ?? []) applyEffects(char, [{ op: "revealLink", from: a, to: b }], ctx);
        report.summary = "Você examinou a área.";
      } else {
        ctx.lines.push("Você já conhece bem este lugar. Nada de novo à vista.");
        report.summary = "Nada de novo.";
      }
      const here = world.ground.filter((g) => g.locationId === char.status.locationId);
      if (here.length) ctx.lines.push(`No chão: ${here.map((g) => `${content.items[g.itemId].name} ×${g.quantity}`).join(", ")}.`);
      report.success = true;
      break;
    }
    case "procurar": {
      pass(minutes, "light");
      const loot = loc?.properties.loot ?? [];
      let found = 0;
      loot.forEach((entry, idx) => {
        if (found >= 2 || !locState || (locState.loot[idx] ?? 0) <= 0) return;
        if (entry.requiresExamined && !locState.examined) return;
        const r = rollCheck(char, { attr: "percepcao", base: entry.base }, ctx.rng, ctx.minute);
        if (!r.success) return;
        const qty = Math.min(entry.qty, locState.loot[idx]);
        locState.loot[idx] -= qty;
        found++;
        applyEffects(char, [{ op: "addItem", item: entry.itemId, qty, state: entry.state }], ctx);
        ctx.lines.push(`Você encontrou: ${content.items[entry.itemId].name}${qty > 1 ? ` ×${qty}` : ""}.`);
      });
      report.success = found > 0;
      report.summary = found ? `Encontrou ${found} item(ns).` : "Nada útil encontrado.";
      if (!found) {
        const remaining = loot.some((e, i) => (locState?.loot[i] ?? 0) > 0 && (!e.requiresExamined || locState?.examined));
        ctx.lines.push(remaining ? "Você não encontrou nada desta vez — talvez valha outra busca." : "Parece não haver mais nada útil aqui.");
      }
      break;
    }
    case "mover": {
      const link = neighbors(world, content, char.status.locationId).find((l) => l.to === p.to)!;
      const night = isNight(content, ctx.minute);
      const light = lightSource(char, content);
      pass(minutes, "walk");
      if (!char.alive) break;
      if (night && light) {
        const def = itemDef(content, light.itemId);
        light.battery = Math.max(0, Math.round((light.battery ?? 0) - (def.properties.drainPerHour ?? 10) * (minutes / 60)));
        if (light.battery === 0) ctx.lines.push(`A bateria de ${def.name} acabou.`);
      }
      const risky = night ? (light ? link.risk > 0 : true) : link.risk > 1;
      if (risky) {
        const base = (night && !light ? 70 : 85) - link.risk * 10;
        const r = rollCheck(char, { attr: "agilidade", base }, ctx.rng, ctx.minute);
        if (!r.success) {
          const part = ctx.rng() < 0.5 ? "perna_esq" : "perna_dir";
          applyEffects(char, [{ op: "wound", part, type: night && !light ? "entorse" : "contusao", severity: 1 }], ctx);
          ctx.lines.push(night && !light ? "No escuro, seu pé afunda num buraco e o tornozelo torce." : "Você escorrega e cai de mau jeito.");
        }
      }
      char.status.locationId = link.to;
      const dest = world.locations[link.to];
      dest.discovered = true;
      const firstVisit = !dest.visited;
      dest.visited = true;
      for (const n of neighbors(world, content, link.to)) revealLocation(world, n.to);
      const destDef = content.locations[link.to];
      ctx.lines.push(firstVisit ? `Você chega a: ${destDef.name}. ${destDef.description}` : `Você está de volta a: ${destDef.name}.`);
      report.success = true;
      report.summary = `Caminhou até ${destDef.name} (${minutes} min).`;
      break;
    }
    case "descansar":
      pass(minutes, "rest");
      ctx.lines.push(isSheltered(world, content, char.status.locationId) ? "Você descansa protegido do vento." : "Você descansa, atento a cada ruído.");
      report.success = true;
      report.summary = "Descansou.";
      break;
    case "esperar":
      pass(minutes, "idle");
      report.success = true;
      report.summary = "Aguardou.";
      break;
    case "dormir": {
      pass(minutes, "sleep");
      if (!char.alive) break;
      ctx.lines.push(char.status.bodyTemp < 35.5 ? "Você acorda tremendo, com o corpo rígido de frio." : "Você acorda com o corpo pesado, mas a mente um pouco mais clara.");
      report.success = true;
      report.summary = `Dormiu ${minutes / 60}h.`;
      break;
    }
    case "comer": {
      const it = findItem(char, p.inventoryItemId)!;
      const def = itemDef(content, it.itemId);
      char.status.hunger = clamp(char.status.hunger - (def.properties.food ?? 0), 0, 100);
      char.status.stress = clamp(char.status.stress - (def.properties.stressRelief ?? 0), 0, 100);
      removeInvItem(char, it.id, 1);
      ctx.applied.push(`fome -${def.properties.food}`);
      pass(minutes, "idle");
      ctx.lines.push(`Você come: ${def.name}.`);
      report.success = true;
      report.summary = `Comeu ${def.name}.`;
      break;
    }
    case "beber": {
      const it = findItem(char, p.inventoryItemId)!;
      const def = itemDef(content, it.itemId);
      const container = it.container;
      const contaminated = it.contaminated;
      char.status.thirst = clamp(char.status.thirst - (def.properties.water ?? 0), 0, 100);
      removeInvItem(char, it.id, 1);
      if (def.properties.emptiesTo) addItem(char, content, ctx.genId, def.properties.emptiesTo, 1, {}, container);
      ctx.applied.push(`sede -${def.properties.water}`);
      ctx.lines.push(`Você bebe ${def.name.toLowerCase()}.`);
      if (contaminated) applyEffects(char, [{ op: "disease", key: "gastroenterite", chanceAttr: "resistencia", base: 45 }], ctx);
      pass(minutes, "idle");
      report.success = true;
      report.summary = "Bebeu água.";
      break;
    }
    case "coletar_agua": {
      const it = findItem(char, p.inventoryItemId)!;
      const def = itemDef(content, it.itemId);
      const container = it.container;
      removeInvItem(char, it.id, 1);
      addItem(char, content, ctx.genId, def.properties.fillsTo!, 1, { contaminated: true }, container);
      pass(minutes, "light");
      ctx.lines.push("Você enche a garrafa. A água está gelada — e não há como saber o que tem nela.");
      report.success = true;
      report.summary = "Coletou água (não tratada).";
      break;
    }
    case "purificar_agua": {
      const it = findItem(char, p.inventoryItemId)!;
      applyEffects(char, [{ op: "useCharge", item: "pastilhas" }], ctx);
      it.contaminated = false;
      pass(minutes, "idle");
      ctx.lines.push("Você dissolve a pastilha. A água fica com gosto de cloro — e segura para beber.");
      report.success = true;
      report.summary = "Purificou água.";
      break;
    }
    case "ferver_agua": {
      const it = findItem(char, p.inventoryItemId)!;
      pass(minutes, "light");
      it.contaminated = false;
      ctx.lines.push("A água ferve na caneca por alguns minutos. Segura para beber.");
      report.success = true;
      report.summary = "Ferveu água.";
      break;
    }
    case "tratar_ferimento": {
      const w = char.wounds.find((x) => x.id === p.woundId)!;
      pass(minutes, "light");
      if (!char.alive) break;
      const needsBandage = w.bleedingRate > 0 || !w.bandaged || (["fratura", "entorse"].includes(w.type) && !w.splinted);
      const useBandage = needsBandage && hasItem(char, "atadura");
      const useAntiseptic = !w.disinfected && hasItem(char, "antisseptico") && w.type !== "contusao" && w.type !== "entorse";
      if (useAntiseptic) {
        applyEffects(char, [{ op: "useCharge", item: "antisseptico" }], ctx);
        w.disinfected = true;
        ctx.lines.push("O antisséptico arde, mas a ferida está limpa.");
      }
      if (useBandage) {
        removeItem(char, "atadura", 1);
        const r = rollCheck(char, { attr: "medicina", base: 55, experience: ["medicina"] }, ctx.rng, ctx.minute);
        ctx.applied.push(`teste medicina: ${r.success ? "sucesso" : "falha"} (${r.chance}%)`);
        if (r.success) {
          w.bleedingRate = 0;
          w.bandaged = true;
          if (w.type === "fratura" || w.type === "entorse") w.splinted = true;
          ctx.lines.push(w.splinted ? "Você imobiliza o membro com firmeza." : "O curativo fica firme. O sangramento para.");
          tags.push("treated");
        } else {
          w.bleedingRate = Math.round(w.bleedingRate * 0.6 * 10) / 10;
          char.status.pain = clamp(char.status.pain + 10, 0, 100);
          ctx.lines.push("Suas mãos tremem. O curativo fica frouxo e logo se encharca.");
        }
        report.success = r.success;
      } else report.success = true;
      char.status.pain = computePain(char, ctx.minute);
      report.summary = report.success ? "Ferimento tratado." : "O tratamento não saiu como esperado.";
      break;
    }
    case "tomar_analgesico":
      applyEffects(char, [{ op: "useCharge", item: "analgesico" }, { op: "painkiller", minutes: PAINKILLER_MINUTES }], ctx);
      pass(minutes, "idle");
      char.status.pain = computePain(char, ctx.minute);
      ctx.lines.push("Em meia hora a dor vira um incômodo distante.");
      report.success = true;
      report.summary = "Tomou analgésico.";
      break;
    case "montar_abrigo": {
      pass(minutes, "heavy");
      if (!char.alive) break;
      const r = rollCheck(char, { attr: "improviso", base: 50, experience: ["sobrevivencia"], itemBonus: { corda: 15, manta_termica: 10 } }, ctx.rng, ctx.minute);
      ctx.applied.push(`teste improviso: ${r.success ? "sucesso" : "falha"} (${r.chance}%)`);
      if (r.success && locState) {
        locState.shelterBuilt = true;
        ctx.lines.push("Galhos, folhas e o que você tinha à mão: um abrigo baixo, mas que corta o vento.");
        tags.push("shelter");
      } else ctx.lines.push("A estrutura desaba duas vezes. Você desiste, suado e com as mãos arranhadas.");
      report.success = r.success;
      report.summary = r.success ? "Abrigo montado." : "Falhou ao montar abrigo.";
      break;
    }
    case "acender_fogueira": {
      pass(minutes, "light");
      if (!char.alive) break;
      const igniter =
        char.inventory.find((i) => i.itemId === "isqueiro") ??
        char.inventory.find((i) => itemDef(content, i.itemId).properties.ignition)!;
      const wood = char.inventory.find((i) => i.itemId === "galhos_secos")!;
      const igDef = itemDef(content, igniter.itemId);
      if (igDef.properties.wetSensitive && igniter.wetness > 50) {
        applyEffects(char, [{ op: "useCharge", item: igniter.itemId }], ctx);
        ctx.lines.push(`${igDef.name} estão úmidos. Nenhum acende.`);
        report.success = false;
        report.summary = "Não conseguiu acender.";
        break;
      }
      const woodPenalty = wood.wetness > 50 ? -30 : 0;
      const wetPenalty = char.status.wetness > 60 ? -10 : 0;
      const r = rollCheck(char, { attr: "improviso", base: 55 + woodPenalty + wetPenalty, experience: ["sobrevivencia"] }, ctx.rng, ctx.minute);
      ctx.applied.push(`teste improviso: ${r.success ? "sucesso" : "falha"} (${r.chance}%)`);
      if (igniter.durability !== null) applyEffects(char, [{ op: "itemDurability", item: igniter.itemId, delta: -1 }], ctx);
      else applyEffects(char, [{ op: "useCharge", item: igniter.itemId }], ctx);
      if (r.success) {
        removeItem(char, "galhos_secos", 1);
        applyEffects(char, [{ op: "fire", minutes: FIRE_DURATION_MINUTES }, { op: "status", field: "stress", delta: -8 }], ctx);
        ctx.lines.push("A chama pega, tímida, e depois cresce. O calor no rosto é quase doloroso de tão bom.");
        tags.push("fire");
      } else ctx.lines.push("A fumaça sobe, a brasa brilha... e morre.");
      report.success = r.success;
      report.summary = r.success ? "Fogueira acesa." : "Não conseguiu acender.";
      break;
    }
    case "coletar_lenha": {
      pass(minutes, "heavy");
      if (!char.alive) break;
      const wet = world.flags.chovendo ? 70 : 0;
      applyEffects(char, [{ op: "addItem", item: "galhos_secos", qty: 1, state: { wetness: wet } }], ctx);
      ctx.lines.push(wet ? "Você junta um feixe de galhos — úmidos da chuva." : "Você junta um feixe de galhos secos.");
      report.success = true;
      report.summary = "Coletou lenha.";
      break;
    }
    case "pegar_item": {
      const g = world.ground.find((x) => x.id === p.groundItemId)!;
      const qty = p.quantity === undefined ? g.quantity : Number(p.quantity);
      const def = itemDef(content, g.itemId);
      const res = addItem(char, content, ctx.genId, g.itemId, qty, g.state);
      const ok = res.ok || (def.clothing ? addItem(char, content, ctx.genId, g.itemId, qty, g.state, "hands").ok : false);
      if (ok) {
        g.quantity -= qty;
        world.ground = world.ground.filter((x) => x.quantity > 0);
        ctx.lines.push(`Você pega: ${def.name}${qty > 1 ? ` ×${qty}` : ""}.`);
      } else ctx.lines.push("Não coube.");
      pass(minutes, "idle");
      report.success = ok;
      report.summary = ok ? `Pegou ${def.name}.` : "Não conseguiu pegar.";
      break;
    }
    case "largar_item": {
      const it = findItem(char, p.inventoryItemId)!;
      const qty = p.quantity === undefined ? it.quantity : Number(p.quantity);
      const taken = removeInvItem(char, it.id, qty)!;
      world.ground.push({
        id: ctx.genId(),
        locationId: char.status.locationId,
        itemId: taken.itemId,
        quantity: qty,
        state: { battery: taken.battery ?? undefined, durability: taken.durability ?? undefined, usesLeft: taken.usesLeft ?? undefined, contaminated: taken.contaminated, wetness: taken.wetness },
      });
      pass(minutes, "idle");
      ctx.lines.push(`Você deixa ${itemDef(content, taken.itemId).name} no chão.`);
      report.success = true;
      report.summary = "Item largado.";
      break;
    }
    case "mover_item": {
      const it = findItem(char, p.inventoryItemId)!;
      it.container = str(p.container) as Container;
      pass(minutes, "idle");
      report.success = true;
      report.summary = "Inventário reorganizado.";
      ctx.lines.push(`${itemDef(content, it.itemId).name} guardado em outro compartimento.`);
      break;
    }
    case "equipar": {
      const it = findItem(char, p.inventoryItemId)!;
      const cl = itemDef(content, it.itemId).clothing!;
      if (cl.slot === "costas") {
        const old = equippedBackpack(char, content);
        it.container = "equipped";
        if (old) {
          // Os compartimentos passam a ser os da mochila nova; o conteúdo é transferido.
          old.container = "hands";
          const p2 = itemDef(content, it.itemId).properties;
          const sideUsed = containerUsedMl(char, content, "backpack_side");
          if (sideUsed > (p2.sideMl ?? 0)) {
            for (const i of char.inventory.filter((x) => x.container === "backpack_side")) i.container = "backpack_main";
          }
          if (char.inventory.some((i) => i.container === "hands" && i !== old)) {
            world.ground.push({ id: ctx.genId(), locationId: char.status.locationId, itemId: old.itemId, quantity: 1, state: {} });
            char.inventory = char.inventory.filter((i) => i !== old);
            ctx.lines.push(`Você deixa ${itemDef(content, old.itemId).name} no chão.`);
          }
        }
        ctx.lines.push(`Você ajusta as alças de ${itemDef(content, it.itemId).name} e transfere suas coisas.`);
      } else {
        it.container = "equipped";
        ctx.lines.push(`Você veste: ${itemDef(content, it.itemId).name}.`);
      }
      pass(minutes, "idle");
      report.success = true;
      report.summary = "Equipamento atualizado.";
      break;
    }
    case "desequipar": {
      const it = findItem(char, p.inventoryItemId)!;
      it.container = "hands"; // temporário para liberar o slot
      const target = pickContainer(char, content, it.itemId, 1);
      it.container = target && target !== "hands" ? target : "hands";
      pass(minutes, "idle");
      ctx.lines.push(`Você tira: ${itemDef(content, it.itemId).name}.`);
      report.success = true;
      report.summary = "Equipamento atualizado.";
      break;
    }
    case "conversar": {
      const npc = Object.values(content.npcs).find((n) => n.locationId === char.status.locationId)!;
      const intent = ctx.npcIntent && npc.intents.includes(ctx.npcIntent) ? ctx.npcIntent : "outro";
      const rule = content.npcRules[npc.id]?.[intent] ?? content.npcRules[npc.id]?.outro;
      pass(minutes, "idle");
      if (rule) {
        const req = meetsRequirements(char, world, content, rule.requirements);
        if (!req.ok) ctx.lines.push(rule.blockedText ?? `${npc.name} não reage.`);
        else {
          ctx.lines.push(rule.text);
          applyEffects(char, rule.effects, ctx);
          if (rule.check) {
            const r = rollCheck(char, rule.check, ctx.rng, ctx.minute);
            const b = r.success ? rule.success : rule.failure;
            ctx.applied.push(`teste ${rule.check.attr}: ${r.success ? "sucesso" : "falha"} (${r.chance}%)`);
            if (b) {
              ctx.lines.push(b.text);
              applyEffects(char, b.effects, ctx);
            }
            report.success = r.success;
          } else report.success = true;
        }
      }
      tags.push(`npc:${npc.id}:${intent}`);
      report.summary = `Conversou com ${npc.name}.`;
      break;
    }
    default:
      report.summary = "Nada aconteceu.";
  }
  return report;
}
