import {
  DEFAULT_SETTINGS,
  MOBILE_DEFAULT_SETTINGS,
  sanitizeSettings,
  type AppSettings,
} from '../types/settings';
import type { StorageLike } from './audioSettings';

export const SETTINGS_KEY = 'disaster-village:settings:v1';

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, sandboxed iframe)
  }
}

/** True on touch-screen devices (phones and tablets): the primary pointer is coarse. */
export function isTouchDevice(): boolean {
  try {
    return globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    return false;
  }
}

/** The settings a player gets before they change anything: lighter graphics on touch devices. */
export function deviceDefaultSettings(touch: boolean = isTouchDevice()): AppSettings {
  return { ...(touch ? MOBILE_DEFAULT_SETTINGS : DEFAULT_SETTINGS) };
}

/** Stored settings (repaired), or the device defaults when nothing is saved yet. */
export function loadSettings(
  storage: StorageLike | null = defaultStorage(),
  defaults: AppSettings = deviceDefaultSettings(),
): AppSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaults };
    return sanitizeSettings(JSON.parse(raw), defaults);
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings: AppSettings, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage full or blocked: settings just won't persist
  }
}
