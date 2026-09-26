/**
 * Estado do corpo em palavras, para o narrador. Sem números: a IA só ambienta,
 * e o texto de reserva garante que o jogo reaja à desgraça mesmo sem IA.
 */
import type { CharacterState } from "./types";

type CondKey = "sangrando" | "hipotermia" | "frio" | "sede" | "fome" | "sono" | "dor" | "panico" | "febre" | "encharcado" | "fraco" | "mordido";

const WORD: Record<CondKey, string> = {
  sangrando: "sangrando",
  hipotermia: "hipotermia, tremores violentos",
  frio: "com frio",
  sede: "com muita sede",
  fome: "faminto",
  sono: "exausto de sono",
  dor: "com dor intensa",
  panico: "à beira do pânico",
  febre: "febril",
  encharcado: "encharcado",
  fraco: "muito fraco",
  mordido: "com marcas de dentes no pescoço e uma sede estranha",
};

const LINES: Record<CondKey, string[]> = {
  mordido: ["As duas marcas no pescoço pulsam quando escurece.", "Você sente o cheiro do próprio sangue — e isso dá fome."],
  sangrando: ["O sangue esquenta a manga e esfria logo em seguida.", "Cada movimento abre um pouco mais o ferimento."],
  hipotermia: ["Seus dedos não obedecem mais. Os dentes batem sem parar.", "O frio já não dói — e isso assusta mais do que a dor."],
  frio: ["Você esfrega as mãos, mas o frio volta antes do calor.", "O ar gelado arde no nariz a cada respiração."],
  sede: ["A língua gruda no céu da boca.", "Você engole em seco, e não há nada para engolir."],
  fome: ["O estômago aperta, oco. A visão escurece quando você se levanta rápido.", "Suas mãos tremem de fome."],
  sono: ["As pálpebras pesam. Por um segundo, o mundo some e volta.", "Você pisca devagar demais."],
  dor: ["A dor pulsa no mesmo ritmo do coração.", "Você range os dentes a cada passo."],
  panico: ["Seu coração dispara com qualquer estalo na mata.", "Você se pega prendendo a respiração sem motivo."],
  febre: ["O suor escorre frio pela nuca. Tudo parece um pouco longe demais.", "A febre deixa as bordas das coisas tremendo."],
  encharcado: ["A roupa molhada gruda na pele e rouba o calor.", "A água pinga da barra da calça a cada passo."],
  fraco: ["As pernas vacilam. Você precisa se apoiar para não cair.", "Cada esforço cobra mais do que deveria."],
};

/** Condições ativas, da mais grave para a menos grave. */
export function bodyCondition(char: CharacterState): CondKey[] {
  const s = char.status;
  const h = char.health;
  const out: CondKey[] = [];
  if (char.wounds.some((w) => !w.healed && w.bleedingRate > 0)) out.push("sangrando");
  if (s.bodyTemp < 35) out.push("hipotermia");
  else if (s.bodyTemp < 36) out.push("frio");
  if (h.diseases.some((d) => d.key === "mordida")) out.push("mordido");
  if (h.health < 25) out.push("fraco");
  if (s.thirst >= 65) out.push("sede");
  if (s.hunger >= 65) out.push("fome");
  if (h.diseases.some((d) => d.key === "febre") || h.infection >= 55) out.push("febre");
  if (s.fatigue >= 75) out.push("sono");
  if (s.pain >= 60) out.push("dor");
  if (s.stress >= 70) out.push("panico");
  if (s.wetness >= 60) out.push("encharcado");
  return out;
}

export const conditionWords = (keys: CondKey[]) => keys.slice(0, 4).map((k) => WORD[k]);

/** Frase de reserva sobre a condição mais grave (variante escolhida pelo minuto de jogo). */
export function conditionLine(keys: CondKey[], seed: number): string {
  if (!keys.length) return "";
  const list = LINES[keys[0]];
  return list[Math.abs(seed) % list.length];
}
