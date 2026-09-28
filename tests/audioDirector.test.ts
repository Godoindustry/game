import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioDirector } from "@/client/game/audioDirector";
import { useMixer } from "@/client/audioMixer";
import { setMediaAudioBase } from "@/client/game/mediaBase";

class FakeAudio {
  static instances: FakeAudio[] = [];
  volume = 1;
  loop = false;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly src: string) {
    FakeAudio.instances.push(this);
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

describe("Diretor de áudio", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
    setMediaAudioBase("");
    useMixer.getState().reset();
    useMixer.setState({ voiceActive: false });
  });

  afterEach(() => {
    setMediaAudioBase("");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("toca uma única voz por vez e respeita a pausa entre falas", async () => {
    const director = new AudioDirector();
    director.voiceFile("/primeira.mp3");
    director.voiceFile("/segunda.mp3");

    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["/primeira.mp3"]);
    expect(useMixer.getState().voiceActive).toBe(true);

    FakeAudio.instances[0].onended?.();
    await Promise.resolve();
    expect(FakeAudio.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(350);
    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["/primeira.mp3", "/segunda.mp3"]);
  });

  it("descarta alertas de HUD quando já existe uma fala", () => {
    const director = new AudioDirector();
    director.voiceFile("/narrador.mp3", 1, "narracao");
    director.voiceFile("/alerta.mp3", 1, "alerta");

    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["/narrador.mp3"]);
  });

  it("encerra a voz atual antes de aceitar uma nova narração", async () => {
    const director = new AudioDirector();
    director.voiceFile("/antiga.mp3");
    const antiga = FakeAudio.instances[0];

    director.stopVoices();
    expect(antiga.paused).toBe(true);
    expect(useMixer.getState().voiceActive).toBe(false);

    director.voiceFile("/nova.mp3");
    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["/antiga.mp3", "/nova.mp3"]);
    await Promise.resolve();
  });

  it("cai no arquivo local quando o áudio do Supabase falha", () => {
    setMediaAudioBase("https://audio.test/storage/v1/object/public/audio/estatico");
    const director = new AudioDirector();
    director.sting("dado/rolando", 1, { important: true });

    expect(FakeAudio.instances[0].src).toContain("/estatico/audio/dado/rolando.mp3");
    FakeAudio.instances[0].onerror?.();
    expect(FakeAudio.instances[1].src).toBe("/audio/dado/rolando.mp3");
  });
});
