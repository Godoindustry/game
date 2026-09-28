/**
 * Envia os arquivos de public/audio, public/art e public/assets para a Cloudinary.
 *
 * O public_id é o caminho SEM extensão, e é exatamente isso que src/server/services/media.ts
 * monta na URL de entrega — os dois lados precisam concordar, senão o áudio dá 404 e o jogo
 * cai no fallback de `/public`.
 *
 *   npx tsx --env-file-if-exists=.env.local --tsconfig tsconfig.json scripts/upload-media.ts
 *   npx tsx ... scripts/upload-media.ts --force     # reenvia o que já existe
 *   npx tsx ... scripts/upload-media.ts audio       # só uma pasta
 *
 * Já enviado não é erro: o plano gratuito tem cota de armazenamento e Transformações, mas
 * upload repetido de arquivo idêntico também conta. Por isso o padrão é pular o que existe.
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../src/server/config";

const CONCURRENCY = 4;
const ROOTS = ["audio", "art", "assets"] as const;

interface Job {
  file: string;
  publicId: string;
  resourceType: "image" | "video";
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|wav)$/i;
const VIDEO_EXT = /\.(mp4|webm)$/i;

function collect(dir: string, publicId: string, out: Job[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(abs, `${publicId}/${entry.name}`, out);
      continue;
    }
    if (!AUDIO_EXT.test(entry.name) && !VIDEO_EXT.test(entry.name) && !/\.(jpe?g|png|webp|gif|avif)$/i.test(entry.name)) continue;
    const resourceType = AUDIO_EXT.test(entry.name) || VIDEO_EXT.test(entry.name) ? "video" : "image";
    out.push({ file: abs, publicId, resourceType });
  }
}

async function upload(job: Job, cloud: string, auth: string, force: boolean): Promise<"ok" | "skip" | "falhou"> {
  const bytes = fs.readFileSync(job.file);
  const form = new FormData();
  form.set("file", new Blob([bytes]), path.basename(job.file));
  form.set("public_id", job.publicId);
  form.set("overwrite", String(force));
  // O jogo já pede o arquivo pelo nome; guardar a transformation aqui evita repetir a query na URL.
  form.set("use_filename_as_display_name", "true");
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${job.resourceType}/upload`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (res.ok) return "ok";
    // "already exists" com overwrite=false é o caminho feliz de quem roda o script duas vezes.
    if (!force && /already exists/i.test(body.error?.message ?? "")) return "skip";
    console.error(`  ✗ ${job.publicId}: ${body.error?.message ?? res.status}`);
    return "falhou";
  } catch (err) {
    console.error(`  ✗ ${job.publicId}: ${(err as Error).message}`);
    return "falhou";
  }
}

async function main() {
  const c = getConfig();
  if (!c.CLOUDINARY_CLOUD_NAME || !c.CLOUDINARY_API_KEY || !c.CLOUDINARY_API_SECRET) {
    console.error("Faltam CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET no .env.local.");
    process.exit(1);
  }
  const force = process.argv.includes("--force");
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const roots = only.length ? (only as unknown as typeof ROOTS) : ROOTS;

  const jobs: Job[] = [];
  for (const root of roots) collect(path.join(process.cwd(), "public", root), root, jobs);
  if (!jobs.length) {
    console.log("Nada para enviar.");
    return;
  }

  const cloud = c.CLOUDINARY_CLOUD_NAME;
  const basic = Buffer.from(`${c.CLOUDINARY_API_KEY}:${c.CLOUDINARY_API_SECRET}`).toString("base64");

  const counts = { ok: 0, skip: 0, falhou: 0 };
  console.log(`Enviando ${jobs.length} arquivos para a Cloudinary (${cloud})${force ? " — --force" : ""}…`);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        counts[await upload(job, cloud, basic, force)] += 1;
      }
    }),
  );

  console.log(`\n${counts.ok} enviados · ${counts.skip} já existiam · ${counts.falhou} falharam`);
  if (counts.falhou) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
