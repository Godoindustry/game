/**
 * Orquestra chamadas de IA com: limite de prompt/tokens, cache, timeout, cota por
 * usuário, orçamento diário, validação de JSON (zod), filtro de conteúdo, registro
 * de custo — e SEMPRE um fallback predefinido. O jogo nunca depende da IA.
 */
import { z } from "zod";
import { getDb, nowIso } from "../db/database";
import { getConfig, type AppConfig } from "../config";
import { newId, sha256 } from "../services/ids";
import { isPremium } from "../services/premium";
import type { AIProvider, ClueInput, IntentInput, NarrativeInput, NpcInput, ProviderResult } from "./types";
import { MockProvider } from "./providers/mock";
import { OpenAICompatibleProvider } from "./providers/openaiCompatible";
import { AnthropicProvider } from "./providers/anthropic";
import { ChainProvider } from "./providers/chain";
import { stripVoiceTags, toVoiceText } from "@/shared/voiceTags";

export type AISource = "ai" | "cache" | "fallback";
export interface AIContext {
  userId: string | null;
  campaignId: string | null;
}

type Status = "ok" | "cache_hit" | "error" | "timeout" | "rejected" | "budget_exceeded" | "quota_exceeded" | "disabled";

// ---------- Provedor ----------
type G = typeof globalThis & { __lsAi?: AIProvider | null };

export function createProvider(c: AppConfig): AIProvider | null {
  switch (c.AI_PROVIDER) {
    case "none":
      return null;
    case "mock":
      return new MockProvider();
    case "chain": {
      const available: Record<string, () => AIProvider | null> = {
        groq: () => (c.GROQ_API_KEY ? new OpenAICompatibleProvider("https://api.groq.com/openai/v1", c.GROQ_API_KEY, c.GROQ_MODEL, {
                name: "groq",
                jsonMode: true,
                extraBody: /gpt-oss|qwen3/.test(c.GROQ_MODEL) ? { reasoning_effort: "low" } : undefined,
              }) : null),
        openrouter: () =>
          c.OPENROUTER_API_KEY
            ? new OpenAICompatibleProvider("https://openrouter.ai/api/v1", c.OPENROUTER_API_KEY, c.OPENROUTER_MODEL, {
                name: "openrouter",
                headers: { "HTTP-Referer": c.APP_URL, "X-Title": "Linha de Sobrevivencia" },
              })
            : null,
        gemini: () =>
          c.GEMINI_API_KEY
            ? new OpenAICompatibleProvider("https://generativelanguage.googleapis.com/v1beta/openai", c.GEMINI_API_KEY, c.GEMINI_MODEL, { name: "gemini" })
            : null,
      };
      const list = c.AI_CHAIN.split(",").map((n) => available[n.trim()]?.()).filter((p): p is AIProvider => !!p);
      return list.length ? new ChainProvider(list) : null;
    }
    case "openai_compatible":
      if (!c.AI_BASE_URL || !c.AI_MODEL) return null;
      return new OpenAICompatibleProvider(c.AI_BASE_URL, c.AI_API_KEY, c.AI_MODEL);
    case "anthropic":
      return new AnthropicProvider(c.AI_API_KEY, c.AI_MODEL ?? "claude-opus-5");
  }
}

export function getProvider(): AIProvider | null {
  const g = globalThis as G;
  if (g.__lsAi === undefined) g.__lsAi = createProvider(getConfig());
  return g.__lsAi;
}

/** Testes/admin: troca o provedor em tempo de execução. */
export function setProvider(p: AIProvider | null | undefined): void {
  (globalThis as G).__lsAi = p;
}

// ---------- Filtro de conteúdo ----------
const BLOCKLIST = [
  /ignore (as|todas as)? ?instru/i,
  /ignore (all|previous) instructions/i,
  /system prompt/i,
  /\b(porra|caralho|puta|viado|macaco)\b/i,
  /\b(sexo|sexual|nua|nuas|nus|pelad[oa]s?|estupr\w*)\b/i,
  /\b(suic[íi]d\w*|se matar)\b/i,
];
const DEATH_CLAIM = /\b(morre[ur]?|morreu|morto|morta|falece[ur]?|sua morte|seu cadáver)\b/i;
const MECHANIC_CLAIM = /(\d+\s*%|pontos? de (vida|saúde|energia)|\+\d+|-\d+)/i;

