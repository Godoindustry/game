/**
 * Cadeia de provedores: tenta cada um na ordem; erro, limite de uso (429) ou
 * resposta vazia passam para o próximo. Se todos falharem, o AIService usa o
 * texto predefinido. O resultado informa qual provedor respondeu (para custo/log).
 */
import type { AIProvider, ProviderCall, ProviderResult } from "../types";

type Method = "generateNarrative" | "generateNpcResponse" | "generateClueDescription" | "classifyPlayerIntent";

export class ChainProvider implements AIProvider {
  readonly name = "chain";
  readonly model: string;

  constructor(private readonly providers: AIProvider[]) {
    if (!providers.length) throw new Error("ChainProvider sem provedores");
    this.model = providers.map((p) => p.name).join("→");
  }

  private async attempt(method: Method, input: never, call: ProviderCall): Promise<ProviderResult> {
    const errors: string[] = [];
    for (const p of this.providers) {
      if (call.signal.aborted) break;
      try {
        const r = await (p[method] as (i: never, c: ProviderCall) => Promise<ProviderResult>)(input, call);
        if (r.data !== null && r.data !== undefined) return { ...r, servedBy: `${p.name}/${p.model}` };
        errors.push(`${p.name}: resposta vazia`);
      } catch (err) {
        errors.push(`${p.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(errors.join(" | ") || "cadeia abortada");
  }

  generateNarrative = (i: never, c: ProviderCall) => this.attempt("generateNarrative", i, c);
  generateNpcResponse = (i: never, c: ProviderCall) => this.attempt("generateNpcResponse", i, c);
  generateClueDescription = (i: never, c: ProviderCall) => this.attempt("generateClueDescription", i, c);
  classifyPlayerIntent = (i: never, c: ProviderCall) => this.attempt("classifyPlayerIntent", i, c);
}
