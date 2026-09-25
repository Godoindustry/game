/**
 * Som procedural (Web Audio API): chuva, vento, batimento cardíaco e bipes de HUD
 * gerados em tempo real — sem arquivos de áudio. O contexto só nasce depois de um
 * gesto do usuário (política de autoplay dos navegadores).
 */

type Ctx = AudioContext;

function noiseBuffer(ctx: Ctx, seconds: number, brown: boolean): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else data[i] = white;
  }
  return buf;
}

class SoundEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private rain: GainNode | null = null;
  private wind: GainNode | null = null;
  private heart: GainNode | null = null;
  private heartLevel = 0;
  private heartTimer: ReturnType<typeof setTimeout> | null = null;
  private muted = false;
  private target = { rain: 0, wind: 0 };

  get ready(): boolean {
    return !!this.ctx;
  }

  /** Chamar dentro de um gesto do usuário. Idempotente. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    // Chuva: ruído branco com banda limitada.
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseBuffer(ctx, 2.5, false);
    rainSrc.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 500;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3800;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    rainSrc.connect(hp).connect(lp).connect(this.rain).connect(this.master);
    rainSrc.start();

    // Vento: ruído marrom num passa-banda que "respira" com um LFO lento.
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuffer(ctx, 4, true);
    windSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 380;
    bp.Q.value = 0.9;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(bp.frequency);
    lfo.start();
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    windSrc.connect(bp).connect(this.wind).connect(this.master);
    windSrc.start();

    this.heart = ctx.createGain();
    this.heart.gain.value = 0;
    this.heart.connect(this.master);

    this.applyAmbient();
    if (this.heartLevel > 0) this.scheduleBeat();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.1);
  }

  /** Níveis 0..1; a transição é suave (alguns segundos). */
  setAmbient(rain: number, wind: number): void {
    this.target = { rain, wind };
    this.applyAmbient();
  }

  private applyAmbient(): void {
    if (!this.ctx || !this.rain || !this.wind) return;
    const t = this.ctx.currentTime;
    this.rain.gain.setTargetAtTime(this.target.rain * 0.16, t, 1.8);
    this.wind.gain.setTargetAtTime(this.target.wind * 0.22, t, 2.5);
  }

  /** Batimento: 0 desliga; 0..1 controla volume e ritmo (fader contínuo). */
  setHeartbeat(level: number): void {
    this.heartLevel = Math.max(0, Math.min(1, level));
    if (!this.ctx || !this.heart) return;
    this.heart.gain.setTargetAtTime(this.heartLevel * 0.9, this.ctx.currentTime, 1.2);
    if (this.heartLevel > 0 && !this.heartTimer) this.scheduleBeat();
  }

  private thump(at: number, freq: number, amp: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, at);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, at + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(amp, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    o.connect(g).connect(this.heart!);
    o.start(at);
    o.stop(at + 0.22);
  }

  private scheduleBeat(): void {
    this.heartTimer = null;
    if (!this.ctx || this.heartLevel <= 0) return;
    const bpm = 68 + 72 * this.heartLevel;
    const at = this.ctx.currentTime + 0.02;
    this.thump(at, 62, 0.9);
    this.thump(at + 0.16, 52, 0.6);
    this.heartTimer = setTimeout(() => this.scheduleBeat(), 60_000 / bpm);
  }

  /** Bipe tático curto do HUD. */
  beep(kind: "click" | "alert" = "click"): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    const tones = kind === "click" ? [[1760, 0, 0.045]] : [[660, 0, 0.12], [440, 0.15, 0.2]];
    for (const [f, delay, dur] of tones) {
      const o = ctx.createOscillator();
      o.type = kind === "click" ? "square" : "triangle";
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      const g = ctx.createGain();
      const vol = kind === "click" ? 0.035 : 0.09;
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(lp).connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + dur + 0.02);
    }
  }

  /** Silencia tudo e libera o contexto (ao sair da tela de jogo). */
  dispose(): void {
    if (this.heartTimer) clearTimeout(this.heartTimer);
    this.heartTimer = null;
    void this.ctx?.close();
    this.ctx = this.master = this.rain = this.wind = this.heart = null;
  }
}

export const sound = new SoundEngine();
