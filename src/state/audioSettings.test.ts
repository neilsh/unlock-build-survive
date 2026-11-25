import { describe, expect, it } from 'vitest';
import { AUDIO_KEY, DEFAULT_AUDIO_SETTINGS, loadAudioSettings, saveAudioSettings } from './audioSettings';

function fakeStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(AUDIO_KEY, initial);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('audioSettings', () => {
  it('defaults when nothing is stored or storage is unavailable', () => {
    expect(loadAudioSettings(fakeStorage())).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('round-trips mute and volume', () => {
    const storage = fakeStorage();
    saveAudioSettings({ muted: true, musicVolume: 0.25 }, storage);
    expect(loadAudioSettings(storage)).toEqual({ muted: true, musicVolume: 0.25 });
  });

  it('clamps and repairs bad data', () => {
    expect(loadAudioSettings(fakeStorage('{"muted":"yes","musicVolume":9}'))).toEqual({
      muted: false,
      musicVolume: 1,
    });
    expect(loadAudioSettings(fakeStorage('not json'))).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});
