/** Web Audio synthesizer. No external files: every sound is generated procedurally. */
const MASTER_VOLUME = 0.6;
/** One-shot sounds closer together than this are dropped, so a cascade of snaps stays a crackle. */
const MIN_ONE_SHOT_GAP = 0.04;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Ready = { ctx: AudioContext; master: GainNode };

export class AudioSynth {
  private muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private lastOneShot = new Map<string, number>();
  private rumble: {
    source: AudioBufferSourceNode;
    osc: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
  } | null = null;

  /** Call from a user gesture; browsers keep the AudioContext suspended until then. */
  resume(): void {
    const ctx = this.getContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.05);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  playClack(): void {
    if (!this.allowOneShot('clack')) return;
    this.noiseHit('bandpass', 2200, 3, 0.05, 0.5);
    this.tone('sine', 900, 500, 0.03, 0.15);
  }

  playBraceStretch(): void {
    if (!this.allowOneShot('stretch')) return;
    this.tone('sawtooth', 180, 320, 0.3, 0.08);
    this.noiseHit('bandpass', 900, 1.5, 0.25, 0.12);
  }

  playJointSnap(): void {
    if (!this.allowOneShot('snap')) return;
    this.noiseHit('highpass', 2500, 1, 0.08, 0.7);
    this.tone('square', 320, 110, 0.12, 0.18);
  }

  /** intensity 0..1 */
  playWind(intensity: number): void {
    const v = clamp(intensity, 0, 1);
    // Loops follow the latest intensity even while muted (the master bus handles muting), so a
    // playWind(0) sent while muted still stops the loop and it does not come back on unmute.
    if (!this.wind && (v === 0 || this.muted)) return;
    const ready = this.bus();
    if (!ready) return;
    if (!this.wind) {
      const { ctx, master } = ready;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(master);
      source.start();
      this.wind = { source, filter, gain };
    }
    const t = ready.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(v * 0.35, t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(300 + v * 1200, t, 0.2);
  }

  /** intensity 0..1 */
  playRumble(intensity: number): void {
    const v = clamp(intensity, 0, 1);
    // Loops follow the latest intensity even while muted (the master bus handles muting), so a
    // playRumble(0) sent while muted still stops the loop and it does not come back on unmute.
    if (!this.rumble && (v === 0 || this.muted)) return;
    const ready = this.bus();
    if (!ready) return;
    if (!this.rumble) {
      const { ctx, master } = ready;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 40;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain);
      osc.connect(gain);
      gain.connect(master);
      source.start();
      osc.start();
      this.rumble = { source, osc, filter, gain };
    }
    const t = ready.ctx.currentTime;
    this.rumble.gain.gain.setTargetAtTime(v * 0.6, t, 0.2);
    this.rumble.filter.frequency.setTargetAtTime(80 + v * 120, t, 0.2);
    this.rumble.osc.frequency.setTargetAtTime(35 + v * 15, t, 0.2);
  }

  playVictory(): void {
    if (!this.allowOneShot('victory')) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone('triangle', f, f * 1.005, 0.5, 0.25, i * 0.13));
  }

  playLaserZap(): void {
    if (!this.allowOneShot('laser')) return;
    this.tone('sawtooth', 1400, 340, 0.09, 0.2);
    this.tone('sine', 2100, 620, 0.07, 0.12);
  }

  playUnlock(): void {
    if (!this.allowOneShot('unlock')) return;
    const notes = [587.33, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone('triangle', f, f * 1.01, 0.25, 0.22, i * 0.08));
  }

  playHit(): void {
    if (!this.allowOneShot('hit')) return;
    this.noiseHit('lowpass', 750, 1.2, 0.12, 0.65);
    this.tone('sawtooth', 190, 75, 0.14, 0.25);
  }

  playKO(): void {
    if (!this.allowOneShot('ko')) return;
    const notes = [392, 311.13, 220];
    notes.forEach((f, i) => this.tone('sawtooth', f, f * 0.88, 0.24, 0.24, i * 0.1));
  }

  dispose(): void {
    for (const node of [this.wind, this.rumble]) {
      if (!node) continue;
      try {
        node.source.stop();
      } catch {
        // already stopped
      }
    }
    if (this.rumble) {
      try {
        this.rumble.osc.stop();
      } catch {
        // already stopped
      }
    }
    this.wind = null;
    this.rumble = null;
    this.master = null;
    this.noise = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  // ------------------------------------------------------------ internals

  private getContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const w = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  /** Context and output bus for a one-shot, or null when there is no audio or the sound is muted. */
  private ready(): Ready | null {
    if (this.muted) return null;
    return this.bus();
  }

  /** Context and output bus regardless of mute, or null when there is no Web Audio. */
  private bus(): Ready | null {
    const ctx = this.getContext();
    if (!ctx || !this.master) return null;
    return { ctx, master: this.master };
  }

  private allowOneShot(key: string): boolean {
    const ctx = this.ctx;
    if (this.muted || !ctx) return !this.muted;
    const last = this.lastOneShot.get(key) ?? -Infinity;
    if (ctx.currentTime - last < MIN_ONE_SHOT_GAP) return false;
    this.lastOneShot.set(key, ctx.currentTime);
    return true;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const length = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  private noiseHit(filter: BiquadFilterType, freq: number, q: number, duration: number, peak: number): void {
    const ready = this.ready();
    if (!ready) return;
    const { ctx, master } = ready;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(f).connect(g).connect(master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  private tone(
    type: OscillatorType,
    fromHz: number,
    toHz: number,
    duration: number,
    peak: number,
    delay = 0,
  ): void {
    const ready = this.ready();
    if (!ready) return;
    const { ctx, master } = ready;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(toHz, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
}
