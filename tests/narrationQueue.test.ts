import { describe, expect, it } from "vitest";
import { narrationQueue } from "@/client/game/narrationQueue";

describe("narrationQueue", () => {
  it("não lê o resultado e a recontagem da mesma escolha", () => {
    const lines = [
      { id: 1, kind: "result", characterId: "a", text: "A porta cede." },
      { id: 2, kind: "narrative", characterId: "a", text: "A porta cede." },
    ];
    expect(narrationQueue(lines).map((l) => l.id)).toEqual([2]);
  });

  it("prefere a fala do NPC ao resumo da conversa", () => {
    const lines = [
      { id: 1, kind: "result", characterId: "a", text: "Você conversa com Iara." },
      { id: 2, kind: "npc", characterId: "a", text: "Não saia depois da meia-noite." },
    ];
    expect(narrationQueue(lines).map((l) => l.id)).toEqual([2]);
  });

  it("mantém resultados de personagens diferentes e a cena nova", () => {
    const lines = [
      { id: 1, kind: "result", characterId: "a", text: "Você acende a lanterna." },
      { id: 2, kind: "result", characterId: "b", text: "Você fecha a janela." },
      { id: 3, kind: "event", characterId: null, text: "【Poço】 Algo sobe pela corda." },
    ];
    expect(narrationQueue(lines).map((l) => l.id)).toEqual([1, 2, 3]);
  });

  it("descarta texto repetido dentro da linha seguinte", () => {
    const lines = [
      { id: 1, kind: "narrative", characterId: null, text: "O rádio chia." },
      { id: 2, kind: "event", characterId: null, text: "【Rádio】 O rádio chia. Uma voz chama seu nome." },
    ];
    expect(narrationQueue(lines).map((l) => l.id)).toEqual([2]);
  });
});
