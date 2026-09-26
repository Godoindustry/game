"use client";
/**
 * PixelCanvas — redesenha um recorte de imagem em baixa resolução, com paleta
 * curta e pontilhado ordenado (Bayer 4×4): o visual de tela de celular de 2002.
 * Tudo em canvas, sem assets novos. A imagem é da mesma origem (sem CORS).
 */
import { useEffect, useRef } from "react";
import type { DayPhase } from "./Scene";

/** Paleta gótica de 16 cores (sangue, osso, noite). */
const PALETTE: [number, number, number][] = [
  [8, 6, 10], [24, 14, 22], [44, 22, 34], [70, 26, 40],
  [120, 18, 36], [178, 28, 44], [226, 72, 64], [240, 150, 96],
  [236, 214, 170], [168, 150, 128], [104, 96, 92], [58, 62, 66],
  [30, 44, 52], [44, 76, 82], [78, 112, 96], [132, 150, 110],
];

/** Tinta por horário: multiplica o RGB antes de reduzir a paleta. */
const TINT: Record<DayPhase, [number, number, number, number]> = {
  day:   [1.05, 1.0, 0.95, 1.05],
  dawn:  [1.12, 0.92, 0.9, 0.95],
  dusk:  [1.2, 0.8, 0.78, 0.85],
  night: [0.7, 0.78, 1.05, 0.9],
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const cache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  let p = cache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    cache.set(src, p);
  }
  return p;
}

function nearest(r: number, g: number, b: number) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const [pr, pg, pb] = PALETTE[i];
    // Distância ponderada pela percepção (verde pesa mais).
    const d = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return PALETTE[best];
}

export function PixelCanvas({
  src, width, height, crop, phase = "day", className, label,
}: {
  src: string;
  /** Resolução interna (pixels "de celular"). */
  width: number;
  height: number;
  /**
   * Recorte como um background-position: `w` é a largura em fração da imagem,
   * `x`/`y` (0–1) a posição; a altura segue a proporção do canvas.
   * Omitido = imagem inteira.
   */
  crop?: { x: number; y: number; w: number };
  phase?: DayPhase;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const px0 = crop?.x ?? 0, py0 = crop?.y ?? 0, cw = crop?.w;

  useEffect(() => {
    let alive = true;
    loadImage(src).then((img) => {
      const cv = ref.current;
      if (!alive || !cv) return;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      let sw = iw, sh = ih;
      if (cw) {
        sw = Math.min(iw, cw * iw);
        sh = Math.min(ih, (sw * height) / width);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, (iw - sw) * px0, (ih - sh) * py0, sw, sh, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height);
      const px = data.data;
      const [tr, tg, tb, bright] = TINT[phase];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const t = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 34;
          // Contraste extra: telas antigas tinham pouca faixa dinâmica.
          const adj = (v: number, k: number) => Math.max(0, Math.min(255, ((v * k * bright - 128) * 1.18 + 128) + t));
          const [r, g, b] = nearest(adj(px[i], tr), adj(px[i + 1], tg), adj(px[i + 2], tb));
          px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
        }
      }
      ctx.putImageData(data, 0, 0);
    }).catch(() => {});
    return () => { alive = false; };
  }, [src, width, height, px0, py0, cw, phase]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={`pixel-canvas ${className ?? ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
