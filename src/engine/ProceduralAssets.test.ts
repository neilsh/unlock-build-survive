import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ProceduralAssets } from './ProceduralAssets';
import { AudioSynth } from './AudioSynth';
import { MATERIALS, MATERIAL_ORDER } from '../types/materials';

describe('ProceduralAssets (headless)', () => {
  it('builds a shared rounded block that fits the 2-unit grid with a small gap', () => {
    const assets = new ProceduralAssets();
    const geo = assets.getBlockGeometry();
    expect(assets.getBlockGeometry()).toBe(geo);
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new THREE.Vector3());
    for (const v of [size.x, size.y, size.z]) {
      expect(v).toBeGreaterThan(1.9);
      expect(v).toBeLessThan(2);
    }
    expect(geo.attributes.uv).toBeDefined();
    assets.dispose();
  });

  it('builds a unit-length strut along +Y centred on the origin', () => {
    const assets = new ProceduralAssets();
    const geo = assets.getStrutGeometry();
    expect(assets.getStrutGeometry()).toBe(geo);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.y).toBeCloseTo(-0.5);
    expect(box.max.y).toBeCloseTo(0.5);
    expect(box.max.x).toBeCloseTo(0.15, 2);
    assets.dispose();
  });

  it('returns a new material per call, falling back to the flat colour without a DOM', () => {
    const assets = new ProceduralAssets();
    for (const type of MATERIAL_ORDER) {
      const a = assets.createMaterial(type);
      const b = assets.createMaterial(type);
      expect(a).not.toBe(b);
      expect(a.color.getHex()).toBe(new THREE.Color(MATERIALS[type].color).getHex());
      a.dispose();
      b.dispose();
    }
    assets.dispose();
  });

  it('audio is a silent no-op without Web Audio', () => {
    const audio = new AudioSynth();
    audio.resume();
    audio.playClack();
    audio.playBraceStretch();
    audio.playJointSnap();
    audio.playWind(0.5);
    audio.playRumble(2);
    audio.playVictory();
    audio.playLaserZap();
    audio.playUnlock();
    audio.playHit();
    audio.playKO();
    audio.setMuted(true);
    expect(audio.isMuted()).toBe(true);
    audio.dispose();
  });
});
