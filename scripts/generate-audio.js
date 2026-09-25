/**
 * generate-audio-ssml.js
 * Gera TODOS os áudios do jogo com expressão emocional real via SSML.
 * Usa 2 contas ElevenLabs intercaladas para não estourar o limite.
 *
 * Vozes usadas:
 *   NARRADOR → George (JBFqnCBsd6RMkjVDRZzb) — storyteller dramático britânico
 *   NPC      → Callum (N2lVS1w4EtoT3dr4eOWO) — husky, misterioso
 *   SISTEMA  → Daniel (onwK4e9ZLuTAKqWW03F9) — broadcaster frio/formal
 *   MORTE    → Brian  (nPczCjzI2devNBz1zQrb) — profundo, sombrio
 *
 * SSML suportado pela ElevenLabs:
 *   <break time="500ms"/>      → pausa
 *   <prosody rate="slow">      → ritmo lento
 *   <prosody rate="fast">      → ritmo acelerado
 *   <prosody pitch="-10%">     → tom mais grave
 *   <prosody volume="soft">    → mais baixo
 *   <emphasis level="strong">  → ênfase forte
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";

// ── Contas ────────────────────────────────────────────────────────────────
const KEYS = [
  'sk_87716a1b971b949d9769d34e120a4a2012d87f65d39f9596', // Conta 1
  'sk_47564ba5a2e65c0c6c6384af0776fa1641034b0952710fb1', // Conta 2
];

// ── IDs das vozes ─────────────────────────────────────────────────────────
const VOICES = {
  narrador: 'JBFqnCBsd6RMkjVDRZzb', // George - Warm, Captivating Storyteller
  npc:      'N2lVS1w4EtoT3dr4eOWO', // Callum - Husky Trickster (misterioso)
  sistema:  'onwK4e9ZLuTAKqWW03F9', // Daniel - Steady Broadcaster (frio)
  morte:    'nPczCjzI2devNBz1zQrb', // Brian  - Deep, Resonant (sombrio)
};

const MODEL   = 'eleven_multilingual_v2'; // suporte a PT-BR
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const OUT_DIR = path.join(__dirname, '../public/audio');

// ── Todos os áudios do jogo com SSML ─────────────────────────────────────
// "role" define qual voz usar. Os textos usam tags SSML para entonação real.
const AUDIO_SCRIPT = [

  // ── TELA DE ENTRADA ────────────────────────────────────────────────────
  {
    id:   'intro-quote-1',
    role: 'sistema',
    ssml: `<speak>
      <prosody rate="slow" pitch="-8%">
        <break time="600ms"/>
        <emphasis level="strong">sete…</emphasis>
        <break time="400ms"/>
        quatro…
        <break time="400ms"/>
        zero…
        <break time="800ms"/>
      </prosody>
      <prosody rate="slow">
        A voz no rádio não para.
        <break time="400ms"/>
        O cinto do piloto foi cortado.
        <break time="600ms"/>
        Ninguém sabe que você está aqui.
      </prosody>
    </speak>`,
  },
  {
    id:   'intro-quote-2',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="slow">
        A lanterna piscou.
        <break time="700ms"/>
        Depois apagou.
        <break time="900ms"/>
        <prosody pitch="-10%" rate="slow">
          Algo se moveu na beira da trilha.
        </prosody>
      </prosody>
    </speak>`,
  },
  {
    id:   'intro-quote-3',
    role: 'sistema',
    ssml: `<speak>
      <prosody rate="slow">
        O rádio captou uma frequência estranha.
        <break time="500ms"/>
        Repetia as mesmas coordenadas.
        <break time="600ms"/>
        <emphasis level="strong">Em loop.</emphasis>
      </prosody>
    </speak>`,
  },
  {
    id:   'intro-quote-4',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="slow">
        A construção estava abandonada há anos.
        <break time="600ms"/>
        <prosody pitch="-5%" rate="slow">
          A fogueira dentro era recente.
        </prosody>
      </prosody>
    </speak>`,
  },

  // ── INTERFACE / HUD ───────────────────────────────────────────────────
  {
    id:   'hud-alert-fome',
    role: 'sistema',
    ssml: `<speak>
      <prosody rate="medium" pitch="-5%">
        <emphasis level="moderate">Alerta.</emphasis>
        <break time="300ms"/>
        Nível de fome crítico.
      </prosody>
    </speak>`,
  },
  {
    id:   'hud-alert-sede',
    role: 'sistema',
    ssml: `<speak>
      <prosody rate="medium" pitch="-5%">
        <emphasis level="moderate">Alerta.</emphasis>
        <break time="300ms"/>
        Desidratação severa.
      </prosody>
    </speak>`,
  },
  {
    id:   'hud-alert-sangue',
    role: 'sistema',
    ssml: `<speak>
      <prosody rate="fast" pitch="-5%">
        <emphasis level="strong">Sangramento ativo detectado.</emphasis>
        <break time="300ms"/>
        Trate o ferimento imediatamente.
      </prosody>
    </speak>`,
  },
  {
    id:   'hud-alert-hipotermia',
    role: 'sistema',
    ssml: `<speak>
      <prosody rate="slow" pitch="-8%">
        <emphasis level="strong">Alerta crítico.</emphasis>
        <break time="400ms"/>
        Temperatura corporal abaixo do limite seguro.
        <break time="300ms"/>
        Procure abrigo.
      </prosody>
    </speak>`,
  },

  // ── EVENTOS NARRATIVOS ─────────────────────────────────────────────────
  {
    id:   'event-rastros',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="slow">
        Você encontrou pegadas na lama.
        <break time="500ms"/>
        São recentes.
        <break time="700ms"/>
        <prosody pitch="-8%" rate="slow">
          Alguém… ou algo… esteve aqui há pouco.
        </prosody>
      </prosody>
    </speak>`,
  },
  {
    id:   'event-radio',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="slow">
        O rádio ganhou vida por um segundo.
        <break time="600ms"/>
        Uma voz.
        <break time="400ms"/>
        Distorcida.
        <break time="800ms"/>
        <prosody pitch="-12%" rate="slow">
          Depois… silêncio.
        </prosody>
      </prosody>
    </speak>`,
  },
  {
    id:   'event-fogueira',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="medium">
        A fogueira crepita na escuridão.
        <break time="500ms"/>
        Por alguns instantes,
        <break time="300ms"/>
        o frio recua.
        <break time="600ms"/>
        Você se sente <prosody pitch="+5%">quase</prosody> seguro.
      </prosody>
    </speak>`,
  },
  {
    id:   'event-abrigo',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="slow">
        O abrigo é simples.
        <break time="400ms"/>
        Mas é o suficiente para sobreviver à noite.
        <break time="700ms"/>
        <prosody pitch="-5%">
          Por enquanto.
        </prosody>
      </prosody>
    </speak>`,
  },
  {
    id:   'event-noite',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="slow" pitch="-8%">
        A escuridão engoliu o Vale Silente.
        <break time="600ms"/>
        O que estava escondido durante o dia…
        <break time="700ms"/>
        <emphasis level="strong">acorda.</emphasis>
      </prosody>
    </speak>`,
  },

  // ── NPC ───────────────────────────────────────────────────────────────
  {
    id:   'npc-desconhecido-1',
    role: 'npc',
    ssml: `<speak>
      <prosody rate="slow" pitch="-5%">
        <break time="400ms"/>
        Você não deveria estar aqui.
        <break time="600ms"/>
        Ninguém deveria estar aqui.
      </prosody>
    </speak>`,
  },
  {
    id:   'npc-desconhecido-2',
    role: 'npc',
    ssml: `<speak>
      <prosody rate="slow" pitch="-8%">
        <break time="300ms"/>
        Eu tentei sair uma vez.
        <break time="500ms"/>
        O vale não deixa.
        <break time="800ms"/>
        <emphasis level="strong">Nunca deixa.</emphasis>
      </prosody>
    </speak>`,
  },

  // ── MORTE ──────────────────────────────────────────────────────────────
  {
    id:   'death-1',
    role: 'morte',
    ssml: `<speak>
      <prosody rate="slow" pitch="-12%" volume="soft">
        <break time="1000ms"/>
        <emphasis level="strong">Sinal perdido.</emphasis>
        <break time="800ms"/>
        Seus sinais vitais cessaram.
        <break time="600ms"/>
        <prosody pitch="-15%" rate="slow">
          O Vale Silente… engoliu mais uma alma.
        </prosody>
      </prosody>
    </speak>`,
  },
  {
    id:   'death-fome',
    role: 'morte',
    ssml: `<speak>
      <prosody rate="slow" pitch="-12%" volume="soft">
        <break time="600ms"/>
        Seu corpo cedeu à fome.
        <break time="700ms"/>
        <prosody rate="slow" pitch="-15%">
          Você lutou tanto quanto pôde.
          <break time="500ms"/>
          Não foi suficiente.
        </prosody>
      </prosody>
    </speak>`,
  },
  {
    id:   'death-hipotermia',
    role: 'morte',
    ssml: `<speak>
      <prosody rate="slow" pitch="-10%" volume="soft">
        <break time="600ms"/>
        O frio apagou sua chama aos poucos.
        <break time="700ms"/>
        Você fechou os olhos pela última vez
        <break time="400ms"/>
        achando que ia dormir.
        <break time="800ms"/>
        <prosody pitch="-15%">
          Não acordou.
        </prosody>
      </prosody>
    </speak>`,
  },
  {
    id:   'death-ferimento',
    role: 'morte',
    ssml: `<speak>
      <prosody rate="slow" pitch="-12%" volume="soft">
        <break time="500ms"/>
        O sangramento foi demais.
        <break time="600ms"/>
        <prosody rate="slow" pitch="-15%">
          Seus olhos foram os últimos a desistirem.
        </prosody>
      </prosody>
    </speak>`,
  },

  // ── VITÓRIA ───────────────────────────────────────────────────────────
  {
    id:   'victory-1',
    role: 'sistema',
    ssml: `<speak>
      <prosody rate="medium" pitch="+3%">
        Equipe de resgate a caminho.
        <break time="400ms"/>
        Coordenadas confirmadas.
        <break time="600ms"/>
        <emphasis level="strong">Você conseguiu sobreviver ao Vale Silente.</emphasis>
      </prosody>
    </speak>`,
  },
  {
    id:   'victory-radio',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="slow">
        O rádio conseguiu transmitir.
        <break time="500ms"/>
        Em algum lugar, além das montanhas,
        <break time="400ms"/>
        alguém ouviu.
        <break time="700ms"/>
        <prosody pitch="+5%">
          Pela primeira vez em dias,
          <break time="300ms"/>
          você acredita que vai sair vivo.
        </prosody>
      </prosody>
    </speak>`,
  },

  // ── SONS DE AÇÃO / FEEDBACK ─────────────────────────────────────────
  {
    id:   'action-coletando',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="medium">
        Você vasculha a área com cuidado.
      </prosody>
    </speak>`,
  },
  {
    id:   'action-tratando',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="slow">
        Com mãos trêmulas,
        <break time="300ms"/>
        você tenta cuidar do ferimento.
      </prosody>
    </speak>`,
  },
  {
    id:   'action-descansando',
    role: 'narrador',
    ssml: `<speak>
      <prosody rate="slow" pitch="-5%">
        Você finalmente fecha os olhos.
        <break time="500ms"/>
        O sono vem rápido.
        <break time="600ms"/>
        Mas não é tranquilo.
      </prosody>
    </speak>`,
  },
];

// ── Gerador ────────────────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function tts(ssml, voiceId, apiKey) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      text:         ssml,
      model_id:     MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.82, style: 0.55, use_speaker_boost: true },
    }));

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path:     `/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      method:   'POST',
      headers:  {
        'Accept':         'audio/mpeg',
        'xi-api-key':     apiKey,
        'Content-Type':   'application/json',
        'Content-Length': body.length,
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let err = '';
        res.on('data', d => err += d);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${err}`)));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  let keyIndex = 0;
  let total = 0;

  console.log(`\n🎙  Gerando ${AUDIO_SCRIPT.length} áudios com SSML expressivo...\n`);
  console.log(`  Conta 1: ${KEYS[0].slice(-8)} | Conta 2: ${KEYS[1].slice(-8)}\n`);

  for (const item of AUDIO_SCRIPT) {
    const outFile = path.join(OUT_DIR, `${item.id}.mp3`);

    // pula se já existe
    if (fs.existsSync(outFile)) {
      console.log(`  ⏭  ${item.id}.mp3 já existe — pulando`);
      continue;
    }

    const voiceId = VOICES[item.role];
    const apiKey  = KEYS[keyIndex % KEYS.length];

    try {
      console.log(`  ⏳ [${item.role.padEnd(8)}] ${item.id}`);
      const buf = await tts(item.ssml, voiceId, apiKey);
      fs.writeFileSync(outFile, buf);
      const kb = (buf.length / 1024).toFixed(1);
      console.log(`  ✅ ${item.id}.mp3  (${kb} KB)  — conta ${keyIndex % 2 + 1}`);
      total++;
    } catch (e) {
      console.error(`  ❌ ${item.id}: ${e.message}`);
    }

    keyIndex++; // alterna conta a cada requisição
    await new Promise(r => setTimeout(r, 600)); // 600ms entre req para não throttle
  }

  console.log(`\n  ✨ Concluído! ${total} arquivo(s) salvos em public/audio/\n`);
}

main();
