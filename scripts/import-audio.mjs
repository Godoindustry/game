/**
 * Importa os efeitos baixados à mão do Pixabay (pasta local "audios pixabay/", ignorada pelo git)
 * para public/audio/<pessoa>/<situacao>.mp3 — cortando os longos no limite de quadro do MP3
 * (sem recompressão, sem ffmpeg).
 *
 *   node scripts/import-audio.mjs          # importa/atualiza tudo da lista
 *
 * Para um áudio novo: baixe no Pixabay (à mão — os termos proíbem robôs), coloque na pasta
 * e acrescente uma linha em SOURCES. Créditos: public/audio/CREDITOS.md.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = "audios pixabay";
const OUT = "public/audio";

/** [original, destino (pessoa/situacao), segundos para cortar (opcional)] */
export const SOURCES = [
  // jogador
  ["freesound_community-terror-scream-grito-terror-101302.mp3", "jogador/grito-morte"],
  ["magiaz-scream-of-terror-325532.mp3", "jogador/grito-mordida"],
  ["alban_gogh-quot-panic-fear-quot-sound-effect-479998.mp3", "jogador/panico-compulsao"],
  ["vikukachannel-suspiro-sigh-171045.mp3", "jogador/suspiro-alivio-1"],
  ["freesound_community-04-suspiro-45078.mp3", "jogador/suspiro-alivio-2"],
  ["freesound_community-vida-44129.mp3", "jogador/vida"],
  // iara
  ["freesound_community-coro-musica-de-aparicion-37181.mp3", "iara/aparicao-coral"],
  ["dragon-studio-female-sigh-450446.mp3", "iara/suspiro"],
  ["dragon-studio-ghost-whisper-351569.mp3", "iara/sussurro-chamado"],
  ["freesound_community-susurro-conjuro-46499.mp3", "iara/sussurro-numeros"],
  // mãe das asas
  ["estudiocoati-demonic_screech_01-502919.mp3", "mae-das-asas/grito-aparicao"],
  ["dragon-studio-witch-laugh-401713.mp3", "mae-das-asas/risada"],
  ["dragon-studio-evil-girl-laughing-401720.mp3", "mae-das-asas/filhas-risada"],
  // lobo de âmbar
  ["rickworm-monster-growl-251374.mp3", "lobo-de-ambar/rosnado", 15],
  ["freeeverythingxx-wolf-howl-268619.mp3", "lobo-de-ambar/uivo"],
  ["dragon-studio-howling-in-the-distance-515982.mp3", "lobo-de-ambar/uivo-distante"],
  ["pwlpl-realistic-wolf-howling-sound-effect-echoing-wild-call-sfx-444193.mp3", "lobo-de-ambar/uivo-eco"],
  // tavares
  ["u_5pvfy3zhzr-suspense-r-reverbe-323043.mp3", "tavares/tensao-entrada"],
  ["universfield-mischievous-laugh-140131.mp3", "tavares/risada-sarcastica"],
  ["dragon-studio-evil-laugh-with-reverb-423668.mp3", "tavares/risada-cruel"],
  // almas
  ["freesound_community-murmullos-7133.mp3", "almas/murmurios"],
  ["dragon-studio-creepy-whisper-472369.mp3", "almas/sussurro-arrepiante"],
  ["fnx_sound-eerie-space-whisper-of-the-underworld-287352.mp3", "almas/sussurro-submundo"],
  ["freesound_community-evil-demonic-laugh-6925.mp3", "almas/risada-demoniaca"],
  ["freesound_community-evil-laugh-89423.mp3", "almas/risada-maligna"],
  // bichos da mata
  ["hari0127sound-deer-wild-animal-roar-sounnd-mks0127-378527.mp3", "bichos/rugido-selvagem"],
  // cenário
  ["freesound_community-terror-ambience-7003.mp3", "cenario/ambiente-noite"],
  ["freesound_community-amazon-florest-14836.mp3", "cenario/floresta-dia", 60],
  ["mechitoo-panteon-de-terror-454257.mp3", "cenario/luta-chefe"],
  ["audiocrudo-sonido-de-terror-2026-450807.mp3", "cenario/despertar"],
  ["u_thxw0i7h4n-terror-213743.mp3", "cenario/encontro"],
  ["freesound_community-fire-breath-6922.mp3", "cenario/fogueira-acender"],
  ["maxhammarback-fire-sound-efftect-21991.mp3", "cenario/fogueira"],
  ["dragon-studio-soothing-river-flow-372456.mp3", "cenario/rio"],
  ["creativenabeel02-water-drops-falling-in-water-259269.mp3", "cenario/poco-gotas"],
  ["freesound_community-wood-crack-1-105890.mp3", "cenario/galho-quebrando-1"],
  ["freesound_community-wood-crack-4-88688.mp3", "cenario/galho-quebrando-2"],
  ["universfield-bone-crack-3-121580.mp3", "cenario/osso-quebrando"],
  ["dragon-studio-bush-rustling-467467.mp3", "cenario/mato-arbusto"],
  ["dragon-studio-grass-rustling-05-511299.mp3", "cenario/mato-passo"],
  ["soul_serenity_sounds-leaves-rustling-236742.mp3", "cenario/mato-folhas"],
  ["dragon-studio-grass-being-rustled-511323.mp3", "cenario/mato-grama", 8],
  ["dragon-studio-dry-field-grass-rustling-482893.mp3", "cenario/mato-campo-seco", 8],
  ["sspsurvival-the-sound-of-grass-in-the-forest-footsteps-248351.mp3", "cenario/passos-floresta", 5],
];

const BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Mantém os quadros MP3 até `seconds` (descarta a etiqueta ID3 e o quadro Xing/Info, que teria a duração antiga). */
function trim(b, seconds) {
  let i = 0;
  if (b.subarray(0, 3).toString() === "ID3") i = 10 + (((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127));
  const out = [];
  let t = 0;
  let first = true;
  while (i < b.length - 4) {
    if (!(b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0)) { i++; continue; }
    const ver = (b[i + 1] >> 3) & 3;
    const br = BR[ver === 3 ? 1 : 2][(b[i + 2] >> 4) & 15];
    const sr = SR[ver]?.[(b[i + 2] >> 2) & 3];
    if (!br || !sr) { i++; continue; }
    const len = Math.floor(((ver === 3 ? 144 : 72) * br * 1000) / sr) + ((b[i + 2] >> 1) & 1);
    const info = first && /Xing|Info/.test(b.subarray(i, i + 64).toString("latin1"));
    first = false;
    if (!info) {
      out.push(b.subarray(i, i + len));
      t += (ver === 3 ? 1152 : 576) / sr;
      if (t >= seconds) break;
    }
    i += len;
  }
  return Buffer.concat(out);
}

function main() {
  let total = 0;
  const missing = [];
  for (const [src, dst, cut] of SOURCES) {
    const from = path.join(SRC, src);
    const to = path.join(OUT, `${dst}.mp3`);
    if (!fs.existsSync(from)) {
      if (!fs.existsSync(to)) missing.push(src);
      continue; // já importado antes (original pode ter sido apagado da caixa de entrada)
    }
    let b = fs.readFileSync(from);
    if (cut) b = trim(b, cut);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, b);
    total += b.length;
    console.log(`${dst.padEnd(32)} ${String(Math.round(b.length / 1024)).padStart(5)} KB ${cut ? `(cortado ${cut}s)` : ""}`);
  }
  console.log(`\n${(total / 1048576).toFixed(1)} MB importados em ${OUT}/`);
  if (missing.length) {
    console.error(`\nFaltando (baixe de novo no Pixabay): ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("scripts", "import-audio.mjs"))) main();
