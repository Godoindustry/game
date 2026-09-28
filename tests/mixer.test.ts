import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_LEVELS, VOICE_DUCK, mixVolume, onMixChange, peerVolume, useMixer } from "@/client/audioMixer";

beforeEach(() => {
  useMixer.getState().reset();
  useMixer.setState({ peerMuted: {}, peerVolume: {}, ducked: false, voiceActive: false });
});

describe("Mixer de áudio", () => {
  it("volume final = base × categoria × geral", () => {
    const { master } = useMixer.getState();
    expect(mixVolume("narracao", 0.5)).toBeCloseTo(0.5 * DEFAULT_LEVELS.narracao * master);
    useMixer.getState().setLevel("efeitos", 0.5);
    useMixer.getState().setMaster(1);
    expect(mixVolume("efeitos", 0.8)).toBeCloseTo(0.4);
  });

  it("narração fica acima de ambiente e música no padrão", () => {
    expect(DEFAULT_LEVELS.narracao).toBeGreaterThan(DEFAULT_LEVELS.ambiente);
    expect(DEFAULT_LEVELS.narracao).toBeGreaterThan(DEFAULT_LEVELS.musica);
  });

  it("silenciar tudo zera tudo, inclusive a voz dos participantes", () => {
    useMixer.getState().toggleMuted();
    expect(mixVolume("narracao", 1)).toBe(0);
    expect(peerVolume("ana")).toBe(0);
    useMixer.getState().toggleMuted();
    expect(mixVolume("narracao", 1)).toBeGreaterThan(0);
  });

  it("a música abaixa durante a luta com chefe; o resto não", () => {
    const normal = mixVolume("musica", 1);
    const efeito = mixVolume("efeitos", 1);
    useMixer.getState().setDucked(true);
    expect(mixVolume("musica", 1)).toBeCloseTo(normal * 0.25);
    expect(mixVolume("efeitos", 1)).toBeCloseTo(efeito);
  });

  it("mantém a voz na frente e recua ruídos, ambiente e música durante uma fala", () => {
    const voice = mixVolume("narracao", 1);
    const effect = mixVolume("efeitos", 1);
    const ambience = mixVolume("ambiente", 1);
    const music = mixVolume("musica", 1);
    useMixer.getState().setVoiceActive(true);
    expect(mixVolume("narracao", 1)).toBeCloseTo(voice);
    expect(mixVolume("efeitos", 1)).toBeCloseTo(effect * VOICE_DUCK.efeitos);
    expect(mixVolume("ambiente", 1)).toBeCloseTo(ambience * VOICE_DUCK.ambiente);
    expect(mixVolume("musica", 1)).toBeCloseTo(music * VOICE_DUCK.musica);
  });

  it("dá para desligar e ajustar cada participante separadamente", () => {
    const base = peerVolume("ana");
    expect(base).toBeGreaterThan(0);
    useMixer.getState().togglePeer("ana");
    expect(peerVolume("ana")).toBe(0);
    expect(peerVolume("beto")).toBeCloseTo(base);
    useMixer.getState().togglePeer("ana");
    useMixer.getState().setPeerVolume("beto", 0.5);
    expect(peerVolume("beto")).toBeCloseTo(base * 0.5);
    expect(peerVolume("ana")).toBeCloseTo(base);
  });

  it("volumes nunca passam de 1 nem ficam negativos", () => {
    useMixer.getState().setMaster(5);
    useMixer.getState().setLevel("efeitos", -3);
    expect(useMixer.getState().master).toBe(1);
    expect(mixVolume("efeitos", 1)).toBe(0);
    useMixer.getState().setPeerVolume("ana", 9);
    expect(peerVolume("ana")).toBeLessThanOrEqual(1);
  });

  it("quem ouve mudanças é avisado (loops acompanham o slider)", () => {
    let calls = 0;
    const off = onMixChange(() => calls++);
    useMixer.getState().setLevel("ambiente", 0.3);
    off();
    useMixer.getState().setLevel("ambiente", 0.4);
    expect(calls).toBe(1);
  });
});
