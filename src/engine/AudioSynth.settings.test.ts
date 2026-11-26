import { describe, expect, it } from 'vitest';
import { AudioSynth } from './AudioSynth';

describe('AudioSynth sound effects volume', () => {
  it('accepts any value (clamped) without Web Audio available', () => {
    const audio = new AudioSynth();
    expect(() => {
      audio.setSfxVolume(0.3);
      audio.setSfxVolume(7);
      audio.setSfxVolume(Number.NaN);
      audio.playClack();
    }).not.toThrow();
  });
});
