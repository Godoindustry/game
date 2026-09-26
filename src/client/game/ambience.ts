"use client";
/**
 * Ambiente sonoro procedural (Web Audio, sem arquivos): vento sempre,
 * chuva quando chove, grilos à noite, estalos quando há fogo no local e
 * batimento cardíaco com estresse extremo. O navegador só libera áudio
 * depois de um gesto do usuário, então o contexto nasce no primeiro clique/tecla.
 */
import { useEffect, useRef } from "react";

export interface AmbienceParams {
  enabled: boolean;
  night: boolean;
  rain: boolean;
  fire: boolean;
  stress: number;
}

class Ambience {
  private ctx: AudioContext;
  private master: GainNode;
  private rainGain: GainNode;
  private cricketGain: GainNode;
  private noise: AudioBuffer;
  private timers: number[] = [];
  private p: AmbienceParams = { enabled: false, night: false, rain: false, fire: false, stress: 0 };

  constructor() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Vento: ruído grave com filtro que "respira".
    const wind = this.loopNoise();
    const windLp = ctx.createBiquadFilter();
    windLp.type = "lowpass";
    windLp.frequency.value = 380;
    windLp.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(windLp.frequency);
    const windGain = ctx.createGain();
    windGain.gain.value = 0.18;
    wind.connect(windLp).connect(windGain).connect(this.master);
    lfo.start();

    // Chuva: ruído agudo, ligado por ganho.
    const rain = this.loopNoise();
    const rainBp = ctx.createBiquadFilter();
    rainBp.type = "bandpass";
    rainBp.frequency.value = 2600;
    rainBp.Q.value = 0.6;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainBp).connect(this.rainGain).connect(this.master);

    // Grilos: bus com ganho controlado pela noite; os cantos são agendados abaixo.
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    this.cricketGain.connect(this.master);

    this.timers.push(window.setInterval(() => this.cricket(), 1100));
    this.timers.push(window.setInterval(() => this.crackle(), 140));
    this.timers.push(window.setInterval(() => this.heartbeat(), 950));
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  private ramp(g: GainNode, v: number, secs = 1.5) {
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(v, t + secs);
  }

  update(p: AmbienceParams) {
    this.p = p;
    if (p.enabled && this.ctx.state === "suspended") void this.ctx.resume();
    this.ramp(this.master, p.enabled ? 0.35 : 0, 1.2);
    this.ramp(this.rainGain, p.rain ? 0.22 : 0, 3);
    this.ramp(this.cricketGain, p.night && !p.rain ? 0.05 : 0, 4);
  }

  private cricket() {
    if (!this.p.enabled || !this.p.night || this.p.rain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + Math.random() * 0.4;
    const freq = 4200 + Math.random() * 600;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.cricketGain);
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0;
      const s = t + i * 0.07;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(1, s + 0.008);
      g.gain.linearRampToValueAtTime(0, s + 0.045);
      o.connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.06);
    }
  }

  private crackle() {
    if (!this.p.enabled || !this.p.fire || Math.random() > 0.35) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1500 + Math.random() * 2500;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const peak = 0.08 + Math.random() * 0.25;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03 + Math.random() * 0.05);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, 0.1);
  }

  private heartbeat() {
    if (!this.p.enabled || this.p.stress <= 80) return;
    const ctx = this.ctx;
    const beat = (at: number, vol: number) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(70, at);
      o.frequency.exponentialRampToValueAtTime(40, at + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
      o.connect(g).connect(this.master);
      o.start(at);
      o.stop(at + 0.2);
    };
    const t = ctx.currentTime + 0.02;
    beat(t, 0.9);
    beat(t + 0.22, 0.6);
  }

  close() {
    for (const t of this.timers) clearInterval(t);
    void this.ctx.close();
  }
}

export function useAmbience(params: AmbienceParams) {
  const ref = useRef<Ambience | null>(null);
  const latest = useRef(params);

  const { enabled, night, rain, fire, stress } = params;
  useEffect(() => {
    const p = { enabled, night, rain, fire, stress };
    latest.current = p;
    ref.current?.update(p);
  }, [enabled, night, rain, fire, stress]);

  useEffect(() => {
    const start = () => {
      if (ref.current) return;
      try {
        ref.current = new Ambience();
        ref.current.update(latest.current);
      } catch {
        // Sem Web Audio: o jogo segue em silêncio.
      }
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      ref.current?.close();
      ref.current = null;
    };
  }, []);
}
