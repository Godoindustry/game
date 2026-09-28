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
  { id: "justica", name: "Rumo 074", description: "Saia do vale contando a verdade pelo rádio.", icon: "radio", points: 120, hidden: true },
  { id: "queda", name: "A névoa chama", description: "Morra na ravina.", icon: "caveira", points: 5, hidden: true },
  // Chefes
  { id: "mae_caida", name: "Silêncio no poço", description: "Derrote a Mãe das Asas.", icon: "chama", points: 60 },
  { id: "lobo_ambar", name: "O nome sob o pelo", description: "Resolva o Lobo de Âmbar — pela força ou pelo nome.", icon: "lua", points: 60 },
  { id: "tavares", name: "Fim da linha", description: "Tire Tavares do caminho.", icon: "caveira", points: 60 },
  { id: "iara_paz", name: "Ela descansa", description: "Dê paz à voz de Iara.", icon: "radio", points: 80 },
  { id: "pacto", name: "Filho da noite", description: "Aceite o pacto de sangue da Mãe das Asas.", icon: "lua", points: 40, hidden: true },
];
