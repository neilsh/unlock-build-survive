/**
 * Browser Gamepad API polling and connection tracking for First-Person and Orbit/Build modes.
 * Headless-safe: accepts an injectable `getGamepads` provider so Vitest can test without a browser.
 */

export interface GamepadButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}

export interface GamepadLike {
  readonly id: string;
  readonly connected: boolean;
  readonly index?: number;
  readonly timestamp?: number;
  readonly mapping?: string;
  readonly axes: readonly number[];
  readonly buttons: readonly GamepadButtonLike[];
}

export interface GamepadSnapshot {
  connected: boolean;
  id: string | null;
  /** Left/right movement (-1..1, +1 = right) from left stick or D-pad. */
  moveX: number;
  /** Forward/back movement (-1..1, +1 = forward) from inverted left stick Y or D-pad. */
  moveY: number;
  /** Right stick horizontal look (-1..1, +1 = right). */
  lookX: number;
  /** Right stick vertical look (-1..1, +1 = down). */
  lookY: number;
  /** Held: A (button 0). */
  jumpHeld: boolean;
  /** Held: RT (button 7 > 0.35) or X (button 2). */
  fireHeld: boolean;
  /** Edge-triggered: RT (button 7 > 0.35). */
  primaryPressed: boolean;
  /** Edge-triggered: LT (button 6 > 0.35). */
  secondaryPressed: boolean;
  /** Edge-triggered: X (button 2). */
  actionXPressed: boolean;
  /** Edge-triggered: Y (button 3). */
  toggleFirstPerson: boolean;
  /** Edge-triggered: Back/Select (button 8). Starts or rewinds a disaster test. */
  toggleDisaster: boolean;
  /** Edge-triggered: Start (button 9). Opens or closes the pause menu. */
  menuPressed: boolean;
  /** Edge-triggered: A (button 0). Activates the focused menu item. */
  confirmPressed: boolean;
  /** Edge-triggered menu navigation: D-pad or left stick (also reported while the game is paused). */
  navUp: boolean;
  navDown: boolean;
  navLeft: boolean;
  navRight: boolean;
  /** Edge-triggered: B (button 1). */
  backOrUndo: boolean;
  /** Edge-triggered: LB (button 4). */
  prevShoulder: boolean;
  /** Edge-triggered: RB (button 5). */
  nextShoulder: boolean;
}

const DEADZONE = 0.18;
const TRIGGER_THRESHOLD = 0.35;
const EDGE_BUTTONS = [0, 1, 2, 3, 4, 5, 8, 9, 12, 13, 14, 15] as const;
/** Virtual "buttons" for left-stick menu navigation (edge-tracked alongside real buttons). */
const STICK_NAV_THRESHOLD = 0.6;
const STICK_UP = 100;
const STICK_DOWN = 101;
const STICK_LEFT = 102;
const STICK_RIGHT = 103;
const STICK_NAV_KEYS = [STICK_UP, STICK_DOWN, STICK_LEFT, STICK_RIGHT] as const;
const TRIGGER_BUTTONS = [6, 7] as const;

const EMPTY_SNAPSHOT: GamepadSnapshot = {
  connected: false,
  id: null,
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
  jumpHeld: false,
  fireHeld: false,
  primaryPressed: false,
  secondaryPressed: false,
  actionXPressed: false,
  toggleFirstPerson: false,
  toggleDisaster: false,
  menuPressed: false,
  confirmPressed: false,
  navUp: false,
  navDown: false,
  navLeft: false,
  navRight: false,
  backOrUndo: false,
  prevShoulder: false,
  nextShoulder: false,
};

function defaultGetGamepads(): ArrayLike<GamepadLike | null> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return [];
    }
    return navigator.getGamepads() ?? [];
  } catch {
    return [];
  }
}

function applyDeadzone(raw: number, dz = DEADZONE): number {
  if (!Number.isFinite(raw)) return 0;
  const clamped = Math.max(-1, Math.min(1, raw));
  const mag = Math.abs(clamped);
  if (mag <= dz) return 0;
  return Math.sign(clamped) * ((mag - dz) / (1 - dz));
}

