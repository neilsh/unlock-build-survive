/**
 * Animal-helper blocks (beaver, owl, spider) against real Rapier in Node with plain PieceHandles.
 * Each helper is compared with the same build using plain wood in its place (a control), so the
 * difference is the animal's doing and not the block shape.
 */
import { describe, expect, it } from 'vitest';
import type { BlueprintGraph, DisasterType, MaterialType, Vec3 } from '../../types/blueprint';
import { DISASTER_SECONDS, blockId, cellToWorld } from '../../types/blueprint';
import type { HelperKind } from '../../types/materials';
import { HELPER_KINDS, MATERIALS, UNLOCKABLE_MATERIALS } from '../../types/materials';
import type { MeshRegistry } from '../BuildController';
import { PieceHandle } from '../InstancedPieces';
import { PHYSICS_TUNING, PhysicsSim, type HelperPose } from '../PhysicsSim';

function graphOf(blocks: Array<[Vec3, MaterialType]>): BlueprintGraph {
  return {
    version: 1,
    blocks: blocks.map(([cell, material]) => ({ id: blockId(cell), cell, material })),
    struts: [],
  };
}

function meshesFor(g: BlueprintGraph): MeshRegistry {
  const reg: MeshRegistry = { blocks: new Map(), struts: new Map() };
  for (const b of g.blocks) {
    const h = new PieceHandle();
    h.position.set(...cellToWorld(b.cell));
    reg.blocks.set(b.id, h);
  }
  return reg;
}

interface HelperEvent {
  id: string;
  kind: HelperKind;
  time: number;
  target: Vec3 | null;
}

async function run(g: BlueprintGraph, disaster: DisasterType, seed = 1) {
  const sim = new PhysicsSim();
  const actions: HelperEvent[] = [];
  let frame = 0;
  sim.setEvents({
    onHelperAction: (id, kind, _at, target) => actions.push({ id, kind, time: frame / 60, target }),
  });
  await sim.start(g, meshesFor(g), disaster, seed, 'medium');
  for (; sim.isRunning() && frame < 60 * (DISASTER_SECONDS + 1); frame++) sim.update(1 / 60);
  return { sim, actions, peak: sim.getPeakStrain().strain, t: sim.getTelemetry() };
}

/** A 4-tall tower on cell (3, y, 3) with `top` as the block in the fourth spot and `side` beside it. */
const tower = (top: MaterialType, side: MaterialType): BlueprintGraph =>
  graphOf([
    [[3, 0, 3], 'wood'],
    [[3, 1, 3], 'wood'],
    [[3, 2, 3], 'wood'],
    [[3, 3, 3], top],
    [[4, 0, 3], side],
  ]);

describe('animal helper blocks: catalogue', () => {
  it('registers three unlockable defense blocks with a shop cost, description and special', () => {
    expect(HELPER_KINDS).toEqual(['beaver', 'owl', 'spider']);
    for (const kind of HELPER_KINDS) {
      const def = MATERIALS[kind];
      expect(UNLOCKABLE_MATERIALS).toContain(kind);
      expect(def.special).toBe(kind);
      expect(def.cost).toBeGreaterThan(0);
      expect(def.shopCategory).toBe('defense');
      expect(def.description?.length).toBeGreaterThan(0);
    }
  });

  it('keeps shop prices ascending with the new blocks slotted in', () => {
    const costs = UNLOCKABLE_MATERIALS.map((m) => MATERIALS[m].cost ?? 0);
    expect(costs).toEqual(costs.toSorted((a, b) => a - b));
  });
});

