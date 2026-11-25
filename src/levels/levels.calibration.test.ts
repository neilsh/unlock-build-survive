/**
 * Level tuning against the real physics: for every level, a reference build that a child could find
 * must reach the level's goal stars, and an obvious naive build must not (so the level teaches something).
 * If physics tuning changes, re-run this and adjust `goalStars` / limits in levels.ts.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MeshRegistry } from '../engine/BuildController';
import { PieceHandle } from '../engine/InstancedPieces';
import { PhysicsSim } from '../engine/PhysicsSim';
import type { BlueprintGraph, MaterialType, Stars, Vec3 } from '../types/blueprint';
import { DISASTER_SECONDS, blockId, cellToWorld, cornerToWorld, strutId } from '../types/blueprint';
import { buildHeight, isMaterialAllowed } from './constraints';
import { LEVELS, type Level } from './levels';

function meshesFor(g: BlueprintGraph): MeshRegistry {
  const reg: MeshRegistry = { blocks: new Map(), struts: new Map() };
  for (const b of g.blocks) {
    const h = new PieceHandle();
    h.position.set(...cellToWorld(b.cell));
    reg.blocks.set(b.id, h);
  }
  for (const s of g.struts) {
    const a = new THREE.Vector3(...cornerToWorld(s.a));
    const b = new THREE.Vector3(...cornerToWorld(s.b));
    const h = new PieceHandle();
    h.position.copy(a).add(b).multiplyScalar(0.5);
    h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    h.scale.y = a.distanceTo(b);
    reg.struts.set(s.id, h);
  }
  return reg;
}

async function starsFor(level: Level, g: BlueprintGraph): Promise<Stars> {
  const sim = new PhysicsSim();
  await sim.start(g, meshesFor(g), level.disaster, level.seed ?? 1, level.strength);
  for (let f = 0; sim.isRunning() && f < 60 * (DISASTER_SECONDS + 1); f++) sim.update(1 / 60);
  return sim.getTelemetry().stars;
}

interface BoxSpec {
  /** Footprint width (x) and depth (z) in cells, and height in layers. */
  size: [number, number, number];
  /** Ground layer, upper layers and X-braces. */
  materials: [MaterialType, MaterialType, MaterialType];
  braced?: boolean;
  /** Optional tech/extra blocks placed after the main box (for late-game defense levels). */
  extras?: Array<{ cell: Vec3; material: MaterialType }>;
}

/** A box at (3, 0, 3) on top of the level's starting build, optionally X-braced on every face. */
function box(level: Level, { size: [w, d, h], materials: [ground, upper, brace], braced, extras }: BoxSpec) {
  const g: BlueprintGraph = level.start?.() ?? { version: 1, blocks: [], struts: [] };
  const [x0, z0] = [3, 3];
  const [x1, z1] = [x0 + w, z0 + d];
  for (let y = 0; y < h; y++)
    for (let x = x0; x < x1; x++)
      for (let z = z0; z < z1; z++) {
        const cell: Vec3 = [x, y, z];
        const id = blockId(cell);
        const material = y === 0 ? ground : upper;
        const existing = g.blocks.find((b) => b.id === id);
        if (existing) existing.material = material; // painting a starting block
        else g.blocks.push({ id, cell, material });
      }
  if (extras) {
    for (const ex of extras) {
      const id = blockId(ex.cell);
      const existing = g.blocks.find((b) => b.id === id);
      if (existing) existing.material = ex.material;
      else g.blocks.push({ id, cell: ex.cell, material: ex.material });
    }
  }
  if (braced) {
    const add = (a: Vec3, b: Vec3) => g.struts.push({ id: strutId(a, b), a, b, material: brace });
    for (let y = 0; y < h; y += 2) {
      const top = Math.min(y + 2, h);
      for (const z of [z0, z1]) {
        add([x0, y, z], [x1, top, z]);
        add([x1, y, z], [x0, top, z]);
      }
      for (const x of [x0, x1]) {
        add([x, y, z0], [x, top, z1]);
        add([x, y, z1], [x, top, z0]);
      }
    }
  }
  return g;
}

const WOOD: BoxSpec['materials'] = ['wood', 'wood', 'wood'];
const HOUSE: BoxSpec['materials'] = ['stone', 'wood', 'bamboo'];

