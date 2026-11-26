import type { GraphicsQuality } from '../types/settings';

/** Pure render-size limits (no WebGL), so phones never get a drawing buffer or shadow map their GPU cannot hold. */

/** Most drawing-buffer pixels we ask for: tight on phones (memory pressure loses the GL context), generous on desktop. */
export const MAX_BUFFER_PIXELS = { touch: 1_400_000, desktop: 8_300_000 } as const;
/** Largest shadow map edge on phones, whatever the quality setting says. */
export const TOUCH_MAX_SHADOW_MAP = 1024;
const MIN_PIXEL_RATIO = 0.75;

/** Device pixel ratio to render at: the lowest of the device, the quality cap and the pixel budget. */
export function effectivePixelRatio(
  devicePixelRatio: number,
  qualityMax: number,
  cssWidth: number,
  cssHeight: number,
  touch: boolean,
): number {
  const w = Math.max(1, cssWidth);
  const h = Math.max(1, cssHeight);
  const budget = touch ? MAX_BUFFER_PIXELS.touch : MAX_BUFFER_PIXELS.desktop;
  const byBudget = Math.sqrt(budget / (w * h));
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(MIN_PIXEL_RATIO, Math.min(dpr, qualityMax, byBudget));
}

export function effectiveShadowMapSize(size: number, touch: boolean): number {
  return touch ? Math.min(size, TOUCH_MAX_SHADOW_MAP) : size;
}

/** One step lighter graphics, used after a lost GL context on a phone. `low` stays `low`. */
export function lowerQuality(q: GraphicsQuality): GraphicsQuality {
  return q === 'high' ? 'medium' : 'low';
}
