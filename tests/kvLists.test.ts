import { beforeEach, describe, expect, it } from "vitest";
import { freshApp } from "./helpers";
import { kvListAppend, kvListTake, resetKvForTests } from "@/server/kv";

/**
 * Cobre o fallback em memória — o mesmo caminho do código nos testes e o que roda quando o
 * Redis está fora. A semântica (append que não perde o que já estava, teto por `max`) é a
 * mesma dos scripts Lua, então o contrato fica travado aqui.
 */
describe("Filas do KV", () => {
  beforeEach(() => {
    freshApp();
    resetKvForTests();
  });

  it("append preserva o que já estava na fila", async () => {
    await kvListAppend("q", [{ n: 1 }], 30, 64);
    await kvListAppend("q", [{ n: 2 }], 30, 64);
    expect(await kvListTake<{ n: number }>("q", 64)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("drenar entrega uma única vez e esvazia", async () => {
    await kvListAppend("q", [{ n: 1 }, { n: 2 }], 30, 64);
    expect(await kvListTake("q", 64)).toHaveLength(2);
    expect(await kvListTake("q", 64)).toEqual([]);
  });

  it("o teto mantém os mais novos, como o LTRIM do Redis", async () => {
    for (const n of [1, 2, 3, 4, 5]) await kvListAppend("q", [{ n }], 30, 3);
    expect(await kvListTake<{ n: number }>("q", 64)).toEqual([{ n: 3 }, { n: 4 }, { n: 5 }]);
  });

  it("append concorrente não se sobrescreve", async () => {
    // É exatamente a janela que fazia o take-then-push da voz perder ofertas: ler a fila,
    // anexar o seu item e devolver. Com append, tudo que entrou está lá.
    await Promise.all([1, 2, 3, 4].map((n) => kvListAppend("q", [{ n }], 30, 64)));
    const taken = await kvListTake<{ n: number }>("q", 64);
    expect(taken.map((t) => t.n).sort()).toEqual([1, 2, 3, 4]);
  });

  it("take respeita o limite e devolve o que sobra para a próxima", async () => {
    await kvListAppend("q", [1, 2, 3, 4, 5], 30, 64);
    expect(await kvListTake("q", 2)).toEqual([1, 2]);
    expect(await kvListTake("q", 2)).toEqual([3, 4]);
    expect(await kvListTake("q", 2)).toEqual([5]);
  });
});
