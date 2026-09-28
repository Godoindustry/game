import { beforeEach, describe, expect, it } from "vitest";
import { freshApp, registered } from "./helpers";
import { mediaBase, mediaConfigured, mediaUrl } from "@/server/services/media";

const CLOUD = "nuvem-de-teste";
const CDN = `https://res.cloudinary.com/${CLOUD}`;
const SUPABASE = "https://audio-teste.supabase.co";
const STORAGE = `${SUPABASE}/storage/v1/object/public/audio/estatico`;

describe("CDN de mídia (Cloudinary)", () => {
  beforeEach(() => freshApp());

  it("sem Cloudinary nada muda: o caminho local sai intacto", () => {
    expect(mediaConfigured()).toBe(false);
    expect(mediaBase()).toBe("");
    expect(mediaUrl("/audio/narracao/ch_abrir_1.mp3")).toBe("/audio/narracao/ch_abrir_1.mp3");
    expect(mediaUrl("/art/vale-silente/landing-hero.webp")).toBe("/art/vale-silente/landing-hero.webp");
  });

  it("com Cloudinary o public_id é o caminho sem extensão, e o tipo bate com o arquivo", () => {
    freshApp({ CLOUDINARY_CLOUD_NAME: CLOUD });
    expect(mediaConfigured()).toBe(true);
    // Áudio e vídeo no Cloudinary são o resource type `video`; imagem é `image`.
    expect(mediaUrl("/audio/narracao/ch_abrir_1.mp3")).toBe(`${CDN}/video/upload/audio/narracao/ch_abrir_1.mp3`);
    expect(mediaUrl("/audio/cenario/ambiente-noite.mp3")).toBe(`${CDN}/video/upload/audio/cenario/ambiente-noite.mp3`);
    expect(mediaUrl("/art/vale-silente/landing-hero.webp")).toBe(`${CDN}/image/upload/art/vale-silente/landing-hero.webp`);
    expect(mediaUrl("/assets/mapa-vale-silente.png")).toBe(`${CDN}/image/upload/assets/mapa-vale-silente.png`);
    // Prefixo que o cliente concatena com `/audio/...`: tem de bater com a URL de cima.
    expect(mediaBase()).toBe(`${CDN}/video/upload`);
    expect(`${mediaBase()}/audio/narracao/ch_abrir_1.mp3`).toBe(mediaUrl("/audio/narracao/ch_abrir_1.mp3"));
  });

  it("usa o Supabase para todo áudio e mantém o Cloudinary apenas para as artes", () => {
    freshApp({
      SUPABASE_URL: SUPABASE,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      CLOUDINARY_CLOUD_NAME: CLOUD,
    });
    expect(mediaConfigured()).toBe(true);
    expect(mediaBase()).toBe(STORAGE);
    expect(mediaUrl("/audio/narracao/ch_abrir_1.mp3")).toBe(`${STORAGE}/audio/narracao/ch_abrir_1.mp3`);
    expect(mediaUrl("/audio/dado/rolando.mp3")).toBe(`${STORAGE}/audio/dado/rolando.mp3`);
    expect(mediaUrl("/art/vale-silente/landing-hero.webp")).toBe(`${CDN}/image/upload/art/vale-silente/landing-hero.webp`);
  });

  it("URL absoluta e rota de API nunca são reescritas", () => {
    freshApp({ CLOUDINARY_CLOUD_NAME: CLOUD });
    expect(mediaUrl("https://exemplo.test/a.mp3")).toBe("https://exemplo.test/a.mp3");
    expect(mediaUrl("data:audio/mpeg;base64,AAA")).toBe("data:audio/mpeg;base64,AAA");
    expect(mediaUrl("/api/campaigns/x/state")).toBe("/api/campaigns/x/state");
  });

  it("o estado do jogo entrega o prefixo para o cliente montar os efeitos", async () => {
    await freshApp({ CLOUDINARY_CLOUD_NAME: CLOUD });
    const user = await registered("Dona CDN");
    const camp = await user.client.post("/api/campaigns", { name: "Mesa CDN", mode: "solo" });
    const id = camp.body.id as string;
    await user.client.post(`/api/campaigns/${id}/character`, {
      name: "Ana Ribeiro", sex: "feminino", age: 32, heightCm: 168, weightKg: 62, bodyType: "medio",
      conditioning: "moderado", profession: "enfermagem", knowledge: "Primeiros socorros", fears: "Escuro",
      history: "Voltava de um plantão.", personality: "Calma", experiences: ["medicina"],
      attributes: {
        forca: 3, resistencia: 3, agilidade: 3, percepcao: 3, inteligencia: 3, controle_emocional: 3,
        medicina: 3, orientacao: 3, comunicacao: 3, furtividade: 3, improviso: 3, conhecimento_tecnico: 3,
      },
    });
    await user.client.post(`/api/campaigns/${id}/start`);

    const state = await user.client.get(`/api/campaigns/${id}/state`);
    expect(state.body.media.audioBase).toBe(`${CDN}/video/upload`);
    // A arte do mapa também sai pela CDN, porque o servidor a entrega pronta.
    expect(state.body.map.image).toBe(`${CDN}/image/upload/assets/mapa-vale-silente.png`);
  });
});
