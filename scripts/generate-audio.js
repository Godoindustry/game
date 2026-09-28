/**
 * generate-audio.js — gera os áudios fixos do jogo (public/audio/<voz>/*.mp3) com o ElevenLabs v3.
 *
 * O modelo `eleven_v3` interpreta TAGS DE EXPRESSÃO entre colchetes, em inglês:
 *   [sighs] [laughs] [dark laugh] [whispers] [gasps] [crying] [pause] [long pause] …
 * (SSML como <prosody>/<emphasis> NÃO é suportado pela ElevenLabs — era ignorado.)
 * A lista permitida fica em src/shared/voiceTags.ts.
 *
 * Chaves: NUNCA no código. Use variáveis de ambiente (uma ou várias, separadas por vírgula):
 *   ELEVENLABS_API_KEYS="sk_conta1,sk_conta2" node scripts/generate-audio.js
 *   (ou ELEVENLABS_API_KEY="sk_..." para uma conta)
 * Para regerar um arquivo existente, apague o .mp3 (ou rode com --force).
 *
 * Vozes (troque por env se quiser):
 *   NARRADOR → George (JBFqnCBsd6RMkjVDRZzb) — contador de histórias dramático
 *   NPC      → Callum (N2lVS1w4EtoT3dr4eOWO) — rouco, misterioso
 *   SISTEMA  → Daniel (onwK4e9ZLuTAKqWW03F9) — locutor frio
 *   MORTE    → Brian  (nPczCjzI2devNBz1zQrb) — grave, sombrio
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const KEYS = (process.env.ELEVENLABS_API_KEYS ?? process.env.ELEVENLABS_API_KEY ?? "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const VOICES = {
  narrador: process.env.ELEVENLABS_VOICE_NARRADOR ?? "JBFqnCBsd6RMkjVDRZzb",
  npc: process.env.ELEVENLABS_VOICE_NPC ?? "N2lVS1w4EtoT3dr4eOWO",
  sistema: process.env.ELEVENLABS_VOICE_SISTEMA ?? "onwK4e9ZLuTAKqWW03F9",
  morte: process.env.ELEVENLABS_VOICE_MORTE ?? "nPczCjzI2devNBz1zQrb",
};

const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_v3";
const FORCE = process.argv.includes("--force");
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/audio");
/** public/audio é organizado por pessoa: cada voz salva na própria pasta (a situação vai no nome). */
export const ROLE_DIR = { narrador: "narrador", sistema: "sistema", npc: "desconhecido", morte: "voz-da-morte" };

