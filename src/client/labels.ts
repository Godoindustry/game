/** Rótulos em português para chaves do motor. */
export const ATTR_LABEL: Record<string, { label: string; hint: string }> = {
  forca: { label: "Força", hint: "Carga, forçar portas, lutar" },
  resistencia: { label: "Resistência", hint: "Gasto de energia, frio, doenças" },
  agilidade: { label: "Agilidade", hint: "Quedas, escaladas, fugas" },
  percepcao: { label: "Percepção", hint: "Achar recursos e pistas" },
  inteligencia: { label: "Inteligência", hint: "Entender o que vê" },
  controle_emocional: { label: "Controle emocional", hint: "Resistir ao medo e ao pânico" },
  medicina: { label: "Medicina", hint: "Tratar ferimentos" },
  orientacao: { label: "Orientação", hint: "Caminhar mais rápido, não se perder" },
  comunicacao: { label: "Comunicação", hint: "Convencer e acalmar pessoas" },
  furtividade: { label: "Furtividade", hint: "Observar sem ser visto" },
  improviso: { label: "Improviso", hint: "Fogo, abrigo, gambiarras" },
  conhecimento_tecnico: { label: "Conhecimento técnico", hint: "Rádio, fios, mecânica" },
};

export const BODY_LABEL: Record<string, string> = { magro: "Magro", medio: "Médio", robusto: "Robusto", acima_do_peso: "Acima do peso" };
export const COND_LABEL: Record<string, string> = { sedentario: "Sedentário", moderado: "Moderado", atletico: "Atlético" };
export const EXP_LABEL: Record<string, string> = {
  medicina: "Medicina",
  orientacao: "Orientação",
  mecanica: "Mecânica",
  tecnologia: "Tecnologia",
  sobrevivencia: "Sobrevivência",
};

export const PART_LABEL: Record<string, string> = {
  cabeca: "Cabeça", torso: "Tronco", braco_esq: "Braço esq.", braco_dir: "Braço dir.", perna_esq: "Perna esq.", perna_dir: "Perna dir.",
};
export const WOUND_LABEL: Record<string, string> = {
  corte: "Corte", laceracao: "Laceração", contusao: "Contusão", entorse: "Entorse", fratura: "Fratura", queimadura: "Queimadura",
};
export const CONTAINER_LABEL: Record<string, string> = {
  equipped: "Vestindo",
  pockets: "Bolsos",
  backpack_side: "Mochila · bolsos laterais",
  backpack_main: "Mochila · compartimento principal (+2 min)",
  hands: "Mãos",
};
export const SLOT_LABEL: Record<string, string> = {
  cabeca: "Cabeça", torso_base: "Camada base", torso_meio: "Camada média", torso_externo: "Camada externa",
  pernas: "Pernas", pes: "Pés", maos: "Mãos", manta: "Manta", costas: "Costas",
};
export const CATEGORY_ICON: Record<string, string> = {
  comida: "🥫", agua: "💧", ferramenta: "🔧", medico: "✚", roupa: "🧥", mochila: "🎒", luz: "🔦", combustivel: "🪵", documento: "📄", essencial: "⚡",
};
