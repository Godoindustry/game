import { describe, expect, it } from "vitest";
import { readWav, wavToMp3 } from "@/server/services/mp3";

function sineWav(): Buffer {
  const sampleRate = 24_000;
  const pcm = Buffer.alloc(sampleRate * 2);
  for (let i = 0; i < sampleRate; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 8_000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

describe("Conversor WAV para MP3", () => {
  it("lê PCM mono e gera um quadro MP3 reproduzível", async () => {
    const wav = sineWav();
    expect(readWav(wav)).toMatchObject({ sampleRate: 24_000, channels: 1 });
    const mp3 = await wavToMp3(wav);
    expect(mp3.length).toBeGreaterThan(4_000);
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xe0).toBe(0xe0);
  });
});
