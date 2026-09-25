/**
 * Configuração central lida de variáveis de ambiente.
 * Todo segredo vem daqui — nunca de código ou do frontend.
 */
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Sem barra final: links e o redirect do OAuth são montados como `${APP_URL}/api/...`.
  APP_URL: z
    .string()
    .default("http://localhost:3000")
    .transform((u) => u.trim().replace(/\/+$/, "")),
  DATABASE_PATH: z.string().default("./data/linha.sqlite"),
  // Se definido, usa PostgreSQL (ex.: Supabase, pooler em modo transaction, porta 6543) em vez do SQLite.
  DATABASE_URL: z.string().optional(),
  POSTGRES_URL: z.string().optional(),

  // ADM MASTER inicial (criado/atualizado no boot; nunca pela API)
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  // Nome de usuário opcional do ADM MASTER (permite entrar com ele no lugar do e-mail).
  ADMIN_USERNAME: z.string().regex(/^[A-Za-z0-9_.-]{3,32}$/).optional(),

  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  COOKIE_SECURE: bool.optional(),

  // Google OAuth (opcional — se ausente, o botão fica desativado)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Premium
  PREMIUM_EARLY_SLOTS: z.coerce.number().int().nonnegative().default(12),

  // Tempo real de espera: segundos reais por minuto de jogo, com teto.
  ACTION_REAL_SECONDS_PER_GAME_MINUTE: z.coerce.number().nonnegative().default(0.5),
  ACTION_MAX_REAL_SECONDS: z.coerce.number().nonnegative().default(60),
  ROUND_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  PAUSE_AFTER_SECONDS: z.coerce.number().int().positive().default(60),
  FIXED_SEED: z.string().optional(), // somente testes/depuração

  // IA
  AI_PROVIDER: z.enum(["mock", "chain", "openai_compatible", "anthropic", "none"]).default("mock"),
  // Cadeia de provedores gratuitos/baratos (ordem de tentativa). Só entram os que têm chave.
  AI_CHAIN: z.string().default("groq,openrouter,gemini"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("meta-llama/llama-3.3-70b-instruct:free"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(220),
  AI_MAX_PROMPT_CHARS: z.coerce.number().int().positive().default(2400),
  AI_CACHE_TTL_HOURS: z.coerce.number().positive().default(72),
  AI_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(1),
  AI_COST_INPUT_PER_MTOK: z.coerce.number().nonnegative().default(0),
  AI_COST_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().default(0),
  AI_USER_DAILY_REQUESTS: z.coerce.number().int().nonnegative().default(40),
  AI_PREMIUM_DAILY_REQUESTS: z.coerce.number().int().nonnegative().default(400),

  FREE_MAX_ACTIVE_CAMPAIGNS: z.coerce.number().int().positive().default(3),
  PREMIUM_MAX_ACTIVE_CAMPAIGNS: z.coerce.number().int().positive().default(12),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cached) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([_, v]) => v !== undefined && v !== "")
    );
    const r = schema.safeParse(env);
    if (!r.success) {
      // Só os NOMES das variáveis — nunca os valores (podem ser segredos).
      const names = [...new Set(r.error.issues.map((i) => String(i.path[0])))].join(", ");
      throw new Error(`Variável(is) de ambiente inválida(s): ${names}. Confira o formato em .env.example.`);
    }
    cached = r.data;
  }
  return cached;
}

/** Usado pelos testes para aplicar overrides. */
export function setConfig(overrides: Partial<AppConfig>): AppConfig {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([_, v]) => v !== undefined && v !== "")
  );
  cached = { ...schema.parse(env), ...overrides };
  return cached;
}

export function isProduction(): boolean {
  return getConfig().NODE_ENV === "production";
}