function isPressed(pad: GamepadLike, index: number): boolean {
  const b = pad.buttons[index];
  return b !== undefined && (b.pressed || b.value > 0.5);
}

function isTriggerHeld(pad: GamepadLike, index: number): boolean {
  const b = pad.buttons[index];
  return b !== undefined && (b.value > TRIGGER_THRESHOLD || b.pressed);
}

function padHasActivity(pad: GamepadLike): boolean {
  for (let i = 0; i < pad.buttons.length; i++) {
    const b = pad.buttons[i];
    if (b && (b.pressed || b.value > TRIGGER_THRESHOLD)) return true;
  }
  const stickCount = Math.min(4, pad.axes.length);
  for (let i = 0; i < stickCount; i++) {
    const v = pad.axes[i];
    if (v !== undefined && Number.isFinite(v) && Math.abs(v) > DEADZONE) return true;
  }
  return false;
}

interface PadEntry {
  slot: number;
  pad: GamepadLike;
}

function pickBestPad(candidates: readonly PadEntry[]): PadEntry | null {
  let best = candidates[0];
  if (!best) return null;
  for (let i = 1; i < candidates.length; i++) {
    const cur = candidates[i];
    if (!cur) continue;
    const curTs = cur.pad.timestamp ?? 0;
    const bestTs = best.pad.timestamp ?? 0;
    if (curTs !== bestTs) {
      if (curTs > bestTs) best = cur;
      continue;
    }
    const curStd = cur.pad.mapping === 'standard' ? 1 : 0;
    const bestStd = best.pad.mapping === 'standard' ? 1 : 0;
    if (curStd !== bestStd) {
      if (curStd > bestStd) best = cur;
      continue;
    }
    if (cur.slot < best.slot) best = cur;
  }
  return best;
}

export interface GamepadInfo {
  id: string;
  slot: number;
  /** `standard` = W3C layout this game expects; anything else (usually '') means buttons may be mis-numbered. */
  mapping: string;
  buttonCount: number;
  axisCount: number;
}

/** Everything the browser currently exposes, for on-screen / console diagnostics. */
export interface GamepadDiagnostics {
  /** Pads the browser lists (null slots dropped), whether or not the game picked them. */
  pads: Array<GamepadInfo & { connected: boolean }>;
  active: GamepadInfo | null;
}

function infoOf(entry: PadEntry): GamepadInfo {
  return {
    id: entry.pad.id,
    slot: entry.slot,
    mapping: entry.pad.mapping ?? '',
    buttonCount: entry.pad.buttons.length,
    axisCount: entry.pad.axes.length,
  };
}

export class GamepadManager {
  private readonly getGamepads: () => ArrayLike<GamepadLike | null>;
  private readonly listeners = new Set<(connected: boolean, id: string | null) => void>();
  private readonly prevButtonsByPad = new Map<number, Map<number, boolean>>();
  private readonly cleanups: Array<() => void> = [];
  private activePadIndex: number | null = null;
  private connected = false;
  private padId: string | null = null;
  private padInfo: GamepadInfo | null = null;
  private paused = false;
  private deadzone = DEADZONE;

  /** Stick deadzone (0..0.9) applied to movement and look; the default is 0.18. */
  setDeadzone(deadzone: number): void {
    this.deadzone = Number.isFinite(deadzone) ? Math.min(0.9, Math.max(0, deadzone)) : DEADZONE;
  }

  constructor(getGamepads: () => ArrayLike<GamepadLike | null> = defaultGetGamepads) {
    this.getGamepads = getGamepads;

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const onConnected = (e: Event) => {
        console.warn('[gamepad] gamepadconnected event', this.describeEvent(e));
        if (
          'gamepad' in e &&
          typeof e.gamepad === 'object' &&
          e.gamepad !== null &&
          'index' in e.gamepad &&
          typeof e.gamepad.index === 'number'
        ) {
          this.activePadIndex = e.gamepad.index;
        }
        this.syncConnection();
      };
      const onChange = () => this.syncConnection();
      window.addEventListener('gamepadconnected', onConnected);
      window.addEventListener('gamepaddisconnected', onChange);
      window.addEventListener('focus', onChange);
      this.cleanups.push(
        () => window.removeEventListener('gamepadconnected', onConnected),
        () => window.removeEventListener('gamepaddisconnected', onChange),
        () => window.removeEventListener('focus', onChange),
      );
    }

