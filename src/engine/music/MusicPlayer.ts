/** Plays the procedural score through Web Audio with a small look-ahead scheduler. */
import { THEMES, midiToHz, type NoteEvent, type ThemeName } from './score';

const LOOKAHEAD_S = 0.25;
const TICK_MS = 60;
const FADE_S = 0.35;
/** Music sits well under the sound effects at full slider. */
const MUSIC_BASE_GAIN = 0.5;
const DUCK_FACTOR = 0.3;

interface Run {
  theme: ThemeName;
  bus: GainNode;
  /** Context time at which beat 0 of the current loop pass starts. */
  loopStart: number;
  cursor: number;
}

export class MusicPlayer {
  private readonly out: GainNode;
  private noise: AudioBuffer | null = null;
  private run: Run | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private theme: ThemeName = 'menu';
  private volume = 0.5;
  private ducked = false;
  private playing = false;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.connect(destination);
    this.applyGain();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyGain();
    this.sync();
  }

  /** Lowers the music (e.g. while a dialog is open) without stopping it. */
  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.applyGain();
  }

  setTheme(theme: ThemeName): void {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.run) this.beginRun();
  }

  /** Starts (or keeps) playing. Call once the context is running. */
  start(): void {
    this.playing = true;
    this.sync();
  }

  stop(): void {
    this.playing = false;
    this.sync();
  }

  dispose(): void {
    this.playing = false;
    this.halt();
    this.out.disconnect();
  }

  private applyGain(): void {
    const target = this.volume * MUSIC_BASE_GAIN * (this.ducked ? DUCK_FACTOR : 1);
    this.out.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
  }

  /** Run only while wanted and audible, so a zero slider costs no CPU. */
  private sync(): void {
    if (this.playing && this.volume > 0) {
      if (!this.run) this.beginRun();
      this.timer ??= setInterval(() => this.tick(), TICK_MS);
    } else {
      this.halt();
    }
  }

  private halt(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.retire();
  }

  private retire(): void {
    const old = this.run;
    this.run = null;
    if (!old) return;
    const t = this.ctx.currentTime;
    old.bus.gain.cancelScheduledValues(t);
    old.bus.gain.setTargetAtTime(0, t, FADE_S / 3);
    setTimeout(() => old.bus.disconnect(), FADE_S * 1500);
  }

  private beginRun(): void {
    this.retire();
    const bus = this.ctx.createGain();
    bus.gain.value = 0;
    bus.gain.setTargetAtTime(1, this.ctx.currentTime, FADE_S / 3);
    bus.connect(this.out);
    this.run = { theme: this.theme, bus, loopStart: this.ctx.currentTime + 0.05, cursor: 0 };
  }

  private tick(): void {
    const run = this.run;
    if (!run) return;
    const theme = THEMES[run.theme];
    const beat = 60 / theme.bpm;
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD_S;
    for (;;) {
      const ev = theme.events[run.cursor];
      if (!ev) {
        run.cursor = 0;
        run.loopStart += theme.beats * beat;
        continue;
      }
      const when = run.loopStart + ev.beat * beat;
      if (when > horizon) break;
      if (when >= now - 0.05) this.play(run.bus, ev, Math.max(when, now), beat);
      run.cursor++;
    }
  }

  private play(bus: AudioNode, ev: NoteEvent, t: number, beat: number): void {
    const dur = ev.length * beat;
    const hz = midiToHz(ev.midi);
    switch (ev.voice) {
      case 'lead':
        this.mallet(bus, t, hz, dur, 0.2, 4);
        break;
      case 'bell':
        this.mallet(bus, t, hz, dur, 0.14, 2.76);
        break;
      case 'pluck':
        this.osc(bus, 'triangle', t, hz, dur, 0.09);
        break;
      case 'bass':
        this.osc(bus, 'triangle', t, hz, dur, 0.3);
        break;
      case 'stab':
        this.osc(bus, 'square', t, hz, dur, 0.03, 1800);
        break;
      case 'pad':
        this.pad(bus, t, hz, dur);
        break;
      case 'kick':
        this.kick(bus, t);
        break;
      case 'hat':
        this.hat(bus, t, dur);
        break;
    }
  }

  /** Marimba-ish: a sine plus a quiet inharmonic partial, both with a fast decay. */
  private mallet(bus: AudioNode, t: number, hz: number, dur: number, peak: number, partial: number): void {
    this.osc(bus, 'sine', t, hz, dur, peak);
    this.osc(bus, 'sine', t, hz * partial, dur * 0.4, peak * 0.25);
  }

  private osc(
    bus: AudioNode,
    type: OscillatorType,
    t: number,
    hz: number,
    dur: number,
    peak: number,
    lowpass?: number,
  ): void {
    const len = Math.max(dur, 0.05);
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    if (lowpass) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      osc.connect(f).connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(bus);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  private pad(bus: AudioNode, t: number, hz: number, dur: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.connect(bus);
    for (const detune of [-6, 6]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz;
      osc.detune.value = detune;
      osc.connect(g);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }

  private kick(bus: AudioNode, t: number): void {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private hat(bus: AudioNode, t: number, dur: number): void {
    const len = Math.max(dur, 0.04);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g).connect(bus);
    src.start(t);
    src.stop(t + len + 0.02);
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const length = Math.floor(this.ctx.sampleRate * 0.2);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }
}
