/**
 * O que a última escolha mudou na ficha — o "−8 PV, +1 lanterna" que todo mestre anuncia.
 * Compara duas fotos do personagem; só entra o que o jogador precisa saber agora.
 */
import type { GameState } from "./useGame";
import { PART_LABEL, WOUND_LABEL } from "../labels";

type Me = NonNullable<GameState["me"]>;

export interface SheetChange {
  label: string;
  tone: "good" | "bad" | "neutral";
}

/** Vida e estados que sobem por conta própria com o tempo só aparecem com salto real. */
const STATUS: { key: "pain" | "stress" | "hunger" | "thirst"; label: string; min: number }[] = [
  { key: "pain", label: "Dor", min: 5 },
  { key: "stress", label: "Estresse", min: 8 },
  { key: "hunger", label: "Fome", min: 10 },
  { key: "thirst", label: "Sede", min: 10 },
];

function itemCounts(me: Me): Map<string, { name: string; qty: number }> {
  const counts = new Map<string, { name: string; qty: number }>();
  for (const item of me.inventory) {
    const entry = counts.get(item.itemId) ?? { name: item.name, qty: 0 };
    entry.qty += item.quantity;
    counts.set(item.itemId, entry);
  }
  return counts;
}

export function sheetDelta(before: Me, after: Me): SheetChange[] {
  const changes: SheetChange[] = [];

  const health = Math.round(after.health.health - before.health.health);
  if (health <= -1) changes.push({ label: `Vida ${health}`, tone: "bad" });
  else if (health >= 1) changes.push({ label: `Vida +${health}`, tone: "good" });

  const known = new Set(before.wounds.map((w) => w.id));
  for (const wound of after.wounds.filter((w) => !known.has(w.id))) {
    const bleeding = wound.bleedingRate > 0 ? " (sangrando)" : "";
    const part = PART_LABEL[wound.bodyPart] ?? wound.bodyPart;
    changes.push({ label: `${WOUND_LABEL[wound.type] ?? "Ferimento"} · ${part}${bleeding}`, tone: "bad" });
  }
  const wasBleeding = before.wounds.some((w) => w.bleedingRate > 0);
  const bleeding = after.wounds.some((w) => w.bleedingRate > 0);
  if (wasBleeding && !bleeding) changes.push({ label: "Sangramento contido", tone: "good" });

  const had = itemCounts(before);
  const has = itemCounts(after);
  for (const [id, now] of has) {
    const diff = now.qty - (had.get(id)?.qty ?? 0);
    if (diff > 0) changes.push({ label: `+ ${diff > 1 ? `${diff} ` : ""}${now.name}`, tone: "good" });
  }
  for (const [id, old] of had) {
    const diff = old.qty - (has.get(id)?.qty ?? 0);
    if (diff > 0) changes.push({ label: `− ${diff > 1 ? `${diff} ` : ""}${old.name}`, tone: "neutral" });
  }

  for (const { key, label, min } of STATUS) {
    const diff = Math.round(after.status[key] - before.status[key]);
    if (diff >= min) changes.push({ label: `${label} +${diff}`, tone: "bad" });
    else if (diff <= -min) changes.push({ label: `${label} ${diff}`, tone: "good" });
  }

  if (before.lineage.key !== after.lineage.key) changes.push({ label: `Linhagem: ${after.lineage.label}`, tone: "neutral" });
  if (before.alive && !after.alive) changes.unshift({ label: "Você morreu", tone: "bad" });
  return changes;
}
