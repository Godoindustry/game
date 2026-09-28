/**
 * Verificação manual do Gemini TTS com dez falas.
 * Salva WAVs e relatório em data/voice-test-gemini (diretório ignorado pelo Git).
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../src/server/config";
import { sha256 } from "../src/server/services/ids";
import { resolveVoiceProfile, synthesizeGeminiSpeech } from "../src/server/services/geminiTts";
import { extractGeminiSoundTags, stripVoiceTags } from "../src/shared/voiceTags";
import { normalizeSpeechPerformance, speechStyle, type SpeechTone } from "../src/shared/speech";

interface TestLine {
  speakerKey: string;
  text: string;
  tone: SpeechTone;
  voice: string;
  say: string;
}

const conversation: TestLine[] = [
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

const requestedLimit = Number(process.env.VOICE_TEST_LIMIT ?? conversation.length);
const testConversation = conversation.slice(0, Number.isInteger(requestedLimit) ? Math.max(1, Math.min(conversation.length, requestedLimit)) : conversation.length);

const outputDir = path.resolve("data", "voice-test-gemini");
const config = getConfig();
const nativeFetch = globalThis.fetch;
let apiCalls = 0;
globalThis.fetch = async (...args) => {
  apiCalls++;
  return nativeFetch(...args);
};

async function render(index: number, line: TestLine) {
  const profile = resolveVoiceProfile(line.speakerKey);
  const performance = normalizeSpeechPerformance(line.text, line, line.tone);
  const style = speechStyle(performance, config.TTS_SPEECH_LEVEL);
  const cacheKey = sha256(`pt-BR|${profile.key}|${profile.voice}|${style}|${performance.say}`);
  const file = path.join(outputDir, `${String(index + 1).padStart(2, "0")}-${line.speakerKey.replace(":", "-")}-${cacheKey.slice(0, 10)}.wav`);
  try {
    const cached = await readFile(file);
    assert.equal(cached.toString("ascii", 0, 4), "RIFF");
    return { file, cacheKey, source: "disk-cache", profile, performance, model: "cached", endpoint: "cached" };
  } catch {
    const result = await synthesizeGeminiSpeech(config, {
      transcript: performance.say,
      style,
      profile,
      scene: "Three survivors whisper inside an abandoned radio station during a violent storm in Vale Silente, Brazil.",
      context: index ? testConversation[index - 1].text : "No previous spoken line.",
    });
    assert.equal(result.audio.toString("ascii", 0, 4), "RIFF");
    await writeFile(file, result.audio);
    return { file, cacheKey, source: "gemini", profile, performance, model: result.model, endpoint: result.endpoint };
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const first = [];
  for (let index = 0; index < testConversation.length; index++) first.push(await render(index, testConversation[index]));
  const callsAfterFirstPass = apiCalls;
  const second = [];
  for (let index = 0; index < testConversation.length; index++) second.push(await render(index, testConversation[index]));

  const voiceBySpeaker = new Map<string, string>();
  for (const [index, item] of first.entries()) {
    const previous = voiceBySpeaker.get(item.profile.key);
    if (previous) assert.equal(previous, item.profile.voice);
    voiceBySpeaker.set(item.profile.key, item.profile.voice);
    assert.equal(stripVoiceTags(item.performance.say), testConversation[index].text);
  }
  assert.equal(new Set(voiceBySpeaker.values()).size, voiceBySpeaker.size);
  if (testConversation.length === conversation.length) {
    assert.ok(new Set(first.map((item) => item.performance.tone)).size >= 7);
    assert.ok(first.some((item) => extractGeminiSoundTags(item.performance.say).includes("chuckle")));
    assert.ok(first.some((item) => extractGeminiSoundTags(item.performance.say).includes("sigh")));
  }
  assert.equal(apiCalls, callsAfterFirstPass, "a segunda passagem não deveria chamar a API");
  assert.ok(second.every((item) => item.source === "disk-cache"));

  const report = {
    generatedAt: new Date().toISOString(),
    lineCount: testConversation.length,
    firstPassApiCalls: callsAfterFirstPass,
    secondPassAdditionalApiCalls: apiCalls - callsAfterFirstPass,
    voices: Object.fromEntries(voiceBySpeaker),
    distinctTones: [...new Set(first.map((item) => item.performance.tone))],
    soundTags: [...new Set(first.flatMap((item) => extractGeminiSoundTags(item.performance.say)))],
    lines: first.map((item, index) => ({
      index: index + 1,
      speaker: item.profile.name,
      speakerKey: item.profile.key,
      voice: item.profile.voice,
      tone: item.performance.tone,
      say: item.performance.say,
      source: item.source,
      model: item.model,
      endpoint: item.endpoint,
      file: path.relative(process.cwd(), item.file),
    })),
  };
  await writeFile(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
