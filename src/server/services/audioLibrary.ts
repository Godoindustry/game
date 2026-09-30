/**
 * Biblioteca de áudio no Supabase Storage — cresce conforme o jogo é jogado.
 *
 * Cada áudio gerado (voz do narrador, fala de NPC, grito) é guardado com um nome que É o
 * seu conteúdo: hash de (voz + estilo + texto). Antes de gerar, o servidor pergunta se o
 * arquivo já existe; se existe, toca direto — sem token, sem espera. Não há tabela: o nome
 * do arquivo é a chave. Os áudios estáticos do jogo (public/audio) também ficam lá, em
 * `estatico/`, como acervo único (scripts/upload-audio-supabase.ts).
 *
 * Sem SUPABASE_URL + chave de serviço, tudo aqui vira no-op e o jogo segue como antes.
 */
import { createHash } from "node:crypto";
import { after } from "next/server";
import { getConfig } from "../config";

const POSITIVE_CACHE_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 60 * 1000;

const known = new Map<string, { exists: boolean; until: number }>();
const lookups = new Map<string, Promise<boolean>>();
let bucketReady: Promise<void> | null = null;

function publicSettings() {
  const c = getConfig();
  if (!c.SUPABASE_URL) return null;
  return { url: c.SUPABASE_URL.replace(/\/$/, ""), bucket: c.AUDIO_BUCKET };
}

function settings() {
  const c = getConfig();
  const key = c.SUPABASE_SERVICE_ROLE_KEY || c.SUPABASE_SECRET_KEY;
  if (!c.SUPABASE_URL || !key) return null;
  return { url: c.SUPABASE_URL.replace(/\/$/, ""), key, bucket: c.AUDIO_BUCKET };
}

export function libraryConfigured(): boolean {
  return settings() !== null;
}

/** Caminho estável de um áudio gerado: o mesmo pedido sempre cai no mesmo arquivo. */
export function libraryPath(kind: string, parts: (string | undefined | null)[], ext: "mp3" | "wav"): string {
  const hash = createHash("sha256").update(parts.map((p) => p ?? "").join("␞")).digest("hex");
  return `${kind}/${hash.slice(0, 2)}/${hash.slice(0, 40)}.${ext}`;
}

export function libraryUrl(path: string): string | null {
  const s = publicSettings();
  return s ? `${s.url}/storage/v1/object/public/${s.bucket}/${path}` : null;
}

/** Prefixo dos arquivos de `public/audio`, usado diretamente pelo cliente. */
export function libraryStaticBase(): string | null {
  // Leitura não precisa da chave privada. Se o bucket ainda não tiver sido preparado, o
  // cliente tenta automaticamente a cópia local empacotada em `public/audio`.
  return libraryUrl("estatico");
}

function headers(key: string, extra: Record<string, string> = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/** Cria o bucket público na primeira gravação (idempotente). */
function ensureBucket(): Promise<void> {
  const s = settings();
  if (!s) return Promise.resolve();
  bucketReady ??= fetch(`${s.url}/storage/v1/bucket`, {
    method: "POST",
    headers: headers(s.key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: s.bucket, name: s.bucket, public: true }),
    signal: AbortSignal.timeout(8_000),
  }).then(async (res) => {
    // 400/409 = já existe; qualquer outro erro libera nova tentativa depois.
    if (!res.ok && res.status !== 409 && !/already exists|Duplicate/i.test(await res.text())) bucketReady = null;
  }, () => { bucketReady = null; });
  return bucketReady;
}

/** O arquivo já está na biblioteca? (HEAD na URL pública; resultado positivo fica em memória.) */
export async function libraryHas(path: string): Promise<boolean> {
  const url = libraryUrl(path);
  if (!url) return false;
  const cached = known.get(path);
  if (cached && cached.until > Date.now()) return cached.exists;
  const active = lookups.get(path);
  if (active) return active;
  const pending = fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2500) })
    .then((res) => {
      known.set(path, { exists: res.ok, until: Date.now() + (res.ok ? POSITIVE_CACHE_MS : NEGATIVE_CACHE_MS) });
      return res.ok;
    })
    .catch(() => false)
    .finally(() => lookups.delete(path));
  lookups.set(path, pending);
  return pending;
}

/** Guarda na biblioteca. Falha de rede não quebra o jogo: só não reaproveita na próxima. */
export async function libraryPut(path: string, body: Buffer, contentType: string): Promise<boolean> {
  const s = settings();
  if (!s) return false;
  await ensureBucket();
  try {
    const res = await fetch(`${s.url}/storage/v1/object/${s.bucket}/${path}`, {
      method: "POST",
      headers: headers(s.key, { "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "31536000" }),
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) known.set(path, { exists: true, until: Date.now() + POSITIVE_CACHE_MS });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Guarda depois de responder: o jogador não espera o upload e a Vercel mantém a função viva
 * até ele terminar (`after`). Sem isso, a função podia morrer antes e o áudio gerado — já
 * pago em tokens — não chegava à biblioteca. Fora de uma requisição (testes, scripts) roda solto.
 */
export function libraryPutAfterResponse(path: string, produce: () => Promise<Buffer>, contentType: string): void {
  const task = () => produce().then((body) => libraryPut(path, body, contentType)).catch(() => false);
  try {
    after(task);
  } catch {
    void task();
  }
}

/** Testes: esquece o que já foi visto. */
export function resetLibraryCache(): void {
  known.clear();
  lookups.clear();
  bucketReady = null;
}
