import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshApp, registered, soloCampaign } from "./helpers";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/database";
import { addLog } from "@/server/services/stateRepo";
import { pcmToWav, resolveVoiceProfile, synthesizeGeminiSpeech } from "@/server/services/geminiTts";
import { normalizeSpeechPerformance, splitSpeech, type SpeechTone } from "@/shared/speech";
import { resetLibraryCache } from "@/server/services/audioLibrary";

const WAV = pcmToWav(Buffer.alloc(960, 7));

beforeEach(async () => {
  await freshApp({
    TTS_PROVIDER: "gemini",
    GEMINI_API_KEY: "key-one",
    GEMINI_API_KEY2: "key-two",
    GEMINI_TTS_MODELS: "gemini-test-tts",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLibraryCache();
});

describe("Gemini TTS", () => {
  it("busca uma fala já existente no Supabase sem gastar uma chamada Gemini", async () => {
    await freshApp({
      TTS_PROVIDER: "gemini",
      GEMINI_API_KEY: "key-one",
      SUPABASE_URL: "https://audio-teste.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-teste",
    });
    resetLibraryCache();
    const { client } = await registered("Biblioteca");
    const campaignId = await soloCampaign(client);
    await addLog(campaignId, null, 91, "npc", "Uma fala inédita já guardada.", {
      speakerKey: "npc:piloto",
      tone: "neutral",
      voice: "calm conversational voice, natural pace and low volume",
      say: "Uma fala inédita já guardada.",
    });
    const row = await getDb().get<{ id: number }>(
      "SELECT id FROM campaign_log WHERE campaign_id = ? AND speaker_key = 'npc:piloto' ORDER BY id DESC LIMIT 1",
      campaignId,
    );
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      throw new Error("Gemini não deveria ser chamado quando a biblioteca já tem a fala.");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await client.get(`/api/campaigns/${campaignId}/log/${row!.id}/voice`);
    expect(response.status).toBe(307);
    expect(response.headers.get("x-voice-source")).toBe("biblioteca");
    expect(response.headers.get("location")).toContain("/storage/v1/object/public/audio/vozes/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("descarta say quando o modelo muda palavras e divide textos em até 260 caracteres", () => {
    const valid = normalizeSpeechPerformance("Eu ouvi alguma coisa... ali.", {
      tone: "worried",
      voice: "genuinely worried, uneven breath, low volume and cautious pace",
      say: "Eu ouvi alguma coisa... <short pause> ali.",
    });
    expect(valid.say).toContain("<short pause>");

    const changed = normalizeSpeechPerformance("Eu ouvi alguma coisa... ali.", {
      tone: "worried",
      voice: "genuinely worried, uneven breath, low volume and cautious pace",
      say: "Eu ouvi outra coisa... <gasp> ali.",
    });
    expect(changed.say).toBe("Eu ouvi alguma coisa... ali.");

    const chunks = splitSpeech(`${"A chuva engrossa sobre o telhado. ".repeat(12)}Ninguém responde.`, 260);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 260)).toBe(true);

    const taggedChunks = splitSpeech(`${"Escute com atenção agora ".repeat(11)}<long pause> não se mova.`, 80);
    expect(taggedChunks.every((chunk) => chunk.length <= 80)).toBe(true);
    expect(taggedChunks.join(" ")).toContain("<long pause>");
    expect(taggedChunks.join(" ")).not.toContain("<long pause >");
  });

  it("tenta interactions primeiro e gira para a próxima chave ao receber 429", async () => {
    const calls: { key: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const key = new Headers(init?.headers).get("x-goog-api-key") ?? "";
      calls.push({ key, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      if (calls.length === 1) return new Response('{"error":"quota"}', { status: 429 });
      return Response.json({ output_audio: { data: WAV.toString("base64"), mime_type: "audio/wav" } });
    }));

    const result = await synthesizeGeminiSpeech(getConfig(), {
      transcript: "<sigh> Eu não devia ter voltado.",
      style: "truly worried, uneven breath, low volume and cautious pace; at natural native speed",
      profile: resolveVoiceProfile("npc:piloto"),
      scene: "A pilot speaks inside an abandoned radio station during a storm.",
      context: "Você sabia que o avião cairia?",
    });

    expect(result.endpoint).toBe("interactions");
    expect(result.keySlot).toBe(2);
    expect(calls.map((call) => call.key)).toEqual(["key-one", "key-two"]);
    expect(calls[1].body).toMatchObject({
      model: "gemini-test-tts",
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "pt-br-assistant-3" }] },
    });
    expect(result.audio.toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("gera 10 falas com voz fixa, emoção variável e segunda passagem integralmente em cache", async () => {
    const { client } = await registered("Conversa");
    const campaignId = await soloCampaign(client);
    const conversation: Array<{
      speakerKey: string;
      text: string;
      tone: SpeechTone;
      voice: string;
      say: string;
    }> = [
      { speakerKey: "npc:piloto", text: "Eu... achei que vocês não iam chegar.", tone: "sighing", voice: "drained and guarded, slow rhythm, quiet volume and rough breath", say: "<sigh> Eu... achei que vocês não iam chegar." },
      { speakerKey: "npc:iara", text: "Não cheguem perto da torre.", tone: "whispering", voice: "urgent whisper, clipped rhythm, near-silent volume and trembling breath", say: "<whispers> Não cheguem perto da torre." },
      { speakerKey: "npc:piloto", text: "Você não sabe do que está falando!", tone: "annoyed", voice: "annoyed and defensive, sharp rhythm, raised volume and tense jaw", say: "Você não sabe do que está falando!" },
      { speakerKey: "npc:anselmo", text: "Hmm... e quem acendeu a luz lá em cima?", tone: "curious", voice: "carefully curious, measured pace, low volume and searching tone", say: "Hmm... <short pause> e quem acendeu a luz lá em cima?" },
      { speakerKey: "npc:iara", text: "Fui eu. Ou o que sobrou de mim.", tone: "sad", voice: "deeply sad, fragile breath, slow rhythm and subdued volume", say: "Fui eu. <long pause> Ou o que sobrou de mim." },
      { speakerKey: "npc:piloto", text: "Então corre, agora!", tone: "hurried", voice: "hurried and breathless, fast rhythm, low volume and urgent energy", say: "Então corre, agora!" },
      { speakerKey: "npc:anselmo", text: "Correr só faz a mata escolher por você.", tone: "sighing", voice: "weary and certain, slow rhythm, soft volume and audible exhale", say: "<exhales> Correr só faz a mata escolher por você." },
      { speakerKey: "npc:iara", text: "Você ainda fala como se conhecesse a mata.", tone: "amused", voice: "darkly amused, restrained energy, gentle pace and distant voice", say: "<chuckle> Você ainda fala como se conhecesse a mata." },
      { speakerKey: "npc:piloto", text: "Espera... vocês ouviram isso?", tone: "surprised", voice: "genuinely surprised, voice rising, then a sharp frightened breath", say: "Espera... <gasp> vocês ouviram isso?" },
      { speakerKey: "npc:anselmo", text: "Ouvi. E agora ela também ouviu vocês.", tone: "tender", voice: "quietly tender, grave tone, unhurried rhythm and protective warmth", say: "Ouvi. <short pause> E agora ela também ouviu vocês." },
    ];

    for (const line of conversation) {
      await addLog(campaignId, null, 90, "npc", line.text, {
        speakerKey: line.speakerKey,
        tone: line.tone,
        voice: line.voice,
        say: line.say,
      });
    }
    const ids = await getDb().all<{ id: number; speaker_key: string }>(
      "SELECT id, speaker_key FROM campaign_log WHERE campaign_id = ? AND speaker_key IS NOT NULL ORDER BY id",
      campaignId,
    );

    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ output_audio: { data: WAV.toString("base64"), mime_type: "audio/wav" } });
    }));

    const voices = new Map<string, string>();
    const tones = new Set<string>();
    for (const row of ids) {
      const response = await client.get(`/api/campaigns/${campaignId}/log/${row.id}/voice`);
      expect(response.status).toBe(200);
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect((response.body as Buffer).toString("ascii", 0, 4)).toBe("RIFF");
      expect(response.headers.get("x-voice-source")).toBe("gemini");
      const voice = response.headers.get("x-voice-name")!;
      expect(voices.get(row.speaker_key) ?? voice).toBe(voice);
      voices.set(row.speaker_key, voice);
      tones.add(response.headers.get("x-voice-tone")!);
    }

    expect(ids).toHaveLength(10);
    expect(new Set(voices.values()).size).toBe(3);
    expect(tones.size).toBeGreaterThanOrEqual(7);
    expect(calls).toHaveLength(10);
    const transcripts = calls.map((call) => {
      const input = call.input as Array<{ content: Array<{ text: string; annotations: Array<{ style: string }> }> }>;
      expect(input[0].content[0].annotations[0].style).toContain("at natural native speed");
      return input[0].content[0].text;
    });
    expect(transcripts.some((text) => text.includes("<chuckle>"))).toBe(true);
    expect(transcripts.some((text) => text.includes("<sigh>"))).toBe(true);

    for (const row of ids) {
      const response = await client.get(`/api/campaigns/${campaignId}/log/${row.id}/voice`);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-voice-source")).toBe("cache");
    }
    expect(calls).toHaveLength(10);

    const state = (await client.get(`/api/campaigns/${campaignId}/state`)).body;
    const rendered = state.log.filter((line: { speakerKey: string | null }) => line.speakerKey);
    expect(rendered).toHaveLength(10);
    expect(rendered.every((line: { text: string }) => !/<[a-z]/.test(line.text))).toBe(true);
    expect(rendered.some((line: { voice: string }) => /<(?:sigh|chuckle)>/.test(line.voice))).toBe(true);
  });
});
