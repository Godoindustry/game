import { describe, it, expect, beforeEach } from "vitest";
import { freshApp, registered, soloCampaign, act } from "./helpers";
import { stripVoiceTags, toVoiceText, extractVoiceTags, VOICE_TAGS } from "@/shared/voiceTags";
import { VALE_SILENTE } from "@/server/content/valeSilente";
import { aiNarrative, setProvider } from "@/server/ai/service";
import type { AIProvider, ProviderResult } from "@/server/ai/types";

beforeEach(async () => {
  await freshApp();
});

describe("Tags de expressão (voz)", () => {
  it("a tela recebe o texto limpo; a voz mantém só as tags permitidas", () => {
    const raw = "[whispers] “sete… quatro… zero…” [pause] Ninguém [inventada] sabe.";
    expect(stripVoiceTags(raw)).toBe("“sete… quatro… zero…” Ninguém sabe.");
    expect(toVoiceText(raw)).toBe("[whispers] “sete… quatro… zero…” [pause] Ninguém sabe.");
    expect(extractVoiceTags(raw)).toEqual(["whispers", "pause"]);
  });

  it("não confunde com texto comum nem com títulos 【…】", () => {
    expect(stripVoiceTags("【Evento】 Texto [Nota 1] fim.")).toBe("【Evento】 Texto [Nota 1] fim.");
  });

  it("todas as tags usadas no conteúdo da campanha existem na lista permitida", () => {
    const texts: string[] = [];
    for (const ev of VALE_SILENTE.events) {
      texts.push(ev.body);
      for (const ch of ev.choices) texts.push(ch.outcome.text, ch.outcome.success?.text ?? "", ch.outcome.failure?.text ?? "");
    }
    for (const e of Object.values(VALE_SILENTE.endings)) texts.push(e.text);
    const used = new Set<string>();
    for (const t of texts) for (const m of t.matchAll(/\[([a-z][a-z ]{1,24})\]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(10);
    for (const tag of used) expect(Object.keys(VOICE_TAGS), `tag desconhecida: [${tag}]`).toContain(tag);
  });

  it("a API entrega evento, diário e final sem tags na tela e com tags na voz", async () => {
    const { client } = await registered("Voz");
    const id = await soloCampaign(client);
    const s = (await client.get(`/api/campaigns/${id}/state`)).body;
    expect(s.event.body).not.toMatch(/\[[a-z]/);
    expect(s.event.voice).toContain("[exhales]");
    expect(s.event.voice).toContain("[whispers] “sete… quatro… zero…”");
    for (const l of s.log) expect(l.text).not.toMatch(/\[[a-z]/);
    expect(s.log.some((l: { voice: string }) => /\[[a-z]/.test(l.voice))).toBe(true);
    // final: encerra e confere o texto do final
    await act(client, id, "escolha_evento", { choiceId: "vs_despertar.gritar" });
    await client.post(`/api/campaigns/${id}/end`);
    const end = (await client.get(`/api/campaigns/${id}/state`)).body;
    for (const l of end.log) expect(l.text).not.toMatch(/\[[a-z]/);
  });

  it("a IA só consegue usar tags da lista: inventadas são removidas, permitidas ficam", async () => {
    const fake: AIProvider = {
      name: "fake",
      model: "fake-1",
      generateNarrative: async (): Promise<ProviderResult> => ({ data: { text: "[whispers] A mata respira. [screams dramatically] Algo estala." } }),
      generateNpcResponse: async () => ({ data: null }),
      generateClueDescription: async () => ({ data: null }),
      classifyPlayerIntent: async () => ({ data: null }),
    };
    setProvider(fake);
    const r = await aiNarrative(
      { userId: null, campaignId: null },
      { locationName: "Mata", timeLabel: "01:00", isNight: true, temperatureC: 5, actionSummary: "Examinou.", facts: ["[tense] Galhos quebrados."], characterAlive: true },
      "fallback",
    );
    expect(r.source).toBe("ai");
    expect(r.text).toBe("[whispers] A mata respira. Algo estala.");
    expect(stripVoiceTags(r.text)).toBe("A mata respira. Algo estala.");
  });
});
