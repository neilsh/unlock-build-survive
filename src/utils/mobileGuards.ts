const prevent = (e: Event) => e.preventDefault();

/** Keep the normal menu for text fields; kill the long-press menu everywhere else. */
const onContextMenu = (e: Event) => {
  const t = e.target;
  if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  e.preventDefault();
};

/**
 * Browser gestures that fight a touch game: iOS pinch-zoom (it ignores `user-scalable=no`) and the
 * long-press context menu on the 3D view. Returns a cleanup function; a no-op outside a browser.
 */
export function installMobileGuards(): () => void {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('gesturestart', prevent);
  document.addEventListener('gesturechange', prevent);
  document.addEventListener('gestureend', prevent);
  document.addEventListener('contextmenu', onContextMenu);
  return () => {
    document.removeEventListener('gesturestart', prevent);
    document.removeEventListener('gesturechange', prevent);
    document.removeEventListener('gestureend', prevent);
    document.removeEventListener('contextmenu', onContextMenu);
  };
}
