import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// A CSP abre host externo só quando a integração existe de fato. Sem SUPABASE_URL não entra
// wss:// de ninguém, e sem CLOUDINARY_CLOUD_NAME o app continua servindo tudo de /public —
// nada de '*' na política por causa de um recurso opcional.
const supabaseHost = process.env.SUPABASE_URL?.match(/^https?:\/\/([^/]+)/)?.[1];
const realtimeOrigin = supabaseHost ? ` wss://${supabaseHost}` : "";
// Biblioteca de áudio (Supabase Storage): a voz já gerada é baixada direto de lá.
const storageOrigin = supabaseHost ? ` https://${supabaseHost}` : "";
const cloudinary = process.env.CLOUDINARY_CLOUD_NAME ? " https://res.cloudinary.com" : "";

// CSP: React escapa todo texto e o app não usa dangerouslySetInnerHTML (defesa principal contra XSS).
// 'unsafe-inline' em script-src é exigido pelos scripts inline do Next sem nonce; 'unsafe-eval' só em dev.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${cloudinary}`,
  // A narração toca a partir de blob: (cache em IndexedDB); sem isto toda voz falha.
  `media-src 'self' blob:${cloudinary}${storageOrigin}`,
  "font-src 'self' data:",
  `connect-src 'self'${realtimeOrigin}${storageOrigin}${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
      {
        // Service worker do PWA: sempre a versão mais nova.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
