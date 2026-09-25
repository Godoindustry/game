/**
 * Contrato da camada de IA. A IA só produz TEXTO (ou uma intenção dentre uma lista
 * fechada). Ela nunca recebe nem devolve estado de jogo: quem decide efeitos é o motor.
 */
export interface NarrativeInput {
  locationName: string;
  timeLabel: string;
  isNight: boolean;
  temperatureC: number;
  actionSummary: string;
  facts: string[]; // fatos já decididos pelo motor
  characterAlive: boolean;
  condition?: string[]; // estado do corpo em palavras (sem números), ex.: "faminto", "tremendo de frio"
}

export interface NpcInput {
  npcName: string;
  persona: string;
  playerMessage: string;
  intent: string;
  outcomeFacts: string[];
}

export interface ClueInput {
  clueTitle: string;
  clueText: string;
  locationName: string;
}

export interface IntentInput {
  npcName: string;
  message: string;
  allowedIntents: string[];
}

export interface ProviderCall {
  maxTokens: number;
  signal: AbortSignal;
}

/** Resposta crua do provedor; `data` ainda NÃO foi validado. */
export interface ProviderResult {
  data: unknown;
  inputTokens?: number;
  outputTokens?: number;
  servedBy?: string; // cadeia: qual provedor/modelo respondeu
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateNarrative(input: NarrativeInput, call: ProviderCall): Promise<ProviderResult>;
  generateNpcResponse(input: NpcInput, call: ProviderCall): Promise<ProviderResult>;
  generateClueDescription(input: ClueInput, call: ProviderCall): Promise<ProviderResult>;
  classifyPlayerIntent(input: IntentInput, call: ProviderCall): Promise<ProviderResult>;
}