// ── Roteiro: todo áudio leva tags de expressão ──────────────────────────────
export const AUDIO_SCRIPT = [
  // ── TELA DE ENTRADA ────────────────────────────────────────────────────
  { id: "intro-quote-1", role: "sistema", text: "[slowly] [whispers] sete… [pause] quatro… [pause] zero… [long pause] [serious] A voz no rádio não para. O cinto do piloto foi cortado. [pause] [ominous] Ninguém sabe que você está aqui." },
  { id: "intro-quote-2", role: "narrador", text: "[slowly] A lanterna piscou. [pause] Depois apagou. [long pause] [whispers] Algo se moveu na beira da trilha." },
  { id: "intro-quote-3", role: "sistema", text: "[tense] O rádio captou uma frequência estranha. [pause] Repetia as mesmas coordenadas. [long pause] [ominous] Em loop." },
  { id: "intro-quote-4", role: "narrador", text: "[mysterious] A construção estava abandonada há anos. [pause] [whispers] A fogueira dentro era recente. [dark laugh]" },

  // ── INTERFACE / HUD ───────────────────────────────────────────────────
  { id: "hud-alert-fome", role: "sistema", text: "[serious] Alerta. [pause] [exhales] Nível de fome crítico." },
  { id: "hud-alert-sede", role: "sistema", text: "[urgent] Alerta. [pause] [gulps] Desidratação severa." },
  { id: "hud-alert-sangue", role: "sistema", text: "[urgent] Sangramento ativo detectado. [pause] Trate o ferimento imediatamente." },
  { id: "hud-alert-hipotermia", role: "sistema", text: "[trembling] Alerta crítico. [pause] Temperatura corporal abaixo do limite seguro. [breathing heavily] Procure abrigo." },

  // ── EVENTOS NARRATIVOS ─────────────────────────────────────────────────
  { id: "event-rastros", role: "narrador", text: "[speaking softly] Você encontrou pegadas na lama. [pause] São recentes. [long pause] [whispers] Alguém… ou algo… esteve aqui há pouco." },
  { id: "event-radio", role: "narrador", text: "[tense] O rádio ganhou vida por um segundo. [pause] Uma voz. [pause] Distorcida. [long pause] [whispers] Depois… silêncio." },
  { id: "event-fogueira", role: "narrador", text: "[relieved] [sighs] A fogueira crepita na escuridão. Por alguns instantes, o frio recua. [pause] [laughs softly] Você se sente quase seguro." },
  { id: "event-abrigo", role: "narrador", text: "[exhales] O abrigo é simples. Mas é o suficiente para sobreviver à noite. [long pause] [ominous] Por enquanto." },
  { id: "event-noite", role: "narrador", text: "[ominous] [slowly] A escuridão engoliu o Vale Silente. [pause] O que estava escondido durante o dia… [long pause] [whispers] acorda." },

  // ── NPC ───────────────────────────────────────────────────────────────
  { id: "npc-desconhecido-1", role: "npc", text: "[whispers] Você não deveria estar aqui. [pause] [laughs nervously] Ninguém deveria estar aqui." },
  { id: "npc-desconhecido-2", role: "npc", text: "[sighs] Eu tentei sair uma vez. [pause] O vale não deixa. [long pause] [dark laugh] Nunca deixa." },

  // ── MORTE ──────────────────────────────────────────────────────────────
  { id: "death-1", role: "morte", text: "[long pause] [cold] Sinal perdido. [pause] Seus sinais vitais cessaram. [long pause] [whispers] O Vale Silente… engoliu mais uma alma." },
  { id: "death-fome", role: "morte", text: "[sighs] Seu corpo cedeu à fome. [pause] [sad] Você lutou tanto quanto pôde. [long pause] Não foi suficiente." },
  { id: "death-hipotermia", role: "morte", text: "[slowly] O frio apagou sua chama aos poucos. [pause] Você fechou os olhos pela última vez, achando que ia dormir. [long pause] [whispers] Não acordou." },
  { id: "death-ferimento", role: "morte", text: "[breathing heavily] O sangramento foi demais. [long pause] [voice breaking] Seus olhos foram os últimos a desistir." },

  // ── VITÓRIA ───────────────────────────────────────────────────────────
  { id: "victory-1", role: "sistema", text: "[hopeful] Equipe de resgate a caminho. [pause] Coordenadas confirmadas. [pause] [relieved] [laughs] Você conseguiu sobreviver ao Vale Silente." },
  { id: "victory-radio", role: "narrador", text: "[hopeful] O rádio conseguiu transmitir. [pause] Em algum lugar, além das montanhas, alguém ouviu. [long pause] [voice breaking] Pela primeira vez em dias, você acredita que vai sair vivo." },

  // ── SONS DE AÇÃO / FEEDBACK ─────────────────────────────────────────
  { id: "action-coletando", role: "narrador", text: "[speaking softly] Você vasculha a área com cuidado. [sniffs]" },
  { id: "action-tratando", role: "narrador", text: "[groans] Com mãos trêmulas, [pause] você tenta cuidar do ferimento." },
  { id: "action-descansando", role: "narrador", text: "[exhausted] [sighs] Você finalmente fecha os olhos. [pause] O sono vem rápido. [long pause] [ominous] Mas não é tranquilo." },

  // ── LINHAGENS (novas) ─────────────────────────────────────────────────
  { id: "lineage-vampire", role: "narrador", text: "[gasps] O coração para por um longo segundo… [long pause] [whispers] e volta diferente. [dark laugh] A noite agora chama você pelo nome. Vampiro." },
  { id: "lineage-werewolf", role: "narrador", text: "[breathing heavily] Seus ossos estalam sob a lua. [growls] Os sons da mata ficam nítidos, impossíveis. [long pause] [menacing] Lobisomem." },
  { id: "lineage-haunted", role: "narrador", text: "[trembling] O frio não vai embora. [pause] Ele traz vozes. [whispers] [haunting] Os mortos do vale falam com você agora. Assombrado." },
];

// ── Gerador ────────────────────────────────────────────────────────────────
function tts(text, voiceId, apiKey) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      text,
      model_id: MODEL,
      language_code: "pt",
      voice_settings: { stability: 0.5, similarity_boost: 0.82 },
    }));
    const req = https.request(
      {
        hostname: "api.elevenlabs.io",
        path: `/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        method: "POST",
        headers: { Accept: "audio/mpeg", "xi-api-key": apiKey, "Content-Type": "application/json", "Content-Length": body.length },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let err = "";
          res.on("data", (d) => (err += d));
          res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${err}`)));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!KEYS.length) {
    console.error("Defina ELEVENLABS_API_KEYS (ou ELEVENLABS_API_KEY). As chaves nunca ficam no código.");
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  let keyIndex = 0;
  let total = 0;
  console.log(`\n🎙  ${AUDIO_SCRIPT.length} áudios · modelo ${MODEL} · ${KEYS.length} conta(s)\n`);
  for (const item of AUDIO_SCRIPT) {
    const outFile = path.join(OUT_DIR, ROLE_DIR[item.role], `${item.id}.mp3`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    if (fs.existsSync(outFile) && !FORCE) {
      console.log(`  ⏭  ${item.id}.mp3 já existe — pulando (use --force para regerar)`);
      continue;
    }
    try {
      console.log(`  ⏳ [${item.role.padEnd(8)}] ${item.id}`);
      const buf = await tts(item.text, VOICES[item.role], KEYS[keyIndex % KEYS.length]);
      fs.writeFileSync(outFile, buf);
      console.log(`  ✅ ${item.id}.mp3 (${(buf.length / 1024).toFixed(1)} KB)`);
      total++;
    } catch (e) {
      console.error(`  ❌ ${item.id}: ${e.message}`);
    }
    keyIndex++;
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log(`\n  ✨ ${total} arquivo(s) salvos em public/audio/\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
