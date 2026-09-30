/**
 * Quais linhas do diário o narrador lê em voz alta.
 *
 * Cada escolha grava duas linhas seguidas para o mesmo personagem: `result` (fatos do motor)
 * e `narrative`/`npc` (a mesma cena recontada — pela IA ou, sem IA, com o próprio texto do
 * resultado como reserva). Ler as duas fazia o locutor repetir a cena; fica só a recontada.
 */
export interface VoiceLine {
  id: number;
  kind: string;
  characterId?: string | null;
  text: string;
}

const norm = (text: string) =>
  text.replace(/【[^】]*】/g, " ").replace(/[“”"«»⏱]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");

export function narrationQueue<T extends VoiceLine>(lines: T[]): T[] {
  return lines.filter((line, index) => {
    const next = lines[index + 1];
    if (!next) return true;
    if (line.kind === "result" && (next.kind === "narrative" || next.kind === "npc") && (next.characterId ?? null) === (line.characterId ?? null)) return false;
    // Rede de segurança: a mesma fala (ou um trecho dela) repetida na linha seguinte.
    const text = norm(line.text);
    return !text || !norm(next.text).includes(text);
  });
}
