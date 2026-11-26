import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MOBILE_DEFAULT_SETTINGS } from '../types/settings';
import { SETTINGS_KEY, deviceDefaultSettings, loadSettings, saveSettings } from './settings';

function fakeStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(SETTINGS_KEY, initial);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('settings persistence', () => {
  it('defaults when nothing is stored or storage is unavailable', () => {
    expect(loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('starts touch devices on lighter graphics, but never overrides a saved choice', () => {
    expect(MOBILE_DEFAULT_SETTINGS.quality).not.toBe('high');
    expect(deviceDefaultSettings(true)).toEqual(MOBILE_DEFAULT_SETTINGS);
    expect(deviceDefaultSettings(false)).toEqual(DEFAULT_SETTINGS);
    const mobile = deviceDefaultSettings(true);
    expect(loadSettings(fakeStorage(), mobile)).toEqual(mobile);
    expect(loadSettings(fakeStorage('{"quality":"high"}'), mobile).quality).toBe('high');
    expect(loadSettings(fakeStorage('{"invertLook":true}'), mobile).quality).toBe(mobile.quality);
  });

  it('round-trips', () => {
    const storage = fakeStorage();
    const custom = { ...DEFAULT_SETTINGS, invertLook: true, quality: 'low' as const, lookSensitivity: 1.5 };
    saveSettings(custom, storage);
    expect(loadSettings(storage)).toEqual(custom);
  });

  it('repairs corrupt data', () => {
    expect(loadSettings(fakeStorage('not json'))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeStorage('{"lookSensitivity":99}')).lookSensitivity).toBe(2.5);
  });

  it('survives storage that throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadSettings(bad)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, bad)).not.toThrow();
  });
});
