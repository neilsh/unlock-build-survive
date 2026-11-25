import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { P1_BODY_LAYER, PlayerBody } from './PlayerBody';

describe('PlayerBody', () => {
  it('is visible only when asked, follows Player 1, and is hidden from the default camera layer', () => {
    const scene = new THREE.Scene();
    const body = new PlayerBody(scene);
    expect(body.group.visible).toBe(false);

    body.update(0.05, true, [2, 0, 3], 1.2);
    expect(body.group.visible).toBe(true);
    expect(body.group.position.toArray()).toEqual([2, 0, 3]);
    expect(body.group.rotation.y).toBeCloseTo(1.2);

    const p1Cam = new THREE.PerspectiveCamera();
    const p2Cam = new THREE.PerspectiveCamera();
    p2Cam.layers.enable(P1_BODY_LAYER);
    let meshes = 0;
    body.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      meshes++;
      expect(p1Cam.layers.test(o.layers)).toBe(false);
      expect(p2Cam.layers.test(o.layers)).toBe(true);
    });
    expect(meshes).toBeGreaterThan(0);

    body.update(0.05, false, [2, 0, 3], 0);
    expect(body.group.visible).toBe(false);
    body.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
