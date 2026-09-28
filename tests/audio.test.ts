import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SFX } from "@/client/game/useAudio";
import { HORROR } from "@/client/game/horrorAudio";
import { AUDIO_SCRIPT, ROLE_DIR } from "../scripts/generate-audio.js";
import { SOURCES } from "../scripts/import-audio.mjs";

const AUDIO = path.join(process.cwd(), "public", "audio");
const flat = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(flat) : Object.values(v as object).flatMap(flat));

describe("Áudios organizados por pessoa e situação", () => {
  it("todo som do catálogo e da trilha de terror existe em public/audio/<pessoa>/", () => {
    const missing = [...flat(SFX), ...flat(HORROR)].filter((id) => !fs.existsSync(path.join(AUDIO, `${id}.mp3`)));
    expect(missing).toEqual([]);
    for (const id of [...flat(SFX), ...flat(HORROR)]) expect(id, id).toMatch(/^[a-z-]+\/[a-z0-9-]+$/);
  });

  it("todo áudio da lista de importação do Pixabay está no jogo e tem crédito", () => {
    const credits = fs.readFileSync(path.join(AUDIO, "CREDITOS.md"), "utf8");
    for (const [, dst] of SOURCES as [string, string][]) {
      expect(fs.existsSync(path.join(AUDIO, `${dst}.mp3`)), dst).toBe(true);
      expect(credits, `crédito de ${dst}`).toContain(`| ${dst} |`);
    }
  });

  it("o gerador de narração salva cada voz na pasta da sua pessoa", () => {
    for (const item of AUDIO_SCRIPT as { id: string; role: keyof typeof ROLE_DIR }[]) {
      expect(ROLE_DIR[item.role], item.id).toBeTruthy();
    }
  });

  it("não há arquivos repetidos (mesmo conteúdo) nem soltos na raiz", async () => {
    const { createHash } = await import("node:crypto");
    const files: string[] = [];
    for (const dir of fs.readdirSync(AUDIO, { withFileTypes: true })) {
      if (dir.isFile()) expect(dir.name, "arquivo solto na raiz").toMatch(/\.md$/);
      else for (const f of fs.readdirSync(path.join(AUDIO, dir.name))) files.push(path.join(AUDIO, dir.name, f));
    }
    const seen = new Map<string, string>();
    for (const f of files) {
      const h = createHash("md5").update(fs.readFileSync(f)).digest("hex");
      expect(seen.get(h), `${f} repete ${seen.get(h)}`).toBeUndefined();
      seen.set(h, f);
    }
  });
});
