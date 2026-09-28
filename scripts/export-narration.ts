/**
 * Escreve todas as falas fixas da história na célula 4 do notebook do Chatterbox
 * (narrador/narrador_chatterbox.ipynb) e numa cópia em texto (narrador/falas-vale-silente.txt).
 *
 *   npm run narration:export
 *
 * Depois: abra o notebook no Colab, rode as células e baixe o narrador.zip.
 * Para colocar no jogo: npm run narration:import -- caminho/do/narrador.zip
 */
import fs from "node:fs";
import path from "node:path";
import { VALE_SILENTE } from "../src/server/content/valeSilente";
import { narrationScript } from "../src/server/services/narrationPack";

const NOTEBOOK = path.resolve("narrador", "narrador_chatterbox.ipynb");
const TEXT_COPY = path.resolve("narrador", "falas-vale-silente.txt");

const lines = narrationScript(VALE_SILENTE);
const falas = [
  "# Gerado por `npm run narration:export` a partir do conteúdo do jogo. Não edite as chaves:",
  "# o jogo encontra cada áudio pelo nome. Para mudar um texto, mude no jogo e exporte de novo.",
  ...lines.map((line) => `${line.key} | ${line.emotion} | ${line.spoken.replace(/\|/g, "/")}`),
].join("\n");

fs.writeFileSync(TEXT_COPY, `${falas}\n`, "utf8");

const notebook = JSON.parse(fs.readFileSync(NOTEBOOK, "utf8")) as { cells: { id?: string; source: string[] | string }[] };
const cell = notebook.cells.find((c) => (Array.isArray(c.source) ? c.source.join("") : c.source).includes('FALAS = """'));
if (!cell) throw new Error("Não achei a célula com FALAS no notebook.");
const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source;
const updated = source.replace(/FALAS = """[\s\S]*?\n"""/, `FALAS = """\n${falas}\n"""`);
cell.source = updated.split(/(?<=\n)/);
fs.writeFileSync(NOTEBOOK, `${JSON.stringify(notebook, null, 1)}\n`, "utf8");

const byEmotion = lines.reduce<Record<string, number>>((acc, line) => ({ ...acc, [line.emotion]: (acc[line.emotion] ?? 0) + 1 }), {});
const chars = lines.reduce((sum, line) => sum + line.spoken.length, 0);
console.log(`${lines.length} trechos (${chars} caracteres) exportados.`);
console.log("Por emoção:", byEmotion);
console.log(`Notebook atualizado: ${path.relative(process.cwd(), NOTEBOOK)}`);
console.log(`Cópia em texto:      ${path.relative(process.cwd(), TEXT_COPY)}`);
