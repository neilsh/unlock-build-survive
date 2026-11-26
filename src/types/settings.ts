/** Player preferences (everything on the Settings screen except mute / music volume, which live in audioSettings). */

export type GraphicsQuality = 'low' | 'medium' | 'high';
export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['low', 'medium', 'high'];

export interface AppSettings {
  /** Sound effects volume, 0..1 (music has its own slider). */
  sfxVolume: number;
  /** Mouse / touch-drag / right-stick look speed multiplier, 1 = default. */
  lookSensitivity: number;
  /** Flips up/down look. */
  invertLook: boolean;
  /** Gamepad stick deadzone, 0..1. */
  gamepadDeadzone: number;
  quality: GraphicsQuality;
  /** Shows the health bars in the HUD (the damage flash stays). */
  showHpBars: boolean;
  /** Shows the controls tip line in the HUD. */
  showHints: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sfxVolume: 1,
  lookSensitivity: 1,
  invertLook: false,
  gamepadDeadzone: 0.18,
  quality: 'high',
  showHpBars: true,
  showHints: true,
};

export const LOOK_SENSITIVITY_RANGE = { min: 0.25, max: 2.5 } as const;
export const GAMEPAD_DEADZONE_RANGE = { min: 0.05, max: 0.4 } as const;

/** Per-quality renderer settings (pure data so it can be unit tested without WebGL). */
export interface QualityProfile {
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
}

export const QUALITY_PROFILES: Readonly<Record<GraphicsQuality, QualityProfile>> = {
  low: { maxPixelRatio: 1, shadows: false, shadowMapSize: 1024 },
  medium: { maxPixelRatio: 1.5, shadows: true, shadowMapSize: 1024 },
  high: { maxPixelRatio: 2, shadows: true, shadowMapSize: 2048 },
};

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Repairs arbitrary (stored or patched) data into valid settings; unknown fields are dropped. */
export function sanitizeSettings(raw: unknown, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const data: Record<string, unknown> = typeof raw === 'object' && raw !== null ? { ...raw } : {};
  const quality = GRAPHICS_QUALITIES.find((q) => q === data.quality) ?? base.quality;
  return {
    sfxVolume: clampNum(data.sfxVolume, 0, 1, base.sfxVolume),
    lookSensitivity: clampNum(
      data.lookSensitivity,
      LOOK_SENSITIVITY_RANGE.min,
      LOOK_SENSITIVITY_RANGE.max,
      base.lookSensitivity,
    ),
    invertLook: bool(data.invertLook, base.invertLook),
    gamepadDeadzone: clampNum(
      data.gamepadDeadzone,
      GAMEPAD_DEADZONE_RANGE.min,
      GAMEPAD_DEADZONE_RANGE.max,
      base.gamepadDeadzone,
    ),
    quality,
    showHpBars: bool(data.showHpBars, base.showHpBars),
    showHints: bool(data.showHints, base.showHints),
  };
}
