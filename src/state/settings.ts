import { DEFAULT_SETTINGS, sanitizeSettings, type AppSettings } from '../types/settings';
import type { StorageLike } from './audioSettings';

export const SETTINGS_KEY = 'disaster-village:settings:v1';

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, sandboxed iframe)
  }
}

export function loadSettings(storage: StorageLike | null = defaultStorage()): AppSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage full or blocked: settings just won't persist
  }
}
