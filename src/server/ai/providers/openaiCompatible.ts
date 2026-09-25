/**
 * Provedor para qualquer API compatível com /chat/completions (Groq, OpenRouter,
 * Gemini via endpoint compatível, Ollama local...). Não presume que um plano
 * gratuito continue existindo: falhas caem no próximo provedor da cadeia ou no fallback.
 */
import { PromptedProvider, type Completion } from "./prompted";
import type { ProviderCall } from "../types";

export interface OpenAICompatibleOptions {
  name?: string;
  jsonMode?: boolean; // response_format json_object (nem todo modelo gratuito aceita)
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>; // ex.: reasoning_effort para modelos com raciocínio
}

export class OpenAICompatibleProvider extends PromptedProvider {
  readonly name: string;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly model: string,
    private readonly opts: OpenAICompatibleOptions = {},
  ) {
    super();
    this.name = opts.name ?? "openai_compatible";
  }

  protected async complete(system: string, user: string, call: ProviderCall): Promise<Completion> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        ...this.opts.headers,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: call.maxTokens,
        temperature: 0.8,
        ...(this.opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...this.opts.extraBody,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: call.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
      throw new Error(`${this.name} HTTP ${res.status} ${detail}`);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens,
    };
  }
}
