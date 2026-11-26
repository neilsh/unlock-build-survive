import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FirstPersonController } from './FirstPersonController';

function makeFp() {
  const fp = new FirstPersonController(new THREE.PerspectiveCamera(45, 1, 0.1, 200));
  fp.spawn([]);
  fp.setEnabled(true);
  return fp;
}

describe('FirstPersonController look options', () => {
  it('scales look speed by the sensitivity multiplier', () => {
    const a = makeFp();
    const b = makeFp();
    b.setLookOptions(2, false);
    a.lookAngles(0.1, 0.05);
    b.lookAngles(0.1, 0.05);
    expect(b.yaw - 0).toBeCloseTo(a.yaw * 2);
    expect(b.pitch - -0.08).toBeCloseTo((a.pitch - -0.08) * 2);
    a.dispose();
    b.dispose();
  });

  it('inverts only the vertical axis', () => {
    const a = makeFp();
    const b = makeFp();
    b.setLookOptions(1, true);
    a.lookAngles(0.1, 0.1);
    b.lookAngles(0.1, 0.1);
    expect(b.yaw).toBeCloseTo(a.yaw);
    expect(b.pitch - -0.08).toBeCloseTo(-(a.pitch - -0.08));
    a.dispose();
    b.dispose();
  });

  it('falls back to 1x for nonsense sensitivity and still clamps pitch', () => {
    const fp = makeFp();
    fp.setLookOptions(Number.NaN, false);
    fp.lookAngles(0, -1000);
    expect(fp.pitch).toBeLessThan(Math.PI / 2);
    const before = fp.yaw;
    fp.setLookOptions(0, false);
    fp.lookAngles(0.1, 0);
    expect(fp.yaw).toBeCloseTo(before - 0.1);
    fp.dispose();
  });
});
