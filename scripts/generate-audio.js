const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = 'sk_dbddab9aa3ce3184ed226b119131c176c86dc1e3a5bde3bc'; // Chave fornecida
const VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam - voz profunda e dramática

const QUOTES = [
  { id: 'quote-1', text: '"sete… quatro… zero…" — a voz no rádio não para. O cinto do piloto foi cortado. Ninguém sabe que você está aqui.' },
  { id: 'quote-2', text: 'A lanterna piscou. Depois apagou. Algo se moveu na beira da trilha.' },
  { id: 'quote-3', text: 'O rádio captou uma frequência estranha. Repetia as mesmas coordenadas. Em loop.' },
  { id: 'quote-4', text: 'A construção estava abandonada há anos. A fogueira dentro era recente.' },
  { id: 'death-1', text: 'Sinal perdido. Seus sinais vitais cessaram. O Vale Silente engoliu mais uma alma.' },
  { id: 'victory-1', text: 'Equipe de resgate a caminho. Segure firme. Você conseguiu sobreviver ao Vale Silente.' },
];

const OUTPUT_DIR = path.join(__dirname, '../public/audio');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function generateAudio(id, text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      }
    });

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${VOICE_ID}`,
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`API Error: ${res.statusCode}`));
        return;
      }
      
      const file = fs.createWriteStream(path.join(OUTPUT_DIR, `${id}.mp3`));
      res.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`✅ Áudio gerado: ${id}.mp3`);
        resolve();
      });
    });

    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Iniciando geração de áudios...');
  for (const quote of QUOTES) {
    try {
      await generateAudio(quote.id, quote.text);
    } catch (err) {
      console.error(`❌ Erro ao gerar ${quote.id}:`, err.message);
    }
  }
  console.log('Geração concluída! Os arquivos estão em public/audio/');
}

main();
