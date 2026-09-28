/**
 * Envia TODOS os áudios de public/audio para a biblioteca no Supabase Storage, em
 * `estatico/<mesmo caminho>` (ex.: estatico/narracao/vs_despertar_cena_p1_01.mp3).
 *
 *   npm run audio:upload
 *
 * Retomável: lista o que já está no bucket e só envia o que falta ou mudou de tamanho.
 * Precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SECRET_KEY) no .env.local.
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../src/server/config";
import { libraryConfigured, libraryPut, libraryUrl } from "../src/server/services/audioLibrary";

const ROOT = path.resolve("public", "audio");
const PREFIX = "estatico";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(mp3|wav|ogg|m4a)$/i.test(entry.name) ? [full] : [];
  });
}

/** Tamanhos do que já está no bucket, por pasta. */
async function remoteSizes(folders: string[]): Promise<Map<string, number>> {
  const c = getConfig();
  const key = c.SUPABASE_SERVICE_ROLE_KEY || c.SUPABASE_SECRET_KEY!;
  const sizes = new Map<string, number>();
  for (const folder of folders) {
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${c.SUPABASE_URL!.replace(/\/$/, "")}/storage/v1/object/list/${c.AUDIO_BUCKET}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: folder, limit: 1000, offset }),
      });
      if (!res.ok) break; // bucket ainda não existe: tudo será enviado
      const items = (await res.json()) as { name: string; metadata?: { size?: number } | null }[];
      for (const item of items) if (item.metadata?.size) sizes.set(`${folder}/${item.name}`, item.metadata.size);
      if (items.length < 1000) break;
    }
  }
  return sizes;
}

async function main() {
  if (!libraryConfigured()) throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local.");
  const files = walk(ROOT).map((full) => ({ full, remote: `${PREFIX}/${path.relative(ROOT, full).split(path.sep).join("/")}` }));
  const folders = [...new Set(files.map((f) => f.remote.slice(0, f.remote.lastIndexOf("/"))))];
  const existing = await remoteSizes(folders);
  const pending = files.filter((f) => existing.get(f.remote) !== fs.statSync(f.full).size);
  console.log(`${files.length} áudios no jogo; ${files.length - pending.length} já estão no Supabase; ${pending.length} para enviar.`);

  let done = 0;
  let failed = 0;
  const queue = [...pending];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const ok = await libraryPut(f.remote, fs.readFileSync(f.full), f.full.endsWith(".wav") ? "audio/wav" : "audio/mpeg");
      if (ok) done++;
      else {
        failed++;
        console.warn(`falhou: ${f.remote}`);
      }
      if ((done + failed) % 50 === 0) console.log(`${done + failed}/${pending.length}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`Enviados: ${done}. Falhas: ${failed}.`);
  if (files[0]) console.log(`Exemplo: ${libraryUrl(files[0].remote)}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
