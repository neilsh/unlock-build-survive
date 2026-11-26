import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BlockData, Vec3 } from '../types/blueprint';
import { blockId, cellToWorld } from '../types/blueprint';
import { HelperAnimals, MAX_HELPER_ANIMALS } from './HelperAnimals';

const block = (cell: Vec3, material: string): BlockData => ({ id: blockId(cell), cell, material });

/** update() clamps each step to 0.05 s (like a frame), so run it in frame-sized slices. */
function tick(animals: HelperAnimals, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.05) animals.update(0.05, null);
}

function setup() {
  const scene = new THREE.Scene();
  const animals = new HelperAnimals(scene);
  return { scene, animals };
}

describe('HelperAnimals (headless)', () => {
  it('spawns one critter per helper block and ignores ordinary blocks', () => {
    const { scene, animals } = setup();
    animals.sync([
      block([0, 0, 0], 'wood'),
      block([1, 0, 0], 'beaver'),
      block([2, 0, 0], 'owl'),
      block([3, 0, 0], 'spider'),
      block([4, 0, 0], 'laser'),
      block([5, 0, 0], 'mod:custom'),
    ]);
    expect(animals.count).toBe(3);
    const root = scene.getObjectByName('helper-animals');
    expect(root?.children.map((c) => c.name).toSorted()).toEqual([
      'helper-beaver',
      'helper-owl',
      'helper-spider',
    ]);
    expect(animals.has(blockId([1, 0, 0]))).toBe(true);
    expect(animals.has(blockId([0, 0, 0]))).toBe(false);
  });

  it('removes critters when their block goes away or changes material, without duplicating', () => {
    const { scene, animals } = setup();
    const owl = block([1, 0, 0], 'owl');
    animals.sync([owl]);
    animals.sync([owl]);
    expect(animals.count).toBe(1);
    animals.sync([block([1, 0, 0], 'spider')]);
    expect(animals.count).toBe(1);
    expect(scene.getObjectByName('helper-spider')).toBeDefined();
    expect(scene.getObjectByName('helper-owl')).toBeUndefined();
    animals.sync([]);
    expect(animals.count).toBe(0);
    expect(scene.getObjectByName('helper-animals')?.children).toHaveLength(0);
  });

  it('perches on the block top, rides live poses, and returns home when the run ends', () => {
    const { scene, animals } = setup();
    const cell: Vec3 = [2, 1, 3];
    animals.sync([block(cell, 'beaver')]);
    tick(animals, 1);
    const critter = scene.getObjectByName('helper-beaver');
    const home = cellToWorld(cell);
    expect(critter?.position.x).toBeCloseTo(home[0]);
    expect(critter?.position.z).toBeCloseTo(home[2]);
    expect(critter?.position.y).toBeGreaterThanOrEqual(home[1] + 1);
    expect(critter?.scale.x).toBeCloseTo(1, 1); // popped in

    animals.update(0.016, [{ id: blockId(cell), pos: [5, 7, -2] }]);
    expect(critter?.position.x).toBeCloseTo(5);
    expect(critter?.position.z).toBeCloseTo(-2);
    expect(critter?.position.y).toBeGreaterThanOrEqual(8);

    animals.update(0.016, null);
    expect(critter?.position.x).toBeCloseTo(home[0]);
  });

  it('pops in from nothing and caps the number of critters drawn', () => {
    const { scene, animals } = setup();
    animals.sync([block([0, 0, 0], 'owl')]);
    animals.update(0, null);
    expect(scene.getObjectByName('helper-owl')?.scale.x).toBeLessThan(0.1);

    const many: BlockData[] = [];
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) many.push(block([x, 0, z], 'spider'));
    animals.sync(many);
    expect(animals.count).toBe(MAX_HELPER_ANIMALS);
  });

  it('reacts: the owl turns toward its target and the spider shows its web; unknown ids are ignored', () => {
    const { scene, animals } = setup();
    animals.sync([block([4, 0, 4], 'owl'), block([1, 0, 1], 'spider')]);
    tick(animals, 1);
    animals.react(blockId([4, 0, 4]), [20, 3, 4 * 2 - 8 + 1]);
    animals.react('b:nope', [0, 0, 0]);
    animals.update(0.2, null);
    const owl = scene.getObjectByName('helper-owl');
    expect(owl?.rotation.y).toBeDefined();

    animals.react(blockId([1, 0, 1]), null);
    animals.update(0.1, null);
    const spider = scene.getObjectByName('helper-spider');
    const web = spider?.children.find(
      (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.RingGeometry,
    );
    expect(web?.visible).toBe(true);
    tick(animals, 1);
    expect(web?.visible).toBe(false);
  });

  it('dispose removes the root and is safe to call twice', () => {
    const { scene, animals } = setup();
    animals.sync([block([0, 0, 0], 'beaver')]);
    animals.dispose();
    expect(scene.getObjectByName('helper-animals')).toBeUndefined();
    expect(() => animals.dispose()).not.toThrow();
  });
});
