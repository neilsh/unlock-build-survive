import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CompanionManager } from './CompanionManager';

describe('CompanionManager', () => {
  it('toggles avatar visibility across solo, battle, coop, and bot modes', () => {
    const scene = new THREE.Scene();
    const mgr = new CompanionManager(scene);
    expect(mgr.group.visible).toBe(false);

    mgr.setMode('coop');
    expect(mgr.group.visible).toBe(true);

    mgr.setMode('battle');
    expect(mgr.group.visible).toBe(false);

    mgr.setMode('bot');
    expect(mgr.group.visible).toBe(true);

    mgr.setMode('solo');
    expect(mgr.group.visible).toBe(false);

    mgr.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('patrols and shoots nearby projectiles in AI bot mode during disasters', () => {
    const scene = new THREE.Scene();
    const mgr = new CompanionManager(scene);
    mgr.setMode('bot');
    const startX = mgr.pos.x;
    const onFire = vi.fn<(muzzle: [number, number, number], dir: [number, number, number]) => void>();

    mgr.update(
      0.05,
      'bot',
      true,
      [[4.5, 4.0, 2.0]],
      { moveX: 0, moveY: 0, jump: false, fire: false },
      onFire,
    );

    expect(mgr.pos.x).not.toBe(startX);
    expect(onFire).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it('moves, jumps, and fires on Player 2 input in 2P co-op mode', () => {
    const scene = new THREE.Scene();
    const mgr = new CompanionManager(scene);
    mgr.setMode('coop');
    const startX = mgr.pos.x;
    const onFire = vi.fn<(muzzle: [number, number, number], dir: [number, number, number]) => void>();

    mgr.update(0.05, 'coop', false, [], { moveX: 1, moveY: 0, jump: true, fire: true }, onFire);

    expect(mgr.pos.x).toBeGreaterThan(startX);
    expect(mgr.pos.y).toBeGreaterThan(0);
    expect(onFire).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it('shows the avatar in split-screen and moves relative to the P2 camera heading', () => {
    const scene = new THREE.Scene();
    const mgr = new CompanionManager(scene);
    mgr.setMode('split');
    expect(mgr.group.visible).toBe(true);

    // Heading 0 looks down -z, so "forward" (moveY +1) must decrease z and leave x alone.
    mgr.camYaw = 0;
    const start = mgr.pos.clone();
    mgr.update(0.05, 'split', false, [], { moveX: 0, moveY: 1, jump: false, fire: false }, vi.fn());
    expect(mgr.pos.z).toBeLessThan(start.z);
    expect(mgr.pos.x).toBeCloseTo(start.x);

    // Heading +90deg looks down -x, so forward now decreases x.
    mgr.camYaw = Math.PI / 2;
    const mid = mgr.pos.clone();
    mgr.update(0.05, 'split', false, [], { moveX: 0, moveY: 1, jump: false, fire: false }, vi.fn());
    expect(mgr.pos.x).toBeLessThan(mid.x);
    expect(mgr.pos.z).toBeCloseTo(mid.z);
    mgr.dispose();
  });

  it('turns the P2 camera with lookX and keeps the chase camera behind the avatar', () => {
    const scene = new THREE.Scene();
    const mgr = new CompanionManager(scene);
    mgr.setMode('split');
    const before = mgr.camYaw;
    mgr.update(0.05, 'split', false, [], { moveX: 0, moveY: 0, jump: false, fire: false }, vi.fn(), 1);
    expect(mgr.camYaw).toBeLessThan(before);

    mgr.camYaw = 0;
    const { eye, target } = mgr.getChaseCamera();
    expect(eye[2]).toBeGreaterThan(mgr.pos.z); // behind: +z when facing -z
    expect(eye[1]).toBeGreaterThan(mgr.pos.y);
    expect(target[2]).toBeLessThan(mgr.pos.z);
    mgr.dispose();
  });
});
