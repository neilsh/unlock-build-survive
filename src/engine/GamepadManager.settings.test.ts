import { describe, expect, it } from 'vitest';
import { GamepadManager, type GamepadLike } from './GamepadManager';

const pad = (axes: number[]): GamepadLike => ({
  id: 'Xbox Controller',
  connected: true,
  mapping: 'standard',
  axes,
  buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
});

describe('GamepadManager deadzone setting', () => {
  it('ignores stick values inside a larger deadzone and rescales outside it', () => {
    const gm = new GamepadManager(() => [pad([0.3, 0, 0.3, 0])]);
    expect(gm.poll().moveX).toBeGreaterThan(0); // 0.3 > default 0.18
    gm.setDeadzone(0.4);
    const snap = gm.poll();
    expect(snap.moveX).toBe(0);
    expect(snap.lookX).toBe(0);
  });

  it('a small deadzone lets gentle input through', () => {
    const gm = new GamepadManager(() => [pad([0.1, 0, 0, 0])]);
    expect(gm.poll().moveX).toBe(0);
    gm.setDeadzone(0.05);
    expect(gm.poll().moveX).toBeGreaterThan(0);
  });

  it('clamps and ignores invalid values', () => {
    const gm = new GamepadManager(() => [pad([0.5, 0, 0, 0])]);
    gm.setDeadzone(Number.NaN);
    expect(gm.poll().moveX).toBeCloseTo((0.5 - 0.18) / (1 - 0.18));
    gm.setDeadzone(5); // clamped to 0.9
    expect(gm.poll().moveX).toBe(0);
  });
});
