/**
 * RNG determinístico. A semente de cada rolagem deriva de (seed da campanha, rodada,
 * personagem, rótulo). Cancelar e reenviar a mesma ação na mesma rodada produz o
 * mesmo resultado — não existe "rerrolar" pelo cliente.
 */
export type Rng = () => number;

function hashString(str: string): number {
  // FNV-1a 32 bits
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(...parts: (string | number)[]): Rng {
  return mulberry32(hashString(parts.join("::")));
}

/** RNG fixo para testes: devolve sempre `value` (0 = sempre sucesso em testes de chance). */
export function constantRng(value: number): Rng {
  return () => value;
}
