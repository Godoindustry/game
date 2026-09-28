/**
 * Gera o pacote de narração (mesmo formato do Chatterbox: public/audio/narracao/*.mp3 +
 * src/server/content/narracao.json) UMA vez. Depois o jogo só toca os arquivos.
 *
 * Motores:
 *  - piper (padrão): TTS neural local, grátis, roda na CPU (~15x mais rápido que o tempo real).
 *      PIPER_EXE=".../piper.exe" PIPER_VOICE=".../pt_BR-faber-medium.onnx" npm run narration:generate
 *      Baixe em https://github.com/rhasspy/piper/releases e https://huggingface.co/rhasspy/piper-voices
 *  - gemini: usa GEMINI_API_KEY (cota gratuita pequena; pode custar).
 *      NARRATION_ENGINE=gemini npm run narration:generate
 *
 * NARRATION_LIMIT=20 gera só as próximas 20. NARRATION_FORCE=1 regera tudo (troca de voz).
 * Retomável: pula falas já geradas com o mesmo texto e grava o índice a cada fala.
 * A voz do Colab/Chatterbox (npm run narration:import) substitui este pacote quando vier.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfig } from "../src/server/config";
import { VALE_SILENTE } from "../src/server/content/valeSilente";
import { narrationScript, type NarrationEmotion, type NarrationIndex, type NarrationLine } from "../src/server/services/narrationPack";
import { resolveVoiceProfile, synthesizeGeminiSpeech } from "../src/server/services/geminiTts";

const OUT = path.resolve("public", "audio", "narracao");
const INDEX = path.resolve("src", "server", "content", "narracao.json");
const ENGINE = process.env.NARRATION_ENGINE ?? "piper";
const LIMIT = Number(process.env.NARRATION_LIMIT ?? Infinity);
const FORCE = process.env.NARRATION_FORCE === "1";

/** Piper: ritmo por emoção (length_scale > 1 = mais devagar). */
const PIPER_PACE: Record<NarrationEmotion, number> = { tenso: 1.02, normal: 1.08, calmo: 1.14, triste: 1.18 };

const GEMINI_STYLE: Record<NarrationEmotion, string> = {
  calmo: "Brazilian Portuguese horror audiobook narrator. Low, calm and intimate voice, unhurried natural pace, gentle pauses between sentences.",
  normal: "Brazilian Portuguese horror audiobook narrator. Grave, natural storytelling voice, steady pace, clear diction, subtle tension.",
  tenso: "Brazilian Portuguese horror audiobook narrator. Tense and suspenseful, low voice close to the microphone, slightly faster pace, dread in every sentence.",
  triste: "Brazilian Portuguese horror audiobook narrator. Sad and heavy voice, slow pace, quiet ending of each sentence.",
};

type Encoder = { encodeBuffer(samples: Int16Array): Uint8Array; flush(): Uint8Array };
type EncoderClass = new (channels: number, sampleRate: number, kbps: number) => Encoder;
let Mp3Encoder: EncoderClass;

/** PCM 16 bits de um WAV (lê os blocos fmt e data, sem supor cabeçalho de 44 bytes). */
function readWav(wav: Buffer) {
  let offset = 12;
  let sampleRate = 24_000;
  let channels = 1;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = wav.readUInt16LE(offset + 10);
      sampleRate = wav.readUInt32LE(offset + 12);
    }
    if (id === "data") {
      const data = Buffer.from(wav.subarray(offset + 8, offset + 8 + size));
      return { sampleRate, channels, samples: new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2)) };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV sem bloco de dados.");
}

function toMp3(wav: Buffer): Buffer {
  const { sampleRate, channels, samples } = readWav(wav);
  const mono = channels === 1 ? samples : samples.filter((_, i) => i % channels === 0);
  const encoder = new Mp3Encoder(1, sampleRate, 64);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < mono.length; i += 1152) chunks.push(encoder.encodeBuffer(mono.subarray(i, i + 1152)));
  chunks.push(encoder.flush());
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

function piperWav(line: NarrationLine): Buffer {
  const exe = process.env.PIPER_EXE;
  const voice = process.env.PIPER_VOICE;
  if (!exe || !voice) throw new Error("Defina PIPER_EXE e PIPER_VOICE (veja o topo deste script).");
  const out = path.join(os.tmpdir(), `narracao-${process.pid}.wav`);
  execFileSync(exe, ["-m", voice, "-f", out, "--length_scale", String(PIPER_PACE[line.emotion]), "--sentence_silence", "0.35"], {
    input: line.spoken,
    stdio: ["pipe", "ignore", "ignore"],
  });
  const wav = fs.readFileSync(out);
  fs.rmSync(out, { force: true });
  return wav;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geminiWav(line: NarrationLine, previous: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await synthesizeGeminiSpeech(getConfig(), {
        transcript: line.spoken,
        style: GEMINI_STYLE[line.emotion],
        profile: resolveVoiceProfile("narrator", "narrative", ""),
        scene: "Narration of a survival horror story set after a plane crash in Vale Silente, a haunted valley in rural Brazil.",
        context: previous,
      });
      return result.audio;
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (!/\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(message) || attempt >= 4) throw error;
      console.warn(`Limite do Gemini; esperando ${20 * attempt}s...`);
      await sleep(20_000 * attempt);
    }
  }
}

async function main() {
  // O pacote expõe o encoder de jeitos diferentes em ESM e CJS.
  const lame = (await import("@breezystack/lamejs")) as unknown as { Mp3Encoder?: EncoderClass; default?: { Mp3Encoder: EncoderClass } };
  Mp3Encoder = lame.Mp3Encoder ?? lame.default!.Mp3Encoder;

  fs.mkdirSync(OUT, { recursive: true });
  const index: NarrationIndex = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, "utf8")) : { versao: 1, eventos: {} };
  const save = () => fs.writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  const lines = narrationScript(VALE_SILENTE);
  const pending = lines.filter((line) => {
    if (FORCE) return true;
    const entry = index.eventos[line.key]?.[0];
    return !(entry && entry.texto === line.spoken && fs.existsSync(path.join(OUT, entry.arquivo)));
  });
  console.log(`Motor: ${ENGINE}. ${lines.length - pending.length} já prontas, ${pending.length} para gerar.`);

  let done = 0;
  let previous = "No previous spoken line.";
  const started = Date.now();
  for (const line of pending) {
    if (done >= LIMIT) break;
    try {
      const wav = ENGINE === "gemini" ? await geminiWav(line, previous) : piperWav(line);
      const file = `${line.key}_01.mp3`;
      fs.writeFileSync(path.join(OUT, file), toMp3(wav));
      index.eventos[line.key] = [{ arquivo: file, texto: line.spoken }];
      save();
      done++;
      previous = line.spoken;
      if (done % 25 === 0 || done === pending.length) console.log(`${done}/${pending.length} (${Math.round((Date.now() - started) / 1000)}s)`);
    } catch (error) {
      console.error(`Falhou em ${line.key}: ${String((error as Error)?.message ?? error).slice(0, 300)}`);
      if (ENGINE === "gemini") {
        console.error("Parando: rode de novo mais tarde; o que já foi gerado fica salvo.");
        break;
      }
    }
  }
  console.log(`Pronto: ${done} falas geradas nesta rodada. Reinicie o servidor para o índice valer.`);
}

void main();