export function sanitizeText(text: string, max: number): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function passesFilter(text: string): boolean {
  return text.length > 0 && !BLOCKLIST.some((r) => r.test(text));
}

// ---------- Núcleo ----------
interface RunSpec<I, O> {
  purpose: "narrative" | "npc" | "clue" | "intent";
  input: I;
  schema: z.ZodType<O>;
  call: (p: AIProvider, input: I, signal: AbortSignal) => Promise<ProviderResult>;
  validate: (out: O) => boolean;
  cacheable: boolean;
}

async function logRequest(
  ctx: AIContext,
  p: { name: string; model: string | null } | null,
  purpose: string,
  cacheKey: string,
  promptChars: number,
  status: Status,
  extra: { latency?: number; inTok?: number; outTok?: number; cost?: number; error?: string; fallback?: boolean } = {},
): Promise<string> {
  const id = newId();
  await getDb().run(
    `INSERT INTO ai_requests(id,user_id,campaign_id,provider,model,purpose,cache_key,prompt_chars,max_tokens,status,latency_ms,input_tokens,output_tokens,cost_usd,error,used_fallback,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ctx.userId, ctx.campaignId, p?.name ?? "none", p?.model ?? null, purpose, cacheKey, promptChars, getConfig().AI_MAX_OUTPUT_TOKENS,
    status, extra.latency ?? null, extra.inTok ?? null, extra.outTok ?? null, extra.cost ?? 0, extra.error?.slice(0, 300) ?? null,
    extra.fallback ? 1 : 0, nowIso(),
  );
  return id;
}

function startOfDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function run<I, O>(ctx: AIContext, spec: RunSpec<I, O>): Promise<{ value: O | null; source: AISource }> {
  const c = getConfig();
  const provider = getProvider();
  const payload = JSON.stringify(spec.input);
  const cacheKey = sha256(`${provider?.name}|${provider?.model}|${spec.purpose}|${payload}`);
  const db = getDb();

  if (!provider) {
    await logRequest(ctx, null, spec.purpose, cacheKey, payload.length, "disabled", { fallback: true });
    return { value: null, source: "fallback" };
  }
  if (payload.length > c.AI_MAX_PROMPT_CHARS) {
    await logRequest(ctx, provider, spec.purpose, cacheKey, payload.length, "rejected", { error: "prompt muito grande", fallback: true });
    return { value: null, source: "fallback" };
  }

  if (spec.cacheable) {
    const hit = await db.get<{ content: string }>(
      "SELECT content FROM ai_responses WHERE cache_key = ? AND valid = 1 AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
      cacheKey, nowIso(),
    );
    if (hit) {
      const parsed = spec.schema.safeParse(JSON.parse(hit.content));
      if (parsed.success) {
        await logRequest(ctx, provider, spec.purpose, cacheKey, payload.length, "cache_hit");
        return { value: parsed.data, source: "cache" };
      }
    }
  }

  const since = startOfDay();
  if (ctx.userId) {
    const usedRow = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM ai_requests WHERE user_id = ? AND created_at >= ? AND status IN ('ok','error','timeout','rejected')",
      ctx.userId, since,
    );
    const used = Number(usedRow?.n ?? 0);
    const limit = (await isPremium(ctx.userId)) ? c.AI_PREMIUM_DAILY_REQUESTS : c.AI_USER_DAILY_REQUESTS;
    if (used >= limit) {
      await logRequest(ctx, provider, spec.purpose, cacheKey, payload.length, "quota_exceeded", { fallback: true });
      return { value: null, source: "fallback" };
    }
  }
  const spentRow = await db.get<{ s: number }>("SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_requests WHERE created_at >= ?", since);
  const spent = Number(spentRow?.s ?? 0);
  if (c.AI_DAILY_BUDGET_USD > 0 && spent >= c.AI_DAILY_BUDGET_USD) {
    await logRequest(ctx, provider, spec.purpose, cacheKey, payload.length, "budget_exceeded", { fallback: true });
    return { value: null, source: "fallback" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.AI_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await spec.call(provider, spec.input, controller.signal);
    const latency = Date.now() - started;
    const cost =
      ((res.inputTokens ?? 0) * c.AI_COST_INPUT_PER_MTOK + (res.outputTokens ?? 0) * c.AI_COST_OUTPUT_PER_MTOK) / 1_000_000;
    const parsed = spec.schema.safeParse(res.data);
    if (!parsed.success || !spec.validate(parsed.data)) {
      await logRequest(ctx, res.servedBy ? { name: res.servedBy.split("/")[0], model: res.servedBy.split("/").slice(1).join("/") } : provider, spec.purpose, cacheKey, payload.length, "rejected", {
        latency, inTok: res.inputTokens, outTok: res.outputTokens, cost, error: parsed.success ? "reprovado na validação" : "JSON inválido", fallback: true,
      });
      return { value: null, source: "fallback" };
    }
    const served = res.servedBy ? { name: res.servedBy.split("/")[0], model: res.servedBy.split("/").slice(1).join("/") } : provider;
    const reqId = await logRequest(ctx, served, spec.purpose, cacheKey, payload.length, "ok", { latency, inTok: res.inputTokens, outTok: res.outputTokens, cost });
    if (spec.cacheable) {
      await db.run(
        "INSERT INTO ai_responses(id,request_id,cache_key,content,valid,expires_at,created_at) VALUES(?,?,?,?,1,?,?)",
        newId(), reqId, cacheKey, JSON.stringify(parsed.data), new Date(Date.now() + c.AI_CACHE_TTL_HOURS * 3600_000).toISOString(), nowIso(),
      );
    }
    return { value: parsed.data, source: "ai" };
  } catch (err) {
    const aborted = controller.signal.aborted;
    await logRequest(ctx, provider, spec.purpose, cacheKey, payload.length, aborted ? "timeout" : "error", {
      latency: Date.now() - started, error: err instanceof Error ? err.message : String(err), fallback: true,
    });
    return { value: null, source: "fallback" };
  } finally {
    clearTimeout(timer);
  }
}

const textSchema = z.object({ text: z.string().min(1).max(2000) });
const replySchema = z.object({ reply: z.string().min(1).max(2000) });
const intentSchema = z.object({ intent: z.string().max(40), confidence: z.number().min(0).max(1).optional() });

const maxTokens = () => getConfig().AI_MAX_OUTPUT_TOKENS;

// ---------- API pública ----------
export async function aiNarrative(ctx: AIContext, input: NarrativeInput, fallback: string): Promise<{ text: string; source: AISource }> {
  const trimmed = { ...input, facts: input.facts.slice(0, 8).map((f) => stripVoiceTags(f).slice(0, 200)), ...(input.condition ? { condition: input.condition.slice(0, 4) } : {}) };
  const r = await run(ctx, {
    purpose: "narrative",
    input: trimmed,
    schema: textSchema,
    call: (p, i, signal) => p.generateNarrative(i, { maxTokens: maxTokens(), signal }),
    validate: (o) => {
      const t = stripVoiceTags(sanitizeText(o.text, 400));
      if (!passesFilter(t) || MECHANIC_CLAIM.test(t)) return false;
      if (input.characterAlive && DEATH_CLAIM.test(t)) return false; // a IA não decide mortes
      return true;
    },
    cacheable: true,
  });
  // Mantém só tags de expressão permitidas (a tela as remove; a voz as usa).
  return r.value ? { text: toVoiceText(sanitizeText(r.value.text, 400)), source: r.source } : { text: fallback, source: "fallback" };
}

export async function aiNpcReply(ctx: AIContext, input: NpcInput, fallback: string): Promise<{ text: string; source: AISource }> {
  const r = await run(ctx, {
    purpose: "npc",
    input: { ...input, playerMessage: input.playerMessage.slice(0, 300), outcomeFacts: input.outcomeFacts.slice(0, 5).map(stripVoiceTags) },
    schema: replySchema,
    call: (p, i, signal) => p.generateNpcResponse(i, { maxTokens: maxTokens(), signal }),
    validate: (o) => {
      const t = stripVoiceTags(sanitizeText(o.reply, 320));
      return passesFilter(t) && !MECHANIC_CLAIM.test(t) && !DEATH_CLAIM.test(t);
    },
    cacheable: false,
  });
  return r.value ? { text: toVoiceText(sanitizeText(r.value.reply, 320)), source: r.source } : { text: fallback, source: "fallback" };
}

export async function aiClueDescription(ctx: AIContext, input: ClueInput): Promise<{ text: string; source: AISource }> {
  const r = await run(ctx, {
    purpose: "clue",
    input,
    schema: textSchema,
    call: (p, i, signal) => p.generateClueDescription(i, { maxTokens: maxTokens(), signal }),
    validate: (o) => passesFilter(sanitizeText(o.text, 300)),
    cacheable: true,
  });
  return r.value ? { text: sanitizeText(r.value.text, 300), source: r.source } : { text: input.clueText, source: "fallback" };
}

/** Classificador por palavras-chave: fallback determinístico e primeira linha de defesa. */
const KEYWORDS: [string, RegExp][] = [
  // Negação ("não vou te machucar") vem antes da ameaça para não ser lida como ameaça.
  ["acalmar", /\bn[ãa]o (vou|quero) (te )?(machucar|ferir|fazer (nenhum )?mal)|\b(calma|fica tranquilo)/i],
  ["ameacar", /\b(amea[çc]|mato|matar|vou te|arma|bater|machucar|cala a boca)/i],
  ["perguntar_numeros", /\b(n[úu]meros?|sete|quatro|zero|740|r[áa]dio|frequ[êe]ncia|voz)/i],
  ["perguntar_acidente", /\b(acidente|queda|caiu|avi[ãa]o|voo|piloto|carga|elt|transmissor|o que aconteceu)/i],
  ["perguntar_caminho", /\b(caminho|sair|sa[íi]da|trilha|onde|resgate|rochedo|estrada|mapa)/i],
  ["oferecer_item", /\b(tome|toma|pegue|oferec|[áa]gua|comida|biscoito|sardinha|trouxe)/i],
  ["pedir_ajuda", /\b(ajud|socorro|precis|curativo|rem[ée]dio)/i],
  ["acalmar", /\b(calma|tranquil|confia|n[ãa]o vou|amigo|tudo bem|respira)/i],
];

export function keywordIntent(message: string, allowed: string[]): string {
  for (const [intent, re] of KEYWORDS) if (allowed.includes(intent) && re.test(message)) return intent;
  return allowed.includes("outro") ? "outro" : allowed[0];
}

export async function aiClassifyIntent(ctx: AIContext, input: IntentInput): Promise<{ intent: string; source: AISource | "keywords" }> {
  const kw = keywordIntent(input.message, input.allowedIntents);
  const r = await run(ctx, {
    purpose: "intent",
    input: { ...input, message: input.message.slice(0, 300) },
    schema: intentSchema,
    call: (p, i, signal) => p.classifyPlayerIntent(i, { maxTokens: 60, signal }),
    validate: (o) => input.allowedIntents.includes(o.intent), // só intenções da lista fechada
    cacheable: true,
  });
  if (r.value && (r.value.confidence ?? 1) >= 0.5) return { intent: r.value.intent, source: r.source };
  return { intent: kw, source: "keywords" };
}

export async function aiUsageSummary() {
  const db = getDb();
  const since = startOfDay();
  const rows = await db.all<{ status: string; n: number; cost: number; tokens_in: number; tokens_out: number }>(
    `SELECT status, COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(input_tokens),0) AS tokens_in, COALESCE(SUM(output_tokens),0) AS tokens_out
       FROM ai_requests WHERE created_at >= ? GROUP BY status`,
    since,
  );
  const p = getProvider();
  return {
    provider: p?.name ?? "none",
    model: p?.model ?? null,
    today: rows,
    budgetUsd: getConfig().AI_DAILY_BUDGET_USD,
    recent: await db.all("SELECT provider, model, purpose, status, latency_ms, cost_usd, error, used_fallback, created_at FROM ai_requests ORDER BY created_at DESC LIMIT 50"),
  };
}
