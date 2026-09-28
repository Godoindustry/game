/**
 * Gera os gritos em português (um por situação × sexo da personagem) com o Gemini TTS,
 * salva em public/audio/jogador/grito-{f|m}-{situação}.mp3 e na biblioteca do Supabase.
 *
 *   npm run audio:shouts
 *
 * O Pixabay não tem grito em pt-BR e o Piper não grita; o Gemini interpreta. Retomável:
 * pula o que já existe. Se a cota do dia acabar, rode de novo no dia seguinte.
 * As falas ficam em SHOUTS (src/client/game/choiceSfx.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../src/server/config";
import { synthesizeGeminiSpeech, type VoiceProfile } from "../src/server/services/geminiTts";
import { wavToMp3 } from "../src/server/services/mp3";
import { libraryHas, libraryPut, libraryUrl } from "../src/server/services/audioLibrary";
import { SHOUTS, shoutId } from "../src/client/game/choiceSfx";

const VOICES: Record<"feminino" | "masculino", VoiceProfile> = {
  feminino: {
    key: "survivor:f",
    name: "Sobrevivente",
    voice: "pt-br-storyteller-7",
    profile: "mulher, 30 anos, brasileira, sobrevivente de uma queda de avião no meio da mata, apavorada e sem fôlego",
  },
  masculino: {
    key: "survivor:m",
    name: "Sobrevivente",
    voice: "pt-br-assistant-11",
    profile: "homem, 35 anos, brasileiro, sobrevivente de uma queda de avião no meio da mata, apavorado e sem fôlego",
  },
};

const STYLE = "SHOUTING as loud as possible for help into a dark, empty forest at night: desperate, breathless, voice cracking, not acting — real fear. Brazilian Portuguese.";

async function main() {
  const config = getConfig();
  let made = 0;
  let failed = 0;
  for (const shout of SHOUTS) {
    for (const sex of ["feminino", "masculino"] as const) {
      const id = shoutId(shout.slug, sex);
      const file = path.resolve("public", "audio", `${id}.mp3`);
      if (fs.existsSync(file)) continue;
      const storagePath = `estatico/${id}.mp3`;
      try {
        // Uma execução anterior ou outra máquina já pode ter criado o grito.
        if (await libraryHas(storagePath)) {
          const response = await fetch(libraryUrl(storagePath)!);
          if (response.ok) {
            const mp3 = Buffer.from(await response.arrayBuffer());
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, mp3);
            console.log(`${id}  recuperado do Supabase`);
            continue;
          }
        }
        const result = await synthesizeGeminiSpeech(config, {
          transcript: shout.line,
          style: STYLE,
          profile: VOICES[sex],
          scene: "A survivor of a plane crash screams for help in the Vale Silente forest, Brazil.",
          context: "No previous spoken line.",
        });
        const mp3 = await wavToMp3(result.audio);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, mp3);
        const saved = await libraryPut(storagePath, mp3, "audio/mpeg");
        made++;
        console.log(`${id}  "${shout.line}"  ${Math.round(mp3.length / 1024)} KB${saved ? " · no Supabase" : ""}`);
      } catch (error) {
        const message = String((error as Error)?.message ?? error);
        if (/\b429\b|quota|RESOURCE_EXHAUSTED/i.test(message)) {
          console.error(`Cota do Gemini esgotada. ${made} gritos gerados; rode de novo amanhã para os demais.`);
          process.exitCode = 2;
          return;
        }
        failed++;
        console.error(`Falhou em ${id}: ${message.slice(0, 200)}`);
      }
    }
  }
  console.log(`Pronto: ${made} gritos novos; ${failed} falhas.`);
  if (failed) process.exitCode = 1;
}

void main();
