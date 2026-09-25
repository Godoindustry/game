/**
 * Criação de personagem e atributos derivados.
 * Atributos alteram probabilidades e custos; não criam super-heróis:
 * a diferença entre 1 e 6 num teste é ~45 pontos percentuais, sempre limitado a 5–95%.
 */
import { z } from "zod";
import {
  ATTRIBUTE_KEYS,
  BODY_TYPES,
  CONDITIONINGS,
  EXPERIENCES,
  type AttributeKey,
  type Attributes,
  type CharacterState,
  type Experience,
} from "./types";
import {
  ATTR_MAX_CREATION,
  ATTR_MIN,
  ATTR_POINTS_TO_DISTRIBUTE,
  MAX_EXPERIENCES,
} from "./constants";

export const PROFESSIONS: Record<string, { label: string; bonus: AttributeKey | null }> = {
  estudante: { label: "Estudante", bonus: "inteligencia" },
  enfermagem: { label: "Profissional de enfermagem", bonus: "medicina" },
  mecanico: { label: "Mecânico(a)", bonus: "conhecimento_tecnico" },
  guia: { label: "Guia de turismo", bonus: "orientacao" },
  professor: { label: "Professor(a)", bonus: "comunicacao" },
  atleta: { label: "Atleta amador(a)", bonus: "agilidade" },
  seguranca: { label: "Segurança", bonus: "forca" },
  jornalista: { label: "Jornalista", bonus: "percepcao" },
  tecnico_ti: { label: "Técnico(a) de TI", bonus: "conhecimento_tecnico" },
  outro: { label: "Outra", bonus: null },
};

const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.replace(/[\u0000-\u001f\u007f<>]/g, " ").trim());

const attrShape = Object.fromEntries(
  ATTRIBUTE_KEYS.map((k) => [k, z.number().int().min(ATTR_MIN).max(ATTR_MAX_CREATION)]),
) as Record<AttributeKey, z.ZodNumber>;

export const characterSheetSchema = z.strictObject({
  name: text(40).pipe(z.string().min(2, "Nome muito curto")),
  age: z.number().int().min(18).max(80),
  heightCm: z.number().int().min(140).max(210),
  weightKg: z.number().int().min(40).max(160),
  bodyType: z.enum(BODY_TYPES),
  conditioning: z.enum(CONDITIONINGS),
  profession: z.enum(Object.keys(PROFESSIONS) as [string, ...string[]]),
  knowledge: text(300).default(""),
  fears: text(300).default(""),
  history: text(600).default(""),
  personality: text(300).default(""),
  experiences: z.array(z.enum(EXPERIENCES)).max(MAX_EXPERIENCES).default([]),
  attributes: z.strictObject(attrShape),
});
export type CharacterSheet = z.infer<typeof characterSheetSchema>;

export function pointsSpent(attrs: Attributes): number {
  return ATTRIBUTE_KEYS.reduce((sum, k) => sum + (attrs[k] - ATTR_MIN), 0);
}

export type SheetValidation = { ok: true; sheet: CharacterSheet; finalAttributes: Attributes } | { ok: false; error: string };

/** Valida a ficha (formato + orçamento de pontos) e aplica o bônus da profissão. */
export function validateCharacterSheet(input: unknown): SheetValidation {
  const parsed = characterSheetSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Ficha inválida: ${issue.path.join(".") || "campo"} — ${issue.message}` };
  }
  const sheet = parsed.data;
  const spent = pointsSpent(sheet.attributes);
  if (spent !== ATTR_POINTS_TO_DISTRIBUTE) {
    return {
      ok: false,
      error: `Distribua exatamente ${ATTR_POINTS_TO_DISTRIBUTE} pontos (usados: ${spent}).`,
    };
  }
  if (new Set(sheet.experiences).size !== sheet.experiences.length) {
    return { ok: false, error: "Experiências repetidas." };
  }
  const finalAttributes = { ...sheet.attributes };
  const bonus = PROFESSIONS[sheet.profession].bonus;
  if (bonus) finalAttributes[bonus] = Math.min(ATTR_MAX_CREATION + 1, finalAttributes[bonus] + 1);
  return { ok: true, sheet, finalAttributes };
}

export function hasExperience(char: CharacterState, exp: Experience | Experience[]): boolean {
  const list = Array.isArray(exp) ? exp : [exp];
  return list.some((e) => char.profile.experiences.includes(e));
}

/** Carga confortável em kg. Acima dela o personagem fica lento e cansa mais. */
export function comfortableLoadKg(char: CharacterState): number {
  const cond = { sedentario: -1.5, moderado: 0, atletico: 2.5 }[char.profile.conditioning];
  const body = { magro: -1, medio: 0, robusto: 1.5, acima_do_peso: -0.5 }[char.profile.bodyType];
  return Math.round((9 + char.attrs.forca * 1.6 + cond + body) * 10) / 10;
}

/** Limite absoluto: não é possível carregar além disso. */
export function maxLoadKg(char: CharacterState): number {
  return Math.round(comfortableLoadKg(char) * 1.6 * 10) / 10;
}
