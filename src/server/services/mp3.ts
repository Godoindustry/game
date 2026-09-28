/**
 * WAV (PCM 16 bits) → MP3 mono 64 kbps, em JavaScript puro (sem ffmpeg). Voz fica ~6× menor,
 * o que importa para guardar na biblioteca e baixar no celular.
 */
type Encoder = { encodeBuffer(samples: Int16Array): Uint8Array; flush(): Uint8Array };
type EncoderClass = new (channels: number, sampleRate: number, kbps: number) => Encoder;

let encoderClass: Promise<EncoderClass> | null = null;

/**
 * Import dinâmico: a entrada CommonJS do pacote vem vazia em alguns carregadores (tsx),
 * a ESM funciona em todos — e só carrega quando alguém de fato converte áudio.
 */
function loadEncoder(): Promise<EncoderClass> {
  encoderClass ??= import("@breezystack/lamejs").then((mod) => {
    const m = mod as unknown as { Mp3Encoder?: EncoderClass; default?: { Mp3Encoder?: EncoderClass } };
    const found = m.Mp3Encoder ?? m.default?.Mp3Encoder;
    if (!found) throw new Error("Encoder MP3 indisponível.");
    return found;
  });
  return encoderClass;
}

/** PCM 16 bits de um WAV (lê os blocos fmt e data, sem supor cabeçalho de 44 bytes). */
export function readWav(wav: Buffer) {
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

export async function wavToMp3(wav: Buffer, kbps = 64): Promise<Buffer> {
  const Mp3Encoder = await loadEncoder();
  const { sampleRate, channels, samples } = readWav(wav);
  const mono = channels === 1 ? samples : samples.filter((_, i) => i % channels === 0);
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < mono.length; i += 1152) chunks.push(encoder.encodeBuffer(mono.subarray(i, i + 1152)));
  chunks.push(encoder.flush());
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}
