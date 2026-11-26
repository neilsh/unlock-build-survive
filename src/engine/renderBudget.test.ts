import { describe, expect, it } from 'vitest';
import {
  effectivePixelRatio,
  effectiveShadowMapSize,
  MAX_BUFFER_PIXELS,
  TOUCH_MAX_SHADOW_MAP,
} from './renderBudget';

describe('effectivePixelRatio', () => {
  it('follows the quality cap on a small canvas', () => {
    expect(effectivePixelRatio(3, 1.5, 400, 800, true)).toBe(1.5);
    expect(effectivePixelRatio(1, 2, 1280, 800, false)).toBe(1);
  });

  it('shrinks big phone canvases so the buffer stays inside the pixel budget', () => {
    const r = effectivePixelRatio(3, 2, 900, 2000, true);
    expect(r).toBeLessThan(1);
    expect(900 * r * (2000 * r)).toBeLessThanOrEqual(MAX_BUFFER_PIXELS.touch * 1.001);
  });

  it('never goes below a readable minimum and survives bad input', () => {
    expect(effectivePixelRatio(0, 2, 5000, 5000, true)).toBeGreaterThanOrEqual(0.75);
    expect(effectivePixelRatio(Number.NaN, 2, 0, 0, false)).toBeGreaterThan(0);
  });
});

describe('shadow map cap', () => {
  it('caps shadow maps on phones only', () => {
    expect(effectiveShadowMapSize(2048, true)).toBe(TOUCH_MAX_SHADOW_MAP);
    expect(effectiveShadowMapSize(2048, false)).toBe(2048);
    expect(effectiveShadowMapSize(512, true)).toBe(512);
  });
});
