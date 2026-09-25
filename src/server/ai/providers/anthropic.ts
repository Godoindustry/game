/**
 * Provedor Claude via SDK oficial (@anthropic-ai/sdk).
 * - Modelo padrão: claude-opus-5 (troque via AI_MODEL, ex.: claude-haiku-4-5 para custo menor).
 * - effort "low": saídas curtas, sem necessidade de raciocínio profundo.
 * - fallbacks "default": se o modelo recusar por política, a API tenta outro modelo na mesma chamada.
 * - stop_reason "refusal" é tratado como falha → o jogo usa o texto predefinido.
 */
import Anthropic from "@anthropic-ai/sdk";
import { PromptedProvider, type Completion } from "./prompted";
import type { ProviderCall } from "../types";

export class AnthropicProvider extends PromptedProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string | undefined,
    readonly model: string,
  ) {
    super();
    // maxRetries 0: o AIService já controla timeout e fallback.
    this.client = new Anthropic({ ...(apiKey ? { apiKey } : {}), maxRetries: 0 });
  }

  protected async complete(system: string, user: string, call: ProviderCall): Promise<Completion> {
    const response = await this.client.beta.messages.create(
      {
        model: this.model,
        // Com raciocínio adaptativo, o pensamento também consome max_tokens: folga acima do texto curto pedido.
        max_tokens: Math.max(1024, call.maxTokens),
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: user }],
      },
      { signal: call.signal },
    );
    if (response.stop_reason === "refusal") throw new Error("refusal");
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  }
}
