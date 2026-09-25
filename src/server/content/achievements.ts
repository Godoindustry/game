export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  points: number;
  hidden?: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "pioneiro", name: "Pioneiro", description: "Um dos 12 primeiros sobreviventes cadastrados.", icon: "estrela", points: 50 },
  { id: "primeira_noite", name: "Primeira noite", description: "Sobreviva até o amanhecer.", icon: "lua", points: 20 },
  { id: "resgatado", name: "Resgatado", description: "Saia do vale com vida.", icon: "helicoptero", points: 100 },
  { id: "investigador", name: "Investigador", description: "Encontre 5 pistas em uma campanha.", icon: "lupa", points: 30 },
  { id: "verdade", name: "A verdade na frequência", description: "Encontre 10 pistas em uma campanha.", icon: "radio", points: 80 },
  { id: "medico_de_campo", name: "Médico de campo", description: "Trate um ferimento com sucesso.", icon: "cruz", points: 15 },
  { id: "fogo", name: "Fogo", description: "Acenda uma fogueira.", icon: "chama", points: 15 },
  { id: "abrigo", name: "Teto improvisado", description: "Monte um abrigo.", icon: "tenda", points: 15 },
  { id: "confianca", name: "Voz amiga", description: "Converse com o piloto sem que ele fuja.", icon: "balao", points: 20 },
  { id: "equipe", name: "Ninguém fica para trás", description: "Vença uma campanha cooperativa.", icon: "grupo", points: 60 },
  { id: "queda", name: "A névoa chama", description: "Morra na ravina.", icon: "caveira", points: 5, hidden: true },
];