    this.syncConnection();
  }

  onConnectionChange(cb: (connected: boolean, id: string | null) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Details of the pad currently driving the game (null when none is detected). */
  getActiveInfo(): GamepadInfo | null {
    return this.padInfo;
  }

  /** Raw view of what the browser exposes right now (does not affect edge tracking). */
  getDiagnostics(): GamepadDiagnostics {
    const pads: GamepadDiagnostics['pads'] = [];
    const list = this.getGamepads();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      pads.push({ ...infoOf({ slot: p.index ?? i, pad: p }), connected: p.connected });
    }
    return { pads, active: this.padInfo };
  }

  private describeEvent(e: Event): string {
    const g = (e as Event & { gamepad?: GamepadLike }).gamepad;
    return g ? `${g.id} (index ${g.index ?? '?'}, mapping "${g.mapping ?? ''}")` : 'no gamepad payload';
  }

  /** Connected pads in slot order; also forgets button history of pads that went away. */
  private connectedEntries(): PadEntry[] {
    const pads = this.getGamepads();
    const entries: PadEntry[] = [];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      entries.push({ slot: p.index ?? i, pad: p });
    }
    entries.sort((a, b) => a.slot - b.slot);

    const connectedSlots = new Set(entries.map((e) => e.slot));
    for (const slot of this.prevButtonsByPad.keys()) {
      if (!connectedSlots.has(slot)) this.prevButtonsByPad.delete(slot);
    }
    return entries;
  }

  private findActivePad(): PadEntry | null {
    const entries = this.connectedEntries();

    if (entries.length === 0) {
      this.activePadIndex = null;
      return null;
    }

    const activeEntries = entries.filter((e) => padHasActivity(e.pad));
    if (activeEntries.length > 0) {
      const chosen = pickBestPad(activeEntries);
      if (chosen) {
        this.activePadIndex = chosen.slot;
        return chosen;
      }
    }

    if (this.activePadIndex !== null) {
      const existing = entries.find((e) => e.slot === this.activePadIndex);
      if (existing) return existing;
    }

    const chosen = pickBestPad(entries);
    this.activePadIndex = chosen ? chosen.slot : null;
    return chosen;
  }

  private syncConnection(): PadEntry | null {
    const entry = this.findActivePad();
    const nextConnected = entry !== null;
    const nextId = entry?.pad.id ?? null;
    if (nextConnected !== this.connected || nextId !== this.padId) {
      this.connected = nextConnected;
      this.padId = nextId;
      this.padInfo = entry ? infoOf(entry) : null;
      if (entry && this.padInfo && this.padInfo.mapping !== 'standard') {
        console.warn(
          '[gamepad] non-standard mapping; buttons may not match the expected layout',
          this.padInfo,
        );
      } else if (entry) {
        console.warn('[gamepad] using pad', this.padInfo);
      }
      if (!nextConnected) this.prevButtonsByPad.clear();
      this.listeners.forEach((cb) => cb(nextConnected, nextId));
    }
    return entry;
  }

  poll(): GamepadSnapshot {
    const entry = this.syncConnection();
    if (!entry) return { ...EMPTY_SNAPSHOT };
    return this.snapshotFor(entry);
  }

  /**
   * Two-player polling. With two or more pads connected, the two lowest slots are `primary` (Player 1)
   * and `secondary` (Player 2). With one pad, it is `primary` (the most recently active pad) and
   * `secondary` is an empty, disconnected snapshot. Call this or `poll()` once per frame, not both.
   */
  pollPair(): { primary: GamepadSnapshot; secondary: GamepadSnapshot } {
    const entries = this.connectedEntries();
    const [first, second] = entries;
    if (!first || !second) return { primary: this.poll(), secondary: { ...EMPTY_SNAPSHOT } };
    this.syncConnection();
    return { primary: this.snapshotFor(first), secondary: this.snapshotFor(second) };
  }

  private snapshotFor(entry: PadEntry): GamepadSnapshot {
    const { slot, pad } = entry;
    let prevButtons = this.prevButtonsByPad.get(slot);
    if (!prevButtons) {
      prevButtons = new Map<number, boolean>();
      this.prevButtonsByPad.set(slot, prevButtons);
    }

    const edges = new Map<number, boolean>();
    for (const idx of EDGE_BUTTONS) {
      const down = isPressed(pad, idx);
      const wasDown = prevButtons.get(idx) ?? false;
      prevButtons.set(idx, down);
      edges.set(idx, down && !wasDown);
    }
    for (const idx of TRIGGER_BUTTONS) {
      const down = isTriggerHeld(pad, idx);
      const wasDown = prevButtons.get(idx) ?? false;
      prevButtons.set(idx, down);
      edges.set(idx, down && !wasDown);
    }
    const rawX = pad.axes[0] ?? 0;
    const rawY = pad.axes[1] ?? 0;
    const stickDown: Record<number, boolean> = {
      [STICK_UP]: rawY < -STICK_NAV_THRESHOLD,
      [STICK_DOWN]: rawY > STICK_NAV_THRESHOLD,
      [STICK_LEFT]: rawX < -STICK_NAV_THRESHOLD,
      [STICK_RIGHT]: rawX > STICK_NAV_THRESHOLD,
    };
    for (const idx of STICK_NAV_KEYS) {
      const down = stickDown[idx] ?? false;
      const wasDown = prevButtons.get(idx) ?? false;
      prevButtons.set(idx, down);
      edges.set(idx, down && !wasDown);
    }
    const e = (idx: number) => edges.get(idx) ?? false;
    const menuFields = {
      menuPressed: e(9),
      confirmPressed: e(0),
      backOrUndo: e(1),
      navUp: e(12) || e(STICK_UP),
      navDown: e(13) || e(STICK_DOWN),
      navLeft: e(14) || e(STICK_LEFT),
      navRight: e(15) || e(STICK_RIGHT),
    };

    if (this.paused) {
      return {
        ...EMPTY_SNAPSHOT,
        ...menuFields,
        connected: true,
        id: pad.id,
      };
    }

    const stickX = applyDeadzone(pad.axes[0] ?? 0, this.deadzone);
    const stickY = applyDeadzone(-(pad.axes[1] ?? 0), this.deadzone);
    const dpadX = (isPressed(pad, 15) ? 1 : 0) - (isPressed(pad, 14) ? 1 : 0);
    const dpadY = (isPressed(pad, 12) ? 1 : 0) - (isPressed(pad, 13) ? 1 : 0);

    const rtHeld = isTriggerHeld(pad, 7);

    return {
      connected: true,
      id: pad.id,
      moveX: stickX !== 0 ? stickX : dpadX,
      moveY: stickY !== 0 ? stickY : dpadY,
      lookX: applyDeadzone(pad.axes[2] ?? 0, this.deadzone),
      lookY: applyDeadzone(pad.axes[3] ?? 0, this.deadzone),
      jumpHeld: isPressed(pad, 0),
      fireHeld: rtHeld || isPressed(pad, 2),
      primaryPressed: edges.get(7) ?? false,
      secondaryPressed: edges.get(6) ?? false,
      actionXPressed: edges.get(2) ?? false,
      toggleFirstPerson: edges.get(3) ?? false,
      toggleDisaster: e(8),
      ...menuFields,
      prevShoulder: edges.get(4) ?? false,
      nextShoulder: edges.get(5) ?? false,
    };
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
    this.listeners.clear();
    this.prevButtonsByPad.clear();
  }
}