describe('animal helper blocks: simulation', () => {
  it('reports no poses without a run, then one pose per helper block', async () => {
    const sim = new PhysicsSim();
    expect(sim.getHelperPoses()).toBeNull();
    const g = graphOf([
      [[3, 0, 3], 'stone'],
      [[3, 1, 3], 'owl'],
      [[4, 0, 3], 'beaver'],
      [[2, 0, 3], 'spider'],
      [[5, 0, 3], 'wood'],
    ]);
    await sim.start(g, meshesFor(g), 'earthquake', 1);
    const poses = sim.getHelperPoses() as HelperPose[];
    expect(poses.map((p) => p.kind).toSorted()).toEqual(['beaver', 'owl', 'spider']);
    const owl = poses.find((p) => p.kind === 'owl');
    expect(owl?.id).toBe(blockId([3, 1, 3]));
    expect(owl?.pos[1]).toBeCloseTo(3, 0);
    expect(owl?.fallen).toBe(false);
    sim.stop();
    expect(sim.getHelperPoses()).toBeNull();
  });

  it('caps how many helpers of one kind are active', async () => {
    const blocks: Array<[Vec3, MaterialType]> = [];
    for (let x = 0; x < 8; x++) for (let z = 0; z < 3; z++) blocks.push([[x, 0, z], 'beaver']);
    const g = graphOf(blocks);
    const sim = new PhysicsSim();
    await sim.start(g, meshesFor(g), 'flood', 1);
    expect(sim.getHelperPoses()?.length).toBe(PHYSICS_TUNING.helpers.maxPerKind);
    sim.stop();
  });

  it('beaver: stays quiet until the flood reaches it, then slaps its tail and shelters the tower', async () => {
    const withBeaver = await run(tower('wood', 'beaver'), 'flood');
    const control = await run(tower('wood', 'wood'), 'flood');
    expect(control.actions).toHaveLength(0);
    expect(withBeaver.actions.length).toBeGreaterThan(0);
    expect(withBeaver.actions.every((a) => a.kind === 'beaver' && a.target === null)).toBe(true);
    // Water starts below the ground, so the first splash comes well after the run begins.
    expect(withBeaver.actions[0]?.time).toBeGreaterThan(1);
    // Successive slaps respect the cooldown.
    for (let i = 1; i < withBeaver.actions.length; i++) {
      const gap = withBeaver.actions[i].time - withBeaver.actions[i - 1].time;
      expect(gap).toBeGreaterThanOrEqual(PHYSICS_TUNING.helpers.beaver.splashEvery - 0.05);
    }
    expect(withBeaver.peak).toBeLessThan(control.peak);
  });

  it('beaver: does nothing in a disaster without water', async () => {
    const r = await run(tower('wood', 'beaver'), 'earthquake');
    expect(r.actions).toHaveLength(0);
  });

  it('spider: webs make the same tower strain less in an earthquake and pulse when stressed', async () => {
    const withSpider = await run(tower('wood', 'spider'), 'earthquake');
    const control = await run(tower('wood', 'wood'), 'earthquake');
    expect(withSpider.peak).toBeLessThan(control.peak);
    expect(withSpider.actions.length).toBeGreaterThan(0);
    expect(withSpider.actions.every((a) => a.kind === 'spider')).toBe(true);
    expect(control.actions).toHaveLength(0);
  });

  it('spider: joints far outside the web radius get no help', async () => {
    const far = graphOf([
      [[0, 0, 0], 'wood'],
      [[0, 1, 0], 'wood'],
      [[0, 2, 0], 'wood'],
      [[0, 3, 0], 'wood'],
      [[7, 0, 7], 'spider'],
    ]);
    const farControl = graphOf([
      ...far.blocks.slice(0, 4).map((b): [Vec3, MaterialType] => [b.cell, b.material]),
      [[7, 0, 7], 'wood'],
    ]);
    const a = await run(far, 'earthquake');
    const b = await run(farControl, 'earthquake');
    expect(a.peak).toBeCloseTo(b.peak, 6);
  });

  it('owl: swats hazards in range with a cooldown and aims at them', async () => {
    const g = graphOf([
      [[3, 0, 3], 'steel'],
      [[3, 1, 3], 'owl'],
    ]);
    const r = await run(g, 'hail');
    expect(r.actions.length).toBeGreaterThan(0);
    for (const a of r.actions) {
      expect(a.kind).toBe('owl');
      expect(a.target).not.toBeNull();
    }
    for (let i = 1; i < r.actions.length; i++) {
      expect(r.actions[i].time - r.actions[i - 1].time).toBeGreaterThanOrEqual(
        PHYSICS_TUNING.helpers.owl.cooldown - 0.05,
      );
    }
    // Over 8 s with a 1.5 s cooldown it cannot swat more than 6 times.
    expect(r.actions.length).toBeLessThanOrEqual(
      Math.ceil(DISASTER_SECONDS / PHYSICS_TUNING.helpers.owl.cooldown),
    );
  });

  it('owl: has nothing to swat in an earthquake', async () => {
    const g = graphOf([
      [[3, 0, 3], 'steel'],
      [[3, 1, 3], 'owl'],
    ]);
    expect((await run(g, 'earthquake')).actions).toHaveLength(0);
  });

  it('helper runs are deterministic', async () => {
    const g = tower('owl', 'spider');
    const first = await run(g, 'hail', 3);
    const second = await run(g, 'hail', 3);
    expect(second.actions).toEqual(first.actions);
    expect(second.t).toEqual(first.t);
  });
});
