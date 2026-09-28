import { describe, expect, it } from "vitest";
import { sheetDelta } from "@/client/game/sheetDelta";
import type { GameState } from "@/client/game/useGame";

type Me = NonNullable<GameState["me"]>;

const base = {
  alive: true,
  lineage: { key: "human", label: "Humano" },
  health: { health: 90 },
  status: { pain: 10, stress: 30, hunger: 20, thirst: 20 },
  wounds: [] as { id: string; type: string; bodyPart: string; bleedingRate: number }[],
  inventory: [{ itemId: "barra_cereal", name: "Barra de cereal", quantity: 2 }],
};
const me = (patch: Record<string, unknown> = {}) => ({ ...structuredClone(base), ...patch }) as unknown as Me;

describe("O que mudou na ficha", () => {
  it("anuncia dano, ferimento sangrando e item encontrado", () => {
    const after = me({
      health: { health: 82 },
      status: { ...base.status, pain: 22 },
      wounds: [{ id: "w1", type: "laceracao", bodyPart: "braco_esq", bleedingRate: 1.4 }],
      inventory: [...base.inventory, { itemId: "lanterna", name: "Lanterna", quantity: 1 }],
    });
    expect(sheetDelta(me(), after)).toEqual([
      { label: "Vida -8", tone: "bad" },
      { label: "Laceração · Braço esq. (sangrando)", tone: "bad" },
      { label: "+ Lanterna", tone: "good" },
      { label: "Dor +12", tone: "bad" },
    ]);
  });

  it("não anuncia o desgaste lento do tempo nem o que não mudou", () => {
    const after = me({ health: { health: 89.6 }, status: { ...base.status, hunger: 24, thirst: 26 } });
    expect(sheetDelta(me(), after)).toEqual([]);
  });

  it("anuncia item gasto, sangramento contido e cura", () => {
    const before = me({ wounds: [{ id: "w1", type: "laceracao", bodyPart: "braco_esq", bleedingRate: 1.4 }] });
    const after = me({
      health: { health: 95 },
      wounds: [{ id: "w1", type: "laceracao", bodyPart: "braco_esq", bleedingRate: 0 }],
      inventory: [{ itemId: "barra_cereal", name: "Barra de cereal", quantity: 1 }],
    });
    expect(sheetDelta(before, after)).toEqual([
      { label: "Vida +5", tone: "good" },
      { label: "Sangramento contido", tone: "good" },
      { label: "− Barra de cereal", tone: "neutral" },
    ]);
  });
});
