/** Layout hooks shared by the HUD: touch-device detection and the compact (phone / small window) layout. */
import { useEffect, useState } from 'react';

/** Primary input is a touch screen. */
export const COARSE_QUERY = '(pointer: coarse)';
/** Phone / tablet / small window. Keep in sync with the `compact` variant in src/index.css. */
export const COMPACT_QUERY = '(pointer: coarse), (max-width: 900px), (max-height: 520px)';
/** Phone-style portrait window (taller than wide). */
export const PORTRAIT_QUERY = '(orientation: portrait)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => globalThis.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** True when the primary input is a touch screen (coarse pointer). */
export function useIsTouchDevice(): boolean {
  return useMediaQuery(COARSE_QUERY);
}

/** True for phones, tablets and small windows: the HUD folds its big panels into drawers. */
export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}

/** True while the window is taller than it is wide. */
export function useIsPortrait(): boolean {
  return useMediaQuery(PORTRAIT_QUERY);
}
