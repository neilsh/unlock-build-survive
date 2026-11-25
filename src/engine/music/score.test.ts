import { describe, expect, it } from 'vitest';
import { THEMES, midiToHz } from './score';

describe('music score', () => {
  it.each(Object.entries(THEMES))('%s theme is a well-formed loop', (_name, theme) => {
    expect(theme.events.length).toBeGreaterThan(0);
    let prev = 0;
    for (const ev of theme.events) {
      expect(ev.beat).toBeGreaterThanOrEqual(prev);
      expect(ev.beat).toBeLessThan(theme.beats);
      expect(ev.length).toBeGreaterThan(0);
      prev = ev.beat;
    }
  });

  it('game theme is livelier than the menu theme', () => {
    expect(THEMES.game.bpm).toBeGreaterThan(THEMES.menu.bpm);
    expect(THEMES.game.events.some((e) => e.voice === 'kick')).toBe(true);
    expect(THEMES.menu.events.some((e) => e.voice === 'kick')).toBe(false);
  });

  it('converts MIDI to Hz', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });
});
