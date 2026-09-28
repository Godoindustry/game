/**
 * Cadeia de provedores: tenta cada um na ordem; erro, limite de uso (429) ou
 * resposta vazia passam para o próximo. Se todos falharem, o AIService usa o
 * texto predefinido. O resultado informa qual provedor respondeu (para custo/log).
 *
 * Com `rotate`, vira um rodízio de chaves do MESMO provedor: cada chamada começa pela
 * próxima chave (espalha o uso entre as cotas gratuitas) e, se ela falhar ou bater no
 * limite (429), tenta as outras antes de desistir.
 */
import type { AIProvider, ProviderCall, ProviderResult } from "../types";

type Method = "generateNarrative" | "generateNpcResponse" | "generateClueDescription" | "classifyPlayerIntent" | "decideCreatureAttitude";

export class ChainProvider implements AIProvider {
  readonly name: string;
  readonly model: string;
  private cursor = 0;

  constructor(private readonly providers: AIProvider[], private readonly opts: { name?: string; rotate?: boolean } = {}) {
    if (!providers.length) throw new Error("ChainProvider sem provedores");
    this.name = opts.name ?? "chain";
    this.model = opts.rotate ? `${providers[0].model} ×${providers.length} chaves` : providers.map((p) => p.name).join("→");
  }

  private order(): AIProvider[] {
    if (!this.opts.rotate) return this.providers;
    const start = this.cursor++ % this.providers.length;
    return [...this.providers.slice(start), ...this.providers.slice(0, start)];
  }

  private async attempt(method: Method, input: never, call: ProviderCall): Promise<ProviderResult> {
    const errors: string[] = [];
    for (const p of this.order()) {
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
  decideCreatureAttitude = (i: never, c: ProviderCall) => this.attempt("decideCreatureAttitude", i, c);
}
