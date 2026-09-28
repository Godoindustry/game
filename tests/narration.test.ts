import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VALE_SILENTE } from "@/server/content/valeSilente";
import { narrationForLog, narrationScript, splitForSpeech, type NarrationIndex } from "@/server/services/narrationPack";
import { ALL_CUES, DICE, PIXABAY_WANTED, choiceCue } from "@/client/game/choiceSfx";

const script = narrationScript(VALE_SILENTE);
const line = (key: string) => script.find((l) => l.key === key)!;

// Índice como se o Colab tivesse gerado a cena de abertura (2 partes) e a falha do cinto.
const generated = ["vs_despertar_cena_p1", "vs_despertar_cena_p2", "vs_despertar_examinar_texto", "vs_despertar_examinar_falha"];
const INDEX: NarrationIndex = {
  versao: 1,
  eventos: Object.fromEntries(generated.map((key) => [key, [{ arquivo: `${key}_01.mp3`, texto: line(key).spoken }]])),
};

describe("Narração pré-gerada", () => {
  it("exporta chaves únicas, só [a-z0-9_], sem tags nem quebras de linha", () => {
    const keys = script.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of script) {
      expect(l.key).toMatch(/^[a-z0-9_]+$/);
      expect(l.spoken).not.toMatch(/\[|】|\n|\|/);
    }
    expect(line("vs_despertar_examinar_falha").emotion).toBe("tenso");
  });

  it("divide textos longos em frases inteiras", () => {
    const parts = splitForSpeech(`${"Frase curta. ".repeat(40)}Fim.`);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(260);
    expect(parts.join(" ")).toContain("Fim.");
  });

  it("casa a linha do diário com as partes geradas, em ordem, e ignora o que não foi gerado", () => {
    const event = VALE_SILENTE.events.find((e) => e.id === "vs_despertar")!;
    expect(narrationForLog(VALE_SILENTE, `【${event.title}】 ${event.body}`, INDEX)).toEqual([
      "/audio/narracao/vs_despertar_cena_p1_01.mp3",
      "/audio/narracao/vs_despertar_cena_p2_01.mp3",
    ]);
    const examinar = event.choices.find((c) => c.id === "vs_despertar.examinar")!.outcome;
    expect(narrationForLog(VALE_SILENTE, [examinar.text, examinar.failure!.text].join("\n"), INDEX)).toEqual([
      "/audio/narracao/vs_despertar_examinar_texto_01.mp3",
      "/audio/narracao/vs_despertar_examinar_falha_01.mp3",
    ]);
    // O sucesso não foi gerado: só a parte que existe toca.
    expect(narrationForLog(VALE_SILENTE, [examinar.text, examinar.success!.text].join("\n"), INDEX)).toEqual([
      "/audio/narracao/vs_despertar_examinar_texto_01.mp3",
    ]);
    expect(narrationForLog(VALE_SILENTE, "Uma frase que não existe no conteúdo.", INDEX)).toEqual([]);
  });

  it("não toca fala gerada para um texto que mudou depois da geração", () => {
    const stale: NarrationIndex = {
      versao: 1,
      eventos: { vs_despertar_examinar_texto: [{ arquivo: "velho_01.mp3", texto: "Texto antigo." }] },
    };
    const examinar = VALE_SILENTE.events.find((e) => e.id === "vs_despertar")!.choices.find((c) => c.id === "vs_despertar.examinar")!.outcome;
    expect(narrationForLog(VALE_SILENTE, examinar.text, stale)).toEqual([]);
  });
});

describe("Sons das escolhas", () => {
  const exists = (id: string) => fs.existsSync(path.join(process.cwd(), "public", "audio", `${id}.mp3`));

  it("todo som é um arquivo existente ou está na lista de download do Pixabay", () => {
    for (const cue of [...ALL_CUES, ...Object.values(DICE)]) {
      expect(cue.want).toMatch(/^[a-z-]+\/[a-z0-9-]+$/);
      expect(exists(cue.want) || cue.want in PIXABAY_WANTED, cue.want).toBe(true);
      if (cue.fallback) expect(exists(cue.fallback), cue.fallback).toBe(true);
    }
  });

  it("a lista do Pixabay só tem sons que o jogo usa", () => {
    const used = new Set([...ALL_CUES, ...Object.values(DICE)].map((c) => c.want));
    for (const id of Object.keys(PIXABAY_WANTED)) expect(used.has(id), `${id} não é usado`).toBe(true);
  });

  it("gritar, acenar e chamar pedem o grito de socorro", () => {
    expect(choiceCue("Acenar e gritar")?.want).toBe("jogador/grito-socorro");
    expect(choiceCue("Gritar pelo piloto")?.want).toBe("jogador/grito-socorro");
    expect(choiceCue("Chamar por alguém")?.want).toBe("jogador/grito-socorro");
  });
});