/** Per level: a reference build that reaches the goal, and a naive one that falls short (the hail tutorial has none). */
const CASES: Record<string, { good: BoxSpec; naive?: BoxSpec }> = {
  'first-shake': { good: { size: [2, 2, 3], materials: WOOD }, naive: { size: [1, 1, 3], materials: WOOD } },
  'hail-hut': { good: { size: [2, 2, 2], materials: WOOD } },
  'bunny-burrow': {
    good: { size: [2, 2, 3], materials: WOOD },
    naive: { size: [2, 2, 2], materials: ['foam', 'foam', 'foam'] },
  },
  'squirrel-lookout': {
    good: { size: [1, 1, 4], materials: HOUSE, braced: true },
    naive: { size: [1, 1, 4], materials: WOOD, braced: true },
  },
  'windy-meadow': {
    good: { size: [2, 2, 3], materials: WOOD },
    naive: { size: [1, 1, 4], materials: WOOD },
  },
  'bamboo-bungalow': {
    good: { size: [2, 2, 3], materials: ['bamboo', 'bamboo', 'bamboo'] },
    naive: { size: [1, 1, 3], materials: ['bamboo', 'bamboo', 'bamboo'] },
  },
  'wobbly-tower': {
    good: { size: [2, 2, 1], materials: ['stone', 'stone', 'bamboo'], braced: true },
    naive: { size: [1, 1, 4], materials: ['wood', 'wood', 'bamboo'], braced: true },
  },
  'duck-pond': {
    good: { size: [2, 2, 3], materials: HOUSE, braced: true },
    naive: { size: [1, 1, 3], materials: WOOD },
  },
  'stone-castle': {
    good: { size: [3, 2, 3], materials: ['stone', 'wood', 'wood'] },
    naive: { size: [2, 2, 4], materials: ['stone', 'wood', 'wood'] },
  },
  'critter-haven': {
    good: { size: [2, 2, 4], materials: HOUSE, braced: true },
    naive: { size: [1, 1, 4], materials: HOUSE },
  },
  'blizzard-barn': {
    good: { size: [2, 2, 3], materials: HOUSE, braced: true },
    naive: { size: [1, 1, 4], materials: ['foam', 'foam', 'foam'] },
  },
  'flame-vortex': {
    good: {
      size: [2, 2, 3],
      materials: ['anchor', 'steel', 'steel'],
      braced: true,
      extras: [{ cell: [3, 3, 3], material: 'laser' }],
    },
    naive: { size: [1, 1, 4], materials: WOOD },
  },
  'bandit-raid': {
    good: {
      size: [2, 2, 3],
      materials: ['stone', 'steel', 'steel'],
      braced: true,
      extras: [
        { cell: [3, 1, 3], material: 'shield' },
        { cell: [4, 3, 4], material: 'laser' },
      ],
    },
    naive: { size: [1, 1, 4], materials: WOOD },
  },
  'meteor-finale': {
    good: {
      size: [2, 2, 3],
      materials: ['anchor', 'steel', 'steel'],
      braced: true,
      extras: [
        { cell: [3, 1, 3], material: 'shield' },
        { cell: [3, 3, 3], material: 'laser' },
        { cell: [4, 3, 4], material: 'laser' },
      ],
    },
    naive: { size: [1, 1, 4], materials: WOOD },
  },
};

describe('level calibration against physics', () => {
  it('has a reference build for every level', () => {
    expect(Object.keys(CASES).toSorted()).toEqual(LEVELS.map((l) => l.id).toSorted());
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))(
    '%s: a reference build reaches the goal',
    async (_, level) => {
      const c = CASES[level.id];
      if (!c) throw new Error(`no case for ${level.id}`);
      const good = box(level, c.good);
      expect(good.blocks.length).toBeLessThanOrEqual(level.constraints?.maxBlocks ?? Infinity);
      expect(buildHeight(good)).toBeGreaterThanOrEqual(level.minHeight ?? 0);
      expect(
        [...good.blocks, ...good.struts].every((p) => isMaterialAllowed(level.constraints, p.material)),
      ).toBe(true);
      expect(await starsFor(level, good)).toBeGreaterThanOrEqual(level.goalStars);
    },
  );

  const naive = LEVELS.flatMap((l) => {
    const spec = CASES[l.id]?.naive;
    return spec ? [[l.id, l, spec] as const] : [];
  });
  it.each(naive)('%s: the naive build falls short', async (_, level, spec) => {
    expect(await starsFor(level, box(level, spec))).toBeLessThan(level.goalStars);
  });
});
