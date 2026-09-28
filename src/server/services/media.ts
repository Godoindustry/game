/**
 * CDN de mídia (Cloudinary, 25 créditos/mês no plano gratuito).
 *
 * O jogo tem ~460 clipes de áudio em `public/audio` e as artes em `public/art`. Sem CDN
 * eles saem do bundle da Vercel a cada deploy. Com Cloudinary eles passam a sair da edge,
 * com transformação já aplicada (o áudio da narração em `mp3` de 64 kbps, por exemplo, que
 * é metade do tamanho do original) e sem o custo de CPU do servidor.
 *
 * Regra de ouro: `mediaUrl("/audio/x.mp3")` devolve `/audio/x.mp3` quando não há CDN, e a
 * URL da Cloudinary quando há. Nenhum chamador muda de comportamento, nenhum teste quebra,
 * e o app num celular sem rede continua usando o que já tinha em cache.
 *
 * O caminho local é a chave: o public_id na Cloudinary é o caminho sem extensão
 * (`audio/narracao/x`), o que `scripts/upload-media.ts` mantém. Se um arquivo não estiver
 * na CDN, a URL 404 cai no `onerror` do `audioDirector`, que já marca o som como ausente e
 * segue a vida — o mesmo tratamento de um clipe que sumiu do repositório.
 */
import { getConfig } from "../config";

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|wav)$/i;
const VIDEO_EXT = /\.(mp4|webm)$/i;

/** `audio` no Cloudinary é servido pelo resource type `video`; `image` é `image`. */
function resourceTypeFor(path: string): "image" | "video" | "raw" {
  if (AUDIO_EXT.test(path) || VIDEO_EXT.test(path)) return "video";
  if (/\.(jpe?g|png|webp|gif|avif|svg)$/i.test(path)) return "image";
  return "raw";
}

export function mediaConfigured(): boolean {
  return Boolean(getConfig().CLOUDINARY_CLOUD_NAME);
}

/**
 * Traduz um caminho sob `/public` para a URL de entrega. Caminho que já é absoluto
 * (http, data:, blob:) é devolvido intacto, e sem CDN nada muda.
 */
export function mediaUrl(path: string): string {
  if (!path.startsWith("/") || /^\/api\//.test(path)) return path;
  const cloud = getConfig().CLOUDINARY_CLOUD_NAME;
  if (!cloud) return path;
  const ext = /\.[a-z0-9]+$/i.exec(path)?.[0] ?? "";
  const publicId = ext ? path.slice(1, -ext.length) : path.slice(1);
  const type = resourceTypeFor(path);
  return `https://res.cloudinary.com/${cloud}/${type}/upload/${publicId}${ext}`;
}

/**
 * Prefixo para o cliente montar URLs de áudio por conta própria (SFX e ambiente, que não
 * passam pelo servidor). Vazio sem CDN, o que mantém as mesmas URLs de hoje.
 */
export function mediaBase(): string {
  const cloud = getConfig().CLOUDINARY_CLOUD_NAME;
  if (!cloud) return "";
  return `https://res.cloudinary.com/${cloud}/video/upload`;
}
