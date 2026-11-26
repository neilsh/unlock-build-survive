/**
 * Gamepad-driven focus navigation for the DOM menus and modals (D-pad / stick moves focus between
 * buttons, A clicks). Touches only the DOM — never React — and the neighbour search is pure so it can be
 * unit tested with fake rectangles.
 */

export type NavDir = 'up' | 'down' | 'left' | 'right';

export interface NavRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Picks the best focus target from `from` in direction `dir`, or -1 when nothing lies that way.
 * Candidates must be mostly in the requested direction; being off-axis costs twice as much as distance.
 */
export function pickNeighbor(rects: readonly NavRect[], from: number, dir: NavDir): number {
  const a = rects[from];
  if (!a) return -1;
  const ax = (a.left + a.right) / 2;
  const ay = (a.top + a.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const b = rects[i];
    if (i === from || !b) continue;
    const dx = (b.left + b.right) / 2 - ax;
    const dy = (b.top + b.bottom) / 2 - ay;
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 1 || across > along * 3 + 40) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Index of the top-left-most candidate (used when nothing in the menu has focus yet), or -1. */
export function pickFirst(rects: readonly NavRect[]): number {
  let best = -1;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const b = rects[best];
    if (!r) continue;
    if (!b || r.top < b.top - 4 || (Math.abs(r.top - b.top) <= 4 && r.left < b.left)) best = i;
  }
  return best;
}

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const FOCUS_ATTR = 'data-gamepad-focus';

/** The topmost dialog, else the main menu while it is open; null when no menu is capturing input. */
function findRoot(doc: Document): HTMLElement | null {
  const dialogs = doc.querySelectorAll<HTMLElement>('[role="alertdialog"], [role="dialog"]');
  const topDialog = dialogs[dialogs.length - 1];
  if (topDialog) return topDialog;
  return doc.querySelector<HTMLElement>('[data-testid="main-menu"]');
}

function candidatesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute('disabled') || el.tabIndex < 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

function setFocus(el: HTMLElement, doc: Document): void {
  for (const old of doc.querySelectorAll(`[${FOCUS_ATTR}]`)) old.removeAttribute(FOCUS_ATTR);
  el.setAttribute(FOCUS_ATTR, '');
  el.focus();
  el.scrollIntoView?.({ block: 'nearest' });
}

export class MenuNavigator {
  constructor(private readonly doc: Document | null = typeof document === 'undefined' ? null : document) {}

  private current(): { root: HTMLElement; items: HTMLElement[]; index: number } | null {
    const doc = this.doc;
    if (!doc) return null;
    const root = findRoot(doc);
    if (!root) return null;
    const items = candidatesIn(root);
    const index = doc.activeElement instanceof HTMLElement ? items.indexOf(doc.activeElement) : -1;
    return { root, items, index };
  }

  /** Moves focus one step; focuses the first item when nothing in the menu is focused yet. */
  move(dir: NavDir): void {
    const cur = this.current();
    if (!cur || !this.doc) return;
    const { items, index } = cur;
    const rects = items.map((el) => el.getBoundingClientRect());
    if (index < 0) {
      const first = items[pickFirst(rects)];
      if (first) setFocus(first, this.doc);
      return;
    }
    const active = items[index];
    if (
      active instanceof HTMLInputElement &&
      active.type === 'range' &&
      (dir === 'left' || dir === 'right')
    ) {
      this.stepRange(active, dir === 'right' ? 1 : -1);
      return;
    }
    const next = items[pickNeighbor(rects, index, dir)];
    if (next) setFocus(next, this.doc);
  }

  /** Clicks the focused item (or focuses the first one when nothing is focused yet). */
  confirm(): void {
    const cur = this.current();
    if (!cur || !this.doc) return;
    const active = cur.items[cur.index];
    if (active) {
      active.click();
      return;
    }
    const first = cur.items[pickFirst(cur.items.map((el) => el.getBoundingClientRect()))];
    if (first) setFocus(first, this.doc);
  }

  /** Backs out of the topmost menu layer: dismisses a confirm prompt, else acts as Escape (HUD/Modal handle it). */
  cancel(): void {
    // A confirm prompt (alertdialog) has no Escape handling: its first button is the safe "keep going" one.
    const prompt = this.doc?.querySelector<HTMLElement>('[role="alertdialog"] button');
    if (prompt) {
      prompt.click();
      return;
    }
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  private stepRange(input: HTMLInputElement, dir: 1 | -1): void {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const step = Number(input.step) > 0 ? Number(input.step) : (max - min) / 20;
    const next = Math.max(min, Math.min(max, Number(input.value) + dir * step));
    // oxlint-disable-next-line typescript/unbound-method -- invoked with the input as `this` below
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
