/**
 * Gera as narrações em public/audio com a ElevenLabs.
 *
 *   npm run audio:generate
 *
 * Variáveis (.env.local — NUNCA no código):
 *   ELEVENLABS_API_KEY   chave da ElevenLabs (obrigatória)
 *   ELEVENLABS_VOICE_ID  voz (padrão: Adam — profunda e dramática)
 *   ELEVENLABS_MODEL     padrão: eleven_v3 (entende as tags de expressão)
 *
 * As frases usam TAGS DE EXPRESSÃO entre colchetes, em inglês (ex.: [whispers], [pause]),
 * as mesmas de src/shared/voiceTags.ts. O eleven_v3 as interpreta como emoção/entonação e
 * não as lê em voz alta. Para modelos sem suporte a tags (ex.: eleven_multilingual_v2),
 * o script remove as tags antes de enviar.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // Adam
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_v3";
const SUPPORTS_TAGS = /^eleven_v3/.test(MODEL);

if (!API_KEY) {
  console.error("✗ Defina ELEVENLABS_API_KEY no .env.local (a chave não fica mais no código).");
  process.exit(1);
}

// Mesmo formato de src/shared/voiceTags.ts: [tag] em minúsculas.
const TAG_RE = /\[([a-z][a-z ]{1,24})\]/g;
const stripTags = (t) => t.replace(TAG_RE, "").replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?…])/g, "$1").trim();

const QUOTES = [
  { id: "quote-1", text: "[whispers] “sete… quatro… zero…” [pause] — a voz no rádio não para. [tense] O cinto do piloto foi cortado. [long pause] [ominous] Ninguém sabe que você está aqui." },
  { id: "quote-2", text: "[nervous] A lanterna piscou. [pause] Depois apagou. [whispers] Algo se moveu na beira da trilha." },
  { id: "quote-3", text: "[mysterious] O rádio captou uma frequência estranha. [slowly] Repetia as mesmas coordenadas. [pause] [ominous] Em loop." },
  { id: "quote-4", text: "[tense] A construção estava abandonada há anos. [pause] [whispers] A fogueira dentro era recente." },
  { id: "death-1", text: "[cold] Sinal perdido. [pause] Seus sinais vitais cessaram. [long pause] [whispers] O Vale Silente engoliu mais uma alma." },
  { id: "victory-1", text: "[urgent] Equipe de resgate a caminho. Segure firme. [pause] [relieved] Você conseguiu sobreviver ao Vale Silente." },
];

const OUTPUT_DIR = path.join(__dirname, "../public/audio");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function generateAudio(id, text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      text: SUPPORTS_TAGS ? text : stripTags(text),
      model_id: MODEL,
      // eleven_v3 aceita estabilidade 0.0 / 0.5 / 1.0; 0.5 equilibra expressão e consistência.
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });
    const req = https.request(
      {
        hostname: "api.elevenlabs.io",
        path: `/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "xi-api-key": API_KEY,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => reject(new Error(`API ${res.statusCode}: ${body.slice(0, 200)}`)));
          return;
        }
        const file = fs.createWriteStream(path.join(OUTPUT_DIR, `${id}.mp3`));
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          console.log(`✅ ${id}.mp3`);
          resolve();
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`Gerando áudios com ${MODEL}${SUPPORTS_TAGS ? " (tags de expressão ativas)" : " (tags removidas: modelo sem suporte)"}…`);
  let failed = 0;
  for (const q of QUOTES) {
    try {
      await generateAudio(q.id, q.text);
    } catch (err) {
      failed++;
      console.error(`❌ ${q.id}: ${err.message}`);
    }
  }
  console.log(failed ? `Concluído com ${failed} erro(s).` : "Concluído! Arquivos em public/audio/");
  process.exitCode = failed ? 1 : 0;
}

main();
