import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EYE_HEIGHT, FirstPersonController, PLAYER_RADIUS } from './FirstPersonController';

function mockDom() {
  const captured = new Set<number>();
  const dom = Object.assign(new EventTarget(), {
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    hasPointerCapture: (id: number) => captured.has(id),
  }) as unknown as HTMLElement;
  return { dom, captured };
}

describe('FirstPersonController', () => {
  it('spawns in a clear spot facing the village center and syncs the camera', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const fp = new FirstPersonController(cam);
    fp.spawn([[0, 1, 6]]); // blocks default [0, 0, 6.2]
    expect(fp.getFeetPosition()).not.toEqual([0, 0, 6.2]);
    expect(cam.position.y).toBeCloseTo(EYE_HEIGHT);
    fp.dispose();
  });

  it('walks with WASD, jumps with Space, and lands back on the island', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const fp = new FirstPersonController(cam);
    fp.spawn([]);
    fp.setEnabled(true);
    const startZ = fp.pos.z;
    fp.setKey('KeyW', true);
    for (let i = 0; i < 10; i++) fp.update(1 / 60, []);
    expect(fp.pos.z).toBeLessThan(startZ - 0.5);
    expect(cam.position.z).toBeCloseTo(fp.pos.z);

    fp.setKey('KeyW', false);
    fp.setKey('Space', true);
    fp.update(1 / 60, []);
    fp.setKey('Space', false);
    expect(fp.pos.y).toBeGreaterThan(0);
    expect(fp.grounded).toBe(false);

    for (let i = 0; i < 120; i++) fp.update(1 / 60, []);
    expect(fp.pos.y).toBe(0);
    expect(fp.grounded).toBe(true);
    fp.dispose();
  });

  it('collides horizontally with blocks and clamps look pitch', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const fp = new FirstPersonController(cam);
    fp.spawn([]);
    fp.setEnabled(true);
    fp.pos.set(0, 0, 2);
    fp.yaw = 0;
    fp.setKey('KeyW', true);
    for (let i = 0; i < 30; i++) fp.update(1 / 60, [[0, 1, 0]]);
    expect(fp.pos.z).toBeGreaterThanOrEqual(1 + PLAYER_RADIUS - 1e-4);

    fp.lookDelta(0, -10000);
    expect(fp.pitch).toBeLessThan(Math.PI / 2);
    fp.lookDelta(0, 20000);
    expect(fp.pitch).toBeGreaterThan(-Math.PI / 2);
    fp.dispose();
  });

  it('releases pointer capture on setEnabled(false) and dispose()', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const { dom, captured } = mockDom();
    const fp = new FirstPersonController(cam, dom);
    fp.setEnabled(true);
    dom.dispatchEvent(
      Object.assign(new Event('pointerdown'), {
        button: 0,
        isPrimary: true,
        pointerId: 7,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(captured.has(7)).toBe(true);
    fp.setEnabled(false);
    expect(captured.size).toBe(0);

    fp.setEnabled(true);
    dom.dispatchEvent(
      Object.assign(new Event('pointerdown'), {
        button: 0,
        isPrimary: true,
        pointerId: 9,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(captured.has(9)).toBe(true);
    fp.dispose();
    expect(captured.size).toBe(0);
  });

  it('pauses keyboard and pointer input when setInputPaused(true) and resumes cleanly', () => {
    const winTarget = new EventTarget();
    vi.stubGlobal('window', winTarget);
    try {
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
      const { dom, captured } = mockDom();
      const fp = new FirstPersonController(cam, dom);
      fp.spawn([]);
      fp.setEnabled(true);
      fp.setKey('KeyW', true);
      dom.dispatchEvent(
        Object.assign(new Event('pointerdown'), {
          button: 0,
          isPrimary: true,
          pointerId: 4,
          clientX: 20,
          clientY: 20,
        }),
      );
      expect(captured.has(4)).toBe(true);

      fp.setInputPaused(true);
      expect(captured.size).toBe(0);

      const zPaused = fp.pos.z;
      const yawPaused = fp.yaw;
      winTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }));
      dom.dispatchEvent(
        Object.assign(new Event('pointerdown'), {
          button: 0,
          isPrimary: true,
          pointerId: 5,
          clientX: 20,
          clientY: 20,
        }),
      );
      dom.dispatchEvent(
        Object.assign(new Event('pointermove'), { isPrimary: true, pointerId: 5, clientX: 120, clientY: 20 }),
      );
      fp.update(1 / 60, []);
      expect(fp.pos.z).toBe(zPaused);
      expect(fp.yaw).toBe(yawPaused);
      expect(captured.size).toBe(0);

      fp.setInputPaused(false);
      winTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }));
      fp.update(1 / 60, []);
      expect(fp.pos.z).toBeLessThan(zPaused);
      fp.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('supports jumpMultiplier, eye/look vectors, and firing with KeyF', () => {
    const winTarget = new EventTarget();
    vi.stubGlobal('window', winTarget);
    try {
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
      const fp = new FirstPersonController(cam);
      fp.spawn([]);
      fp.setEnabled(true);
      fp.yaw = 0;
      fp.pitch = 0;
      expect(fp.getEyePosition()).toEqual([fp.pos.x, EYE_HEIGHT, fp.pos.z]);
      const dir = fp.getLookDirection();
      expect(dir[0]).toBeCloseTo(0);
      expect(dir[1]).toBeCloseTo(0);
      expect(dir[2]).toBeCloseTo(-1);

      let fired = 0;
      fp.setFireHandler(() => fired++);
      winTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyF', repeat: false }));
      expect(fired).toBe(1);

      fp.setKey('Space', true);
      fp.update(1 / 60, [], 9.81, 1);
      const normalVy = fp.vy;

      fp.pos.y = 0;
      fp.vy = 0;
      fp.grounded = true;
      fp.update(1 / 60, [], 9.81, 1.35);
      expect(fp.vy).toBeGreaterThan(normalVy);
      fp.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('moves proportionally with analog gamepad input, jumps, and rotates with lookAngles', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const fp = new FirstPersonController(cam);
    fp.spawn([]);
    fp.setEnabled(true);
    fp.yaw = 0;
    fp.pitch = 0;

    // Half-tilt forward moves at half speed (and jumps via gamepad A)
    const startZ = fp.pos.z;
    fp.setGamepadInput(0, 0.5, false);
    fp.update(1 / 60, []);
    const halfStep = startZ - fp.pos.z;
    expect(halfStep).toBeGreaterThan(0);

    const midZ = fp.pos.z;
    fp.setGamepadInput(0, 1, true);
    fp.update(1 / 60, []);
    const fullStep = midZ - fp.pos.z;
    expect(fullStep).toBeCloseTo(halfStep * 2);
    expect(fp.grounded).toBe(false);
    expect(fp.vy).toBeGreaterThan(0);

    // lookAngles updates yaw and clamps pitch
    fp.lookAngles(0.5, -100);
    expect(fp.yaw).toBeCloseTo(-0.5);
    expect(fp.pitch).toBeLessThan(Math.PI / 2);
    expect(cam.rotation.y).toBeCloseTo(-0.5);
    fp.dispose();
  });

  it('walks into a ladder column and climbs it with W/S, holds still with no input, and hops off with Space', () => {
    const fp = new FirstPersonController(new THREE.PerspectiveCamera(45, 1, 0.1, 200));
    fp.setEnabled(true);
    const ladder: Array<[number, number, number]> = [
      [0, 1, 0],
      [0, 3, 0],
      [0, 5, 0],
    ];
    fp.pos.set(0, 0, 3);
    fp.yaw = 0; // facing -z, toward the ladder
    fp.setKey('KeyW', true);
    for (let i = 0; i < 30 && !fp.climbing; i++) fp.update(1 / 60, ladder, 9.81, 1, 1, ladder);
    expect(fp.climbing).toBe(true); // not pushed out by the ladder blocks

    const z = fp.pos.z;
    for (let i = 0; i < 60; i++) fp.update(1 / 60, ladder, 9.81, 1, 1, ladder);
    expect(fp.pos.y).toBeGreaterThan(3);
    expect(fp.pos.z).toBeCloseTo(z); // W climbs instead of walking through

    fp.setKey('KeyW', false);
    const held = fp.pos.y;
    for (let i = 0; i < 30; i++) fp.update(1 / 60, ladder, 9.81, 1, 1, ladder);
    expect(fp.pos.y).toBeCloseTo(held); // no gravity slide while holding the ladder

    fp.setKey('KeyS', true);
    for (let i = 0; i < 20; i++) fp.update(1 / 60, ladder, 9.81, 1, 1, ladder);
    expect(fp.pos.y).toBeLessThan(held);

    fp.setKey('KeyS', false);
    fp.setKey('Space', true);
    fp.update(1 / 60, ladder, 9.81, 1, 1, ladder);
    expect(fp.climbing).toBe(false);
    expect(fp.vy).toBeGreaterThan(0);
    fp.dispose();
  });
});
