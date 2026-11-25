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
});
