/**
 * What we know about the graphics side of this page load, shown on the error screens so a screenshot from a
 * phone says why drawing failed, plus the "crashed recently, start in safe mode" memory kept in localStorage.
 * Pure data and functions (storage is passed in), so it runs in Node tests.
 */

export interface GraphicsReport {
  /** WebGL contexts this page created successfully (should be exactly 1). */
  contextsCreated: number;
  /** Renderer option sets tried before one worked (or all failed). */
  attempts: number;
  failures: string[];
  gpu: string | null;
  glVersion: string | null;
  maxTexture: number | null;
  /** Frames drawn since the context was created. */
  frames: number;
  /** Milliseconds after page start when the context was lost, or null. */
  lostAtMs: number | null;
  lostBeforeFirstFrame: boolean | null;
  safeMode: boolean;
  pixelRatio: number | null;
  canvas: string | null;
  previousCrash: string | null;
  /** Active ?gpu= test flags. */
  flags: string;
  /** Why safe mode is on, if it is. */
  safeReason: string | null;
  /** True when this page load is the automatic reload after an early context loss. */
  autoReloaded: boolean;
}

export const graphicsReport: GraphicsReport = {
  contextsCreated: 0,
  attempts: 0,
  failures: [],
  gpu: null,
  glVersion: null,
  maxTexture: null,
  frames: 0,
  lostAtMs: null,
  lostBeforeFirstFrame: null,
  safeMode: false,
  pixelRatio: null,
  canvas: null,
  previousCrash: null,
  flags: 'none',
  safeReason: null,
  autoReloaded: false,
};

/** One compact, copy-friendly text block. */
export function formatGraphicsReport(r: GraphicsReport = graphicsReport): string {
  const lines = [
    `GPU: ${r.gpu ?? 'unknown'}`,
    `GL: ${r.glVersion ?? 'none'} · max texture ${r.maxTexture ?? '?'}`,
    `Contexts created: ${r.contextsCreated} · attempts: ${r.attempts}`,
    `Frames drawn: ${r.frames} · safe mode: ${r.safeMode ? `on (${r.safeReason ?? '?'})` : 'off'} · flags: ${r.flags}`,
    `Canvas: ${r.canvas ?? '?'} · pixel ratio ${r.pixelRatio?.toFixed(2) ?? '?'}`,
  ];
  if (r.lostAtMs !== null) {
    lines.push(
      `Context lost at ${(r.lostAtMs / 1000).toFixed(1)}s${r.lostBeforeFirstFrame ? ' (before the first frame)' : ''}`,
    );
  }
  if (r.autoReloaded) lines.push('Reloaded automatically after an early loss');
  if (r.previousCrash) lines.push(`Last time: ${r.previousCrash}`);
  if (r.failures.length > 0) lines.push(`Errors: ${r.failures.join(' | ')}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ crash memory

export const CRASH_KEY = 'disaster-village:gfx-crash:v1';
/** A crash older than this no longer forces safe mode. */
export const SAFE_MODE_WINDOW_MS = 30 * 60 * 1000;
/** Drawing this long without a loss counts as healthy and clears the crash memory. */
export const STABLE_SECONDS = 20;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CrashRecord {
  at: number;
  frames: number;
  count: number;
}

export function readCrash(storage: StorageLike | null): CrashRecord | null {
  try {
    const raw = storage?.getItem(CRASH_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    if (!('at' in v) || !('frames' in v) || !('count' in v)) return null;
    const { at, frames, count } = v;
    if (typeof at !== 'number' || typeof frames !== 'number' || typeof count !== 'number') return null;
    return { at, frames, count };
  } catch {
    return null;
  }
}

export function recordCrash(storage: StorageLike | null, frames: number, now: number): void {
  try {
    const prev = readCrash(storage);
    const next: CrashRecord = { at: now, frames, count: (prev?.count ?? 0) + 1 };
    storage?.setItem(CRASH_KEY, JSON.stringify(next));
  } catch {
    // Storage may be blocked (private mode); safe mode just won't remember.
  }
}

export function clearCrash(storage: StorageLike | null): void {
  try {
    storage?.removeItem(CRASH_KEY);
  } catch {
    // ignore
  }
}

/** `?safe` forces safe mode, `?nosafe` forbids it, otherwise a recent crash turns it on. */
export function shouldUseSafeMode(search: string, storage: StorageLike | null, now: number): boolean {
  const params = new URLSearchParams(search);
  if (params.has('nosafe')) return false;
  if (params.has('safe')) return true;
  const crash = readCrash(storage);
  return crash !== null && now - crash.at < SAFE_MODE_WINDOW_MS;
}

export function describeCrash(c: CrashRecord, now: number): string {
  const mins = Math.max(0, Math.round((now - c.at) / 60000));
  return `graphics were lost ${mins} min ago after ${c.frames} frames (${c.count} time${c.count === 1 ? '' : 's'})`;
}

export function pageStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ automatic reload

export const AUTO_RELOAD_KEY = 'disaster-village:gfx-autoreload:v1';
/** A context lost sooner than this after the page started is treated as a start-up crash. */
export const EARLY_LOSS_MS = 10_000;
/** At most one automatic reload per tab in this window, so a bad phone never loops. */
export const AUTO_RELOAD_COOLDOWN_MS = 2 * 60 * 1000;

/** Whether an early loss should reload the page once into safe mode (`?noreload` turns this off). */
export function shouldAutoReload(
  lostAtMs: number,
  search: string,
  session: StorageLike | null,
  now: number,
): boolean {
  if (lostAtMs >= EARLY_LOSS_MS || new URLSearchParams(search).has('noreload')) return false;
  const last = Number(session?.getItem(AUTO_RELOAD_KEY) ?? 0);
  return !(Number.isFinite(last) && last > 0 && now - last < AUTO_RELOAD_COOLDOWN_MS);
}

export function markAutoReload(session: StorageLike | null, now: number): void {
  try {
    session?.setItem(AUTO_RELOAD_KEY, String(now));
  } catch {
    // ignore
  }
}

/** True when the page was just reloaded by markAutoReload (within the last few seconds). */
export function wasAutoReloaded(session: StorageLike | null, now: number): boolean {
  const last = Number(session?.getItem(AUTO_RELOAD_KEY) ?? 0);
  return Number.isFinite(last) && last > 0 && now - last < 30_000;
}

export function sessionStorageOrNull(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
