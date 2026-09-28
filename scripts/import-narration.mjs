/**
 * Coloca no jogo a narração gerada no Colab (narrador/narrador_chatterbox.ipynb).
 *
 *   npm run narration:import -- "C:/Users/voce/Downloads/narrador.zip"
 *   npm run narration:import -- "C:/pasta/descompactada"
 *
 * Copia os MP3 para public/audio/narracao/ (substituindo os anteriores) e grava o índice
 * src/server/content/narracao.json, que o servidor importa para achar a fala de cada linha.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const input = process.argv[2];
if (!input) {
  console.error('Uso: npm run narration:import -- "caminho/do/narrador.zip"');
  process.exit(1);
}

/**
 * No Windows usa o tar.exe do sistema (bsdtar abre .zip); o "tar" do Git Bash é o GNU,
 * que não abre zip. Sem ele, cai no Expand-Archive do PowerShell; fora do Windows, unzip.
 */
function unzip(file, into) {
  if (process.platform === "win32") {
    const systemTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    try {
      execFileSync(systemTar, ["-xf", file, "-C", into], { stdio: "pipe" });
      return;
    } catch {
      execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${file.replace(/'/g, "''")}' -DestinationPath '${into.replace(/'/g, "''")}' -Force`], { stdio: "pipe" });
      return;
    }
  }
  execFileSync("unzip", ["-q", file, "-d", into], { stdio: "pipe" });
}

const OUT = path.resolve("public", "audio", "narracao");
const INDEX = path.resolve("src", "server", "content", "narracao.json");

let dir = path.resolve(input);
let temp = null;
if (fs.statSync(dir).isFile()) {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "narracao-"));
  unzip(dir, temp);
  dir = temp;
}

const manifestPath = [path.join(dir, "narrador.json"), path.join(dir, "narrador", "narrador.json")].find((p) => fs.existsSync(p));
if (!manifestPath) {
  console.error("Não achei narrador.json dentro do pacote. Use o .zip baixado pela célula 6 do notebook.");
  process.exit(1);
}
const base = path.dirname(manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const eventos = manifest.eventos ?? {};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let copied = 0;
const missing = [];
const index = {};
for (const [evento, falas] of Object.entries(eventos)) {
  const ok = [];
  for (const fala of falas) {
    const src = path.join(base, fala.arquivo);
    if (!fs.existsSync(src)) {
      missing.push(fala.arquivo);
      continue;
    }
    fs.copyFileSync(src, path.join(OUT, fala.arquivo));
    ok.push({ arquivo: fala.arquivo, texto: fala.texto });
    copied++;
  }
  if (ok.length) index[evento] = ok;
}

fs.writeFileSync(INDEX, `${JSON.stringify({ versao: 1, eventos: index }, null, 2)}\n`, "utf8");
if (temp) fs.rmSync(temp, { recursive: true, force: true });

console.log(`${copied} falas copiadas para ${path.relative(process.cwd(), OUT)}`);
console.log(`Índice gravado em ${path.relative(process.cwd(), INDEX)}`);
if (missing.length) console.warn(`${missing.length} arquivos citados no narrador.json não vieram no pacote:`, missing.slice(0, 10));
console.log("Reinicie o servidor (npm run dev) para o índice novo valer.");
