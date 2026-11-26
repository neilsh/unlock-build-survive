import { describe, expect, it } from 'vitest';
import { GamepadManager, type GamepadButtonLike, type GamepadLike } from './GamepadManager';

function makeButtons(overrides: Record<number, Partial<GamepadButtonLike>> = {}): GamepadButtonLike[] {
  return Array.from({ length: 16 }, (_, i) => {
    const o = overrides[i];
    return {
      pressed: o?.pressed ?? false,
      value: o?.value ?? (o?.pressed ? 1 : 0),
    };
  });
}

function makePad(
  axes: number[] = [0, 0, 0, 0],
  buttons: Record<number, Partial<GamepadButtonLike>> = {},
  id = 'Xbox Controller',
): GamepadLike {
  return {
    id,
    connected: true,
    mapping: 'standard',
    axes,
    buttons: makeButtons(buttons),
  };
}

const withIndex = (pad: GamepadLike, index: number): GamepadLike => ({ ...pad, index });

describe('GamepadManager', () => {
  it('filters deadzone values and rescales stick movement linearly', () => {
    let pad: GamepadLike | null = makePad([0.1, -0.15, 0.59, -1]);
    const gm = new GamepadManager(() => [pad]);

    const snap = gm.poll();
    expect(snap.connected).toBe(true);
    expect(snap.id).toBe('Xbox Controller');
    expect(snap.moveX).toBe(0);
    expect(snap.moveY).toBe(0);
    // (0.59 - 0.18) / (1 - 0.18) = 0.41 / 0.82 = 0.5
    expect(snap.lookX).toBeCloseTo(0.5);
    expect(snap.lookY).toBeCloseTo(-1);

    pad = makePad([0, -1, 0, 0]);
    expect(gm.poll().moveY).toBeCloseTo(1);
    gm.dispose();
  });

  it('fires edge-triggered buttons once per press and supports held inputs and D-pad', () => {
    let pad: GamepadLike | null = makePad([0, 0, 0, 0], {
      0: { pressed: true },
      1: { pressed: true },
      3: { pressed: true },
      4: { pressed: true },
      5: { pressed: true },
      7: { pressed: false, value: 0.4 },
      8: { pressed: true },
      9: { pressed: true },
      12: { pressed: true },
      15: { pressed: true },
    });
    const gm = new GamepadManager(() => [pad]);

    const first = gm.poll();
    expect(first.jumpHeld).toBe(true);
    expect(first.fireHeld).toBe(true);
    expect(first.moveX).toBe(1);
    expect(first.moveY).toBe(1);
    expect(first.toggleFirstPerson).toBe(true);
    expect(first.toggleDisaster).toBe(true);
    expect(first.menuPressed).toBe(true);
    expect(first.confirmPressed).toBe(true);
    expect(first.backOrUndo).toBe(true);
    expect(first.prevShoulder).toBe(true);
    expect(first.nextShoulder).toBe(true);

    // Still held next frame -> edge triggers drop to false, held stays true, X button also fires
    pad = makePad([0, 0, 0, 0], {
      0: { pressed: true },
      1: { pressed: true },
      2: { pressed: true },
      3: { pressed: true },
      4: { pressed: true },
      5: { pressed: true },
      7: { pressed: false, value: 0.1 },
      8: { pressed: true },
      9: { pressed: true },
    });
    const second = gm.poll();
    expect(second.jumpHeld).toBe(true);
    expect(second.fireHeld).toBe(true);
    expect(second.toggleFirstPerson).toBe(false);
    expect(second.toggleDisaster).toBe(false);
    expect(second.menuPressed).toBe(false);
    expect(second.confirmPressed).toBe(false);
    expect(second.backOrUndo).toBe(false);
    expect(second.prevShoulder).toBe(false);
    expect(second.nextShoulder).toBe(false);
    gm.dispose();
  });

  it('suppresses outputs while paused without emitting phantom edges on resume', () => {
    let pad: GamepadLike | null = makePad([0.8, 0, 0, 0], { 0: { pressed: true } });
    const gm = new GamepadManager(() => [pad]);
    gm.poll();

    gm.setPaused(true);
    pad = makePad([0.9, -0.9, 0.5, 0.5], { 0: { pressed: true }, 3: { pressed: true } });
    const pausedSnap = gm.poll();
    expect(pausedSnap.connected).toBe(true);
    expect(pausedSnap.moveX).toBe(0);
    expect(pausedSnap.jumpHeld).toBe(false);
    expect(pausedSnap.toggleFirstPerson).toBe(false);

    // Resume while button 3 is still held -> must NOT trigger a phantom edge
    gm.setPaused(false);
    const resumedSnap = gm.poll();
    expect(resumedSnap.toggleFirstPerson).toBe(false);
    expect(resumedSnap.jumpHeld).toBe(true);
    expect(resumedSnap.moveY).toBeGreaterThan(0);
    gm.dispose();
  });

  it('notifies connection listeners when a gamepad connects and disconnects', () => {
    let pad: GamepadLike | null = null;
    const gm = new GamepadManager(() => [pad]);
    const events: Array<[boolean, string | null]> = [];
    gm.onConnectionChange((connected, id) => events.push([connected, id]));

    expect(gm.isConnected()).toBe(false);
    pad = makePad([], {}, 'DualSense');
    gm.poll();
    expect(gm.isConnected()).toBe(true);
    pad = null;
    gm.poll();
    expect(gm.isConnected()).toBe(false);

    expect(events).toEqual([
      [true, 'DualSense'],
      [false, null],
    ]);
    gm.dispose();
  });

  it('switches to an active second controller, ignores resting trigger axes, and falls back on disconnect', () => {
    // Slot 0 has resting axes[4] = -1 (trigger at rest) and idle standard mapping
    const idleVirtual: GamepadLike = {
      id: 'Virtual Idle Pad',
      connected: true,
      index: 0,
      timestamp: 100,
      mapping: 'standard',
      axes: [0, 0, 0, 0, -1, -1],
      buttons: makeButtons(),
    };
    let slot0: GamepadLike | null = idleVirtual;
    let activePad: GamepadLike | null = {
      id: 'Real Controller',
      connected: true,
      index: 1,
      timestamp: 200,
      mapping: 'standard',
      axes: [0, -0.8, 0, 0],
      buttons: makeButtons({ 0: { pressed: true } }),
    };

    const gm = new GamepadManager(() => [slot0, activePad]);

    // Picks slot 1 because it has stick/button activity while slot 0's axes[4] = -1 is ignored
    const activeSnap = gm.poll();
    expect(activeSnap.id).toBe('Real Controller');
    expect(activeSnap.moveY).toBeGreaterThan(0);
    expect(activeSnap.jumpHeld).toBe(true);

    // Even when slot 1 returns to neutral, stays sticky on slot 1
    activePad = {
      id: 'Real Controller',
      connected: true,
      index: 1,
      timestamp: 201,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: makeButtons(),
    };
    const idleSnap = gm.poll();
    expect(idleSnap.id).toBe('Real Controller');
    expect(idleSnap.moveY).toBe(0);

    // When slot 1 disconnects, falls back cleanly to slot 0, and to disconnected if all leave
    activePad = null;
    const fallbackSnap = gm.poll();
    expect(fallbackSnap.connected).toBe(true);
    expect(fallbackSnap.id).toBe('Virtual Idle Pad');

    slot0 = null;
    const goneSnap = gm.poll();
    expect(goneSnap.connected).toBe(false);
    expect(goneSnap.id).toBeNull();
    gm.dispose();
  });

  it('emits edge triggers once per press for primaryPressed (RT), secondaryPressed (LT), and actionXPressed (X)', () => {
    let pad: GamepadLike = makePad([0, 0, 0, 0], {
      2: { pressed: true },
      6: { pressed: false, value: 0.6 },
      7: { pressed: false, value: 0.5 },
    });
    const gm = new GamepadManager(() => [pad]);

    const press1 = gm.poll();
    expect(press1.primaryPressed).toBe(true);
    expect(press1.secondaryPressed).toBe(true);
    expect(press1.actionXPressed).toBe(true);

    // Held on next frame -> edges become false
    const hold = gm.poll();
    expect(hold.primaryPressed).toBe(false);
    expect(hold.secondaryPressed).toBe(false);
    expect(hold.actionXPressed).toBe(false);
    expect(hold.fireHeld).toBe(true);

    // Release below threshold, then press again -> edges fire again
    pad = makePad([0, 0, 0, 0], {
      2: { pressed: false },
      6: { pressed: false, value: 0.1 },
      7: { pressed: false, value: 0.1 },
    });
    const rel = gm.poll();
    expect(rel.fireHeld).toBe(false);

    pad = makePad([0, 0, 0, 0], {
      2: { pressed: true },
      6: { pressed: false, value: 0.8 },
      7: { pressed: false, value: 0.9 },
    });
    const press2 = gm.poll();
    expect(press2.primaryPressed).toBe(true);
    expect(press2.secondaryPressed).toBe(true);
    expect(press2.actionXPressed).toBe(true);
    gm.dispose();
  });

  it('keeps reporting menu navigation edges while paused but blocks gameplay input', () => {
    let pad = makePad([0, 0, 0, 0]);
    const gm = new GamepadManager(() => [pad]);
    gm.setPaused(true);
    pad = makePad([0.9, 0, 0, 0], { 0: { pressed: true }, 9: { pressed: true }, 13: { pressed: true } });
    const snap = gm.poll();
    expect(snap.connected).toBe(true);
    expect(snap.moveX).toBe(0);
    expect(snap.jumpHeld).toBe(false);
    expect(snap.confirmPressed).toBe(true);
    expect(snap.menuPressed).toBe(true);
    expect(snap.navDown).toBe(true);
    expect(snap.navRight).toBe(true);
    const held = gm.poll();
    expect(held.confirmPressed).toBe(false);
    expect(held.navRight).toBe(false);
    gm.dispose();
  });

  it('treats a strong left-stick flick as a single navigation press', () => {
    let pad = makePad([0, -0.9, 0, 0]);
    const gm = new GamepadManager(() => [pad]);
    expect(gm.poll().navUp).toBe(true);
    expect(gm.poll().navUp).toBe(false);
    pad = makePad([0, 0, 0, 0]);
    gm.poll();
    pad = makePad([0, -0.9, 0, 0]);
    expect(gm.poll().navUp).toBe(true);
    gm.dispose();
  });

  describe('pollPair', () => {
    it('reports an empty secondary when only one pad is connected', () => {
      const gm = new GamepadManager(() => [makePad([0.9, 0, 0, 0])]);
      const { primary, secondary } = gm.pollPair();
      expect(primary.connected).toBe(true);
      expect(primary.moveX).toBeGreaterThan(0);
      expect(secondary.connected).toBe(false);
      gm.dispose();
    });

    it('assigns the two lowest slots to primary and secondary independently', () => {
      const pads = [
        withIndex(makePad([0.9, 0, 0, 0], { 0: { pressed: true } }), 0),
        withIndex(makePad([-0.9, 0, 0, 0], { 2: { pressed: true } }), 1),
      ];
      const gm = new GamepadManager(() => pads);
      const { primary, secondary } = gm.pollPair();
      expect(primary.moveX).toBeGreaterThan(0);
      expect(primary.jumpHeld).toBe(true);
      expect(secondary.moveX).toBeLessThan(0);
      expect(secondary.jumpHeld).toBe(false);
      expect(secondary.actionXPressed).toBe(true);
      expect(primary.actionXPressed).toBe(false);
      gm.dispose();
    });

    it('keeps edge state per pad', () => {
      let second = makePad([0, 0, 0, 0]);
      const gm = new GamepadManager(() => [withIndex(makePad(), 0), withIndex(second, 1)]);
      gm.pollPair();
      second = makePad([0, 0, 0, 0], { 7: { pressed: true } });
      expect(gm.pollPair().secondary.primaryPressed).toBe(true);
      expect(gm.pollPair().secondary.primaryPressed).toBe(false);
      gm.dispose();
    });
  });
});
