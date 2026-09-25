import { describe, it, expect, beforeEach } from "vitest";
import { freshApp, registered, soloCampaign, act } from "./helpers";
import { getDb } from "@/server/db/database";
import { setConfig, getConfig } from "@/server/config";
import { aiNarrative, aiClassifyIntent, keywordIntent, setProvider } from "@/server/ai/service";
import { MockProvider } from "@/server/ai/providers/mock";

const input = {
  locationName: "Mata do Vale",
  timeLabel: "02:10",
  isNight: true,
  temperatureC: 6,
  actionSummary: "Você examinou a área.",
  facts: ["Há galhos quebrados na altura do peito."],
  characterAlive: true,
};
const ctx = { userId: null, campaignId: null };
const FALLBACK = "texto predefinido";
const statuses = async () => (await getDb().all<{ status: string; used_fallback: number }>("SELECT status, used_fallback FROM ai_requests ORDER BY created_at"));

let mock: MockProvider;
beforeEach(async () => {
  await freshApp();
  mock = new MockProvider();
  setProvider(mock);
});

describe("Fallback da IA", () => {
  it("usa a IA quando ela responde bem e registra consumo", async () => {
    const r = await aiNarrative(ctx, input, FALLBACK);
    expect(r.source).toBe("ai");
    expect(r.text).not.toBe(FALLBACK);
    expect((await statuses())[0].status).toBe("ok");
  });
  it("erro do provedor → texto predefinido", async () => {
    mock.setMode("error");
    const r = await aiNarrative(ctx, input, FALLBACK);
    expect(r).toEqual({ text: FALLBACK, source: "fallback" });
    expect((await statuses())[0]).toMatchObject({ status: "error", used_fallback: 1 });
  });
  it("timeout → texto predefinido", async () => {
    setConfig({ ...getConfig(), AI_TIMEOUT_MS: 50 });
    mock.setMode("timeout");
    const r = await aiNarrative(ctx, input, FALLBACK);
    expect(r.source).toBe("fallback");
    expect((await statuses())[0].status).toBe("timeout");
  });
  it("JSON fora do formato → rejeitado", async () => {
    mock.setMode("invalid");
    expect((await aiNarrative(ctx, input, FALLBACK)).source).toBe("fallback");
    expect((await statuses())[0].status).toBe("rejected");
  });
  it("IA não pode declarar a morte de um personagem vivo", async () => {
    mock.setMode("death_claim");
    expect((await aiNarrative(ctx, input, FALLBACK)).text).toBe(FALLBACK);
  });
  it("conteúdo inadequado / injeção é filtrado", async () => {
    mock.setMode("unsafe");
    expect((await aiNarrative(ctx, input, FALLBACK)).text).toBe(FALLBACK);
  });
  it("respostas iguais vêm do cache", async () => {
    await aiNarrative(ctx, input, FALLBACK);
    const r = await aiNarrative(ctx, input, FALLBACK);
    expect(r.source).toBe("cache");
    expect((await statuses()).map((s) => s.status)).toEqual(["ok", "cache_hit"]);
  });
  it("sem provedor configurado o jogo segue com texto predefinido", async () => {
    setProvider(null);
    expect((await aiNarrative(ctx, input, FALLBACK)).source).toBe("fallback");
    expect((await statuses())[0].status).toBe("disabled");
  });
  it("orçamento diário esgotado bloqueia novas chamadas", async () => {
    setConfig({ ...getConfig(), AI_COST_INPUT_PER_MTOK: 1_000_000, AI_DAILY_BUDGET_USD: 0.01 });
    await aiNarrative(ctx, input, FALLBACK); // custa 120 USD no preço de teste
    const r = await aiNarrative(ctx, { ...input, actionSummary: "outra" }, FALLBACK);
    expect(r.source).toBe("fallback");
    expect((await statuses())[1].status).toBe("budget_exceeded");
  });
  it("prompt grande demais é recusado antes de sair do servidor", async () => {
    setConfig({ ...getConfig(), AI_MAX_PROMPT_CHARS: 50 });
    expect((await aiNarrative(ctx, input, FALLBACK)).source).toBe("fallback");
    expect((await statuses())[0].status).toBe("rejected");
  });
});

describe("Classificação de intenção", () => {
  it("só aceita intenções da lista fechada; senão usa palavras-chave", async () => {
    const allowed = ["perguntar_acidente", "ameacar", "outro"];
    expect(keywordIntent("O que aconteceu com o avião?", allowed)).toBe("perguntar_acidente");
    expect(keywordIntent("Vou te machucar", allowed)).toBe("ameacar");
    const r = await aiClassifyIntent(ctx, { npcName: "Brandão", message: "o que aconteceu com o voo?", allowedIntents: allowed });
    expect(r.intent).toBe("perguntar_acidente");
    expect(r.source).toBe("keywords");
  });
});

describe("O jogo não depende da IA", () => {
  it("com a IA falhando, ações resolvem normalmente com os fatos do motor", async () => {
    mock.setMode("error");
    const { client } = await registered("Lia");
    const id = await soloCampaign(client);
    const r = await act(client, id, "escolha_evento", { choiceId: "vs_despertar.gritar" });
    expect(r.status).toBe(200);
    expect(r.body.state.campaign.round).toBe(2);
    expect(r.body.state.log.some((l: { text: string }) => l.text.includes("mata inteira se cala"))).toBe(true);
  });
});

describe("Cadeia de provedores (Groq → OpenRouter → Gemini)", () => {
  it("se o primeiro falha, o segundo responde; se todos falham, fallback", async () => {
    const { ChainProvider } = await import("@/server/ai/providers/chain");
    const down = new MockProvider("error");
    const ok = new MockProvider("ok");
    setProvider(new ChainProvider([down, ok]));
    const r = await aiNarrative(ctx, input, FALLBACK);
    expect(r.source).toBe("ai");
    expect((await getDb().get<{ provider: string }>("SELECT provider FROM ai_requests ORDER BY created_at DESC LIMIT 1"))!.provider).toBe("mock");
    setProvider(new ChainProvider([new MockProvider("error"), new MockProvider("invalid")]));
    expect((await aiNarrative(ctx, { ...input, actionSummary: "x" }, FALLBACK)).source).toBe("fallback");
  });
  it("frases de calma com negação não são lidas como ameaça", () => {
    expect(keywordIntent("Fica calmo, não vou te machucar", ["acalmar", "ameacar", "outro"])).toBe("acalmar");
    expect(keywordIntent("Vou te machucar se não falar", ["acalmar", "ameacar", "outro"])).toBe("ameacar");
  });
});
