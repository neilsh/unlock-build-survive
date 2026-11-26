import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, QUALITY_PROFILES, sanitizeSettings } from './settings';

describe('sanitizeSettings', () => {
  it('returns defaults for junk input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numbers and rejects wrong types per field', () => {
    const s = sanitizeSettings({
      sfxVolume: 5,
      lookSensitivity: -1,
      gamepadDeadzone: 'big',
      invertLook: 'yes',
      quality: 'ultra',
      showHpBars: false,
    });
    expect(s.sfxVolume).toBe(1);
    expect(s.lookSensitivity).toBe(0.25);
    expect(s.gamepadDeadzone).toBe(DEFAULT_SETTINGS.gamepadDeadzone);
    expect(s.invertLook).toBe(false);
    expect(s.quality).toBe('high');
    expect(s.showHpBars).toBe(false);
  });

  it('keeps unpatched fields from the base', () => {
    const base = { ...DEFAULT_SETTINGS, invertLook: true, quality: 'low' as const };
    expect(sanitizeSettings({ sfxVolume: 0.5 }, base)).toEqual({ ...base, sfxVolume: 0.5 });
  });

  it('rejects NaN and Infinity', () => {
    expect(sanitizeSettings({ sfxVolume: NaN }).sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
    expect(sanitizeSettings({ lookSensitivity: Infinity }).lookSensitivity).toBe(
      DEFAULT_SETTINGS.lookSensitivity,
    );
  });
});

describe('QUALITY_PROFILES', () => {
  it('gets cheaper from high to low', () => {
    expect(QUALITY_PROFILES.low.maxPixelRatio).toBeLessThan(QUALITY_PROFILES.high.maxPixelRatio);
    expect(QUALITY_PROFILES.low.shadows).toBe(false);
    expect(QUALITY_PROFILES.high.shadowMapSize).toBeGreaterThan(QUALITY_PROFILES.medium.shadowMapSize - 1);
  });
});
