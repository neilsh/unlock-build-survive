import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types/blueprint';
import type { Villager } from './VillageSim';
import { VillagerAvatars, hpColor, isNearAnyViewer } from './VillagerAvatars';

const villager = (over: Partial<Villager> = {}): Villager => ({
  id: 1,
  x: 0,
  z: 0,
  hp: 100,
  maxHp: 100,
  state: 'idle',
  heading: 0,
  shelter: -1,
  path: [],
  wait: 1,
  ...over,
});

describe('HP bar visibility', () => {
  it('is near when any viewer is within range', () => {
    expect(isNearAnyViewer({ x: 0, z: 0 }, [[3, 0, 4]])).toBe(true);
    expect(isNearAnyViewer({ x: 0, z: 0 }, [[20, 0, 0]])).toBe(false);
    expect(
      isNearAnyViewer({ x: 0, z: 0 }, [
        [20, 0, 0],
        [1, 0, 1],
      ]),
    ).toBe(true);
    expect(isNearAnyViewer({ x: 0, z: 0 }, [])).toBe(false);
  });

  it('colours the bar by health', () => {
    expect(hpColor(1)).not.toBe(hpColor(0.5));
    expect(hpColor(0.5)).not.toBe(hpColor(0.1));
  });
});

const bars = (scene: THREE.Scene) => {
  const out: boolean[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Group && o.position.y === 1.75) out.push(o.visible);
  });
  return out;
};

describe('VillagerAvatars', () => {
  it('shows a villager’s HP bar only when a player is close, and hides the whole village on request', () => {
    const scene = new THREE.Scene();
    const view = new VillagerAvatars(scene);
    view.setVisible(true);
    const far: Vec3[] = [[30, 0, 30]];
    const near: Vec3[] = [[2, 0, 2]];
    view.sync([villager(), villager({ id: 2, x: 12, z: 12, hp: 40 })], far, 0);
    expect(bars(scene)).toEqual([false, false]);
    view.sync([villager(), villager({ id: 2, x: 12, z: 12, hp: 40 })], near, 0);
    expect(bars(scene)).toEqual([true, false]);
    view.setVisible(false);
    expect(scene.children[0]?.visible).toBe(false);
    view.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('keeps the bar for sheltered villagers but hides their body', () => {
    const scene = new THREE.Scene();
    const view = new VillagerAvatars(scene);
    view.sync([villager({ state: 'sheltered' })], [[0, 0, 0]], 0);
    expect(bars(scene)).toEqual([true]);
    view.dispose();
  });
});
