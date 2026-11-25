/** Persisted sound settings (mute and music volume), stored in localStorage. */
export interface AudioSettings {
  muted: boolean;
  /** 0..1 */
  musicVolume: number;
}

export const AUDIO_KEY = 'disaster-village:audio:v1';
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { muted: false, musicVolume: 0.6 };

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, sandboxed iframe)
  }
}

export function loadAudioSettings(storage: StorageLike | null = defaultStorage()): AudioSettings {
  try {
    const raw = storage?.getItem(AUDIO_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return { ...DEFAULT_AUDIO_SETTINGS };
    const muted = 'muted' in data ? data.muted : undefined;
    const vol = 'musicVolume' in data ? data.musicVolume : undefined;
    return {
      muted: typeof muted === 'boolean' ? muted : DEFAULT_AUDIO_SETTINGS.muted,
      musicVolume:
        typeof vol === 'number' && Number.isFinite(vol)
          ? Math.min(1, Math.max(0, vol))
          : DEFAULT_AUDIO_SETTINGS.musicVolume,
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(
  settings: AudioSettings,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(AUDIO_KEY, JSON.stringify(settings));
  } catch {
    // storage full or blocked: settings just won't persist
  }
}
