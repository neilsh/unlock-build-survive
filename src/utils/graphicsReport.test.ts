import { describe, expect, it } from 'vitest';
import {
  clearCrash,
  formatGraphicsReport,
  graphicsReport,
  readCrash,
  recordCrash,
  SAFE_MODE_WINDOW_MS,
  shouldUseSafeMode,
  type StorageLike,
} from './graphicsReport';

function memory(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe('crash memory and safe mode', () => {
  it('is off with no crash, on right after one, off again after the window or when cleared', () => {
    const s = memory();
    expect(shouldUseSafeMode('', s, 1000)).toBe(false);
    recordCrash(s, 0, 1000);
    expect(shouldUseSafeMode('', s, 2000)).toBe(true);
    expect(shouldUseSafeMode('', s, 1000 + SAFE_MODE_WINDOW_MS + 1)).toBe(false);
    clearCrash(s);
    expect(shouldUseSafeMode('', s, 2000)).toBe(false);
  });

  it('counts repeated crashes', () => {
    const s = memory();
    recordCrash(s, 3, 1);
    recordCrash(s, 5, 2);
    expect(readCrash(s)).toEqual({ at: 2, frames: 5, count: 2 });
  });

  it('?safe forces it and ?nosafe forbids it', () => {
    const s = memory();
    expect(shouldUseSafeMode('?safe', s, 1)).toBe(true);
    recordCrash(s, 0, 1);
    expect(shouldUseSafeMode('?nosafe', s, 2)).toBe(false);
  });

  it('ignores corrupt or unavailable storage', () => {
    const s = memory();
    s.setItem('disaster-village:gfx-crash:v1', '{nope');
    expect(readCrash(s)).toBeNull();
    expect(readCrash(null)).toBeNull();
    expect(() => recordCrash(null, 0, 1)).not.toThrow();
  });
});

describe('formatGraphicsReport', () => {
  it('includes the facts a screenshot needs', () => {
    const text = formatGraphicsReport({
      ...graphicsReport,
      gpu: 'Test GPU',
      contextsCreated: 1,
      attempts: 2,
      frames: 0,
      lostAtMs: 1500,
      lostBeforeFirstFrame: true,
      failures: ['Error creating WebGL context.'],
    });
    expect(text).toContain('GPU: Test GPU');
    expect(text).toContain('Contexts created: 1 · attempts: 2');
    expect(text).toContain('before the first frame');
    expect(text).toContain('Error creating WebGL context.');
  });
});
