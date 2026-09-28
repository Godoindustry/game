import { describe, expect, it } from "vitest";
import { ChainProvider } from "@/server/ai/providers/chain";
import { createProvider } from "@/server/ai/service";
import type { AIProvider, ProviderCall } from "@/server/ai/types";
import { getConfig } from "@/server/config";

/** Chave falsa: responde com o próprio nome, ou falha como um 429. */
function key(name: string, calls: string[], fail = false): AIProvider {
  const answer = async () => {
    calls.push(name);
    if (fail) throw new Error("groq HTTP 429 rate limit");
    return { data: { text: name } };
  };
  return {
    name: "groq",
    model: "modelo-teste",
    generateNarrative: answer,
    generateNpcResponse: answer,
    generateClueDescription: answer,
    classifyPlayerIntent: answer,
    decideCreatureAttitude: answer,
  } as unknown as AIProvider;
}

const call: ProviderCall = { maxTokens: 50, signal: new AbortController().signal };
const narrate = (p: AIProvider) => (p.generateNarrative as (i: never, c: ProviderCall) => Promise<{ data: unknown }>)({} as never, call);

describe("Rodízio de chaves da IA", () => {
  it("cada chamada começa pela próxima chave", async () => {
    const calls: string[] = [];
    const pool = new ChainProvider([key("A", calls), key("B", calls), key("C", calls)], { name: "groq", rotate: true });
    for (let i = 0; i < 4; i++) await narrate(pool);
    expect(calls).toEqual(["A", "B", "C", "A"]);
  });

  it("chave no limite (429) passa na hora para a seguinte", async () => {
    const calls: string[] = [];
    const pool = new ChainProvider([key("A", calls, true), key("B", calls)], { name: "groq", rotate: true });
    expect((await narrate(pool)).data).toEqual({ text: "B" });
    expect(calls).toEqual(["A", "B"]);
  });

  it("várias GROQ_API_KEY viram um rodízio dentro da cadeia", () => {
    const provider = createProvider({
      ...getConfig(),
      AI_PROVIDER: "chain",
      AI_CHAIN: "groq",
      GROQ_API_KEY: "gsk_teste_1",
      GROQ_API_KEY2: "gsk_teste_2",
      GROQ_API_KEY3: undefined,
      GROQ_API_KEY4: undefined,
    });
    expect(provider?.name).toBe("chain");
    expect(provider?.model).toBe("groq");
  });
});
