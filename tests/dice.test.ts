import { beforeEach, describe, expect, it } from "vitest";
import { clientDice, constantRng, diceRng } from "@/server/engine/rng";
import { dcLabel, faceNeeded, resolveLocally, type ChoiceRoll } from "@/client/game/localDice";
import { getDb } from "@/server/db/database";
import { act, freshApp, registered, soloCampaign } from "./helpers";

describe("D20 rolado no aparelho", () => {
  it("diceRng reproduz exatamente as faces enviadas e depois segue o RNG normal", () => {
    const rng = diceRng([7, 20], constantRng(0.5));
    for (const face of [7, 20]) expect(20 - Math.floor(rng() * 20)).toBe(face);
    expect(rng()).toBe(0.5);
    const one = diceRng([1], constantRng(0));
    expect(20 - Math.floor(one() * 20)).toBe(1);
  });

  it("só aceita 1 ou 2 faces inteiras de 1 a 20", () => {
    expect(clientDice([3, 18])).toEqual([3, 18]);
    expect(clientDice([0])).toBeNull();
    expect(clientDice([21])).toBeNull();
    expect(clientDice([2.5])).toBeNull();
    expect(clientDice([1, 2, 3])).toBeNull();
    expect(clientDice("20")).toBeNull();
  });

  it("fala a CD na escala do 5e e diz a face mínima no dado", () => {
    expect([5, 10, 12, 15, 20, 25, 30].map(dcLabel)).toEqual(["Muito fácil", "Fácil", "Média", "Média", "Difícil", "Muito difícil", "Quase impossível"]);
    expect(faceNeeded({ target: 12, modifier: -4, critFailMax: 1 })).toBe(16);
    expect(faceNeeded({ target: 12, modifier: 20, critFailMax: 1 })).toBe(2); // 1 natural sempre falha
    expect(faceNeeded({ target: 30, modifier: 0, critFailMax: 1 })).toBe(20); // só o 20 natural salva
  });

  it("o aparelho aplica as mesmas regras do servidor (desvantagem e críticos)", () => {
    const roll: ChoiceRoll = { attribute: "forca", chance: 50, target: 11, modifier: 0, disadvantage: true, critFailMax: 1, client: true };
    expect(resolveLocally(roll, [15, 9], "forca")).toMatchObject({ value: 9, success: false });
    expect(resolveLocally({ ...roll, disadvantage: false }, [15, 9], "forca")).toMatchObject({ value: 15, success: true });
    expect(resolveLocally({ ...roll, disadvantage: false, modifier: -30 }, [20, 1], "forca")).toMatchObject({ crit: "critical_success", success: true });
    expect(resolveLocally({ ...roll, disadvantage: false, modifier: 30 }, [1, 20], "forca")).toMatchObject({ crit: "critical_failure", success: false });
  });
});

describe("D20 no fluxo real", () => {
  const rollFor = async (faces: number[]) => {
    const a = await registered("Dado");
    const id = await soloCampaign(a.client);
    const before = await a.client.get(`/api/campaigns/${id}/state`);
    const choice = before.body.event.choices.find((c: { id: string }) => c.id === "vs_despertar.examinar");
    const result = await act(a.client, id, "escolha_evento", { choiceId: choice.id, d20: faces });
    expect(result.status).toBe(200);
    return { choice, lastRoll: result.body.state.lastRoll, id };
  };

  describe("DICE_AUTHORITY=client (padrão)", () => {
    beforeEach(async () => {
      await freshApp();
    });

    it("o servidor usa a face rolada no aparelho e o resultado bate com a prévia", async () => {
      const { choice, lastRoll } = await rollFor([20, 20]);
      expect(choice.roll).toMatchObject({ client: true, attribute: "percepcao" });
      expect(lastRoll).toMatchObject({ value: 20, success: true, crit: "critical_success" });
      const again = await rollFor([2, 2]);
      const expected = resolveLocally(again.choice.roll, [2, 2], "percepcao");
      expect(again.lastRoll).toMatchObject({ value: 2, success: expected.success, finalTotal: expected.finalTotal, target: expected.target });
    });
  });

  describe("DICE_AUTHORITY=server", () => {
    beforeEach(async () => {
      await freshApp({ DICE_AUTHORITY: "server" });
    });

    it("ignora a face enviada pelo cliente", async () => {
      const { choice, id } = await rollFor([20, 20]);
      expect(choice.roll.client).toBe(false);
      const row = await getDb().get<{ params: string }>(
        "SELECT params FROM player_actions WHERE campaign_id = ? AND type = 'escolha_evento'",
        id,
      );
      expect(JSON.parse(row!.params)).not.toHaveProperty("d20");
    });
  });
});
