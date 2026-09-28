import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshApp } from "./helpers";
import {
  libraryConfigured,
  libraryHas,
  libraryPath,
  libraryPut,
  libraryStaticBase,
  libraryUrl,
  resetLibraryCache,
} from "@/server/services/audioLibrary";

const URL = "https://audio-teste.supabase.co";
const KEY = "service-role-teste";

describe("Biblioteca reutilizável de áudio", () => {
  beforeEach(async () => {
    await freshApp({ SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: KEY, AUDIO_BUCKET: "audio" });
    resetLibraryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLibraryCache();
  });

  it("produz caminhos estáveis por conteúdo e URL pública", () => {
    const first = libraryPath("vozes", ["pt-BR", "narrador", "fala"], "mp3");
    expect(first).toBe(libraryPath("vozes", ["pt-BR", "narrador", "fala"], "mp3"));
    expect(first).not.toBe(libraryPath("vozes", ["pt-BR", "outra-voz", "fala"], "mp3"));
    expect(libraryConfigured()).toBe(true);
    expect(libraryStaticBase()).toBe(`${URL}/storage/v1/object/public/audio/estatico`);
    expect(libraryUrl(first)).toBe(`${URL}/storage/v1/object/public/audio/${first}`);
  });

  it("reaproveita uma consulta em andamento e memoriza o resultado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([libraryHas("vozes/ab/fala.mp3"), libraryHas("vozes/ab/fala.mp3")]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(await libraryHas("vozes/ab/fala.mp3")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cria o bucket e envia o áudio somente com a chave do servidor", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await libraryPut("vozes/ab/fala.mp3", Buffer.from([1, 2, 3]), "audio/mpeg")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${URL}/storage/v1/bucket`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${URL}/storage/v1/object/audio/vozes/ab/fala.mp3`);
    const upload = fetchMock.mock.calls[1][1] as RequestInit;
    expect(upload.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "x-upsert": "true" });
  });
});
