import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioDirector } from "@/client/game/audioDirector";
import { useMixer } from "@/client/audioMixer";

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
    useMixer.getState().reset();
    useMixer.setState({ voiceActive: false });
  });

  afterEach(() => {
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
});
