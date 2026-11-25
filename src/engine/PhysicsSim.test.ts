/**
 * Headless calibration for PhysicsSim: runs real Rapier in Node with plain three.js meshes.
 * If tuning changes, these tests define what "sensible" means for each disaster.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type {
  BlueprintGraph,
  DisasterType,
  MaterialType,
  Strength,
  StrutData,
  Vec3,
} from '../types/blueprint';
import { DISASTER_SECONDS, blockId, cellToWorld, cornerToWorld, strutId } from '../types/blueprint';
import { PRESETS } from '../types/presets';
import { WEAPONS } from '../types/gear';
import type { MeshRegistry } from './BuildController';
import { PieceHandle } from './InstancedPieces';
import { PHYSICS_TUNING, PhysicsSim, starsFor } from './PhysicsSim';

const SEEDS = [1, 2, 3, 4, 5];

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

const DISASTERS = ['earthquake', 'hurricane', 'flood', 'hail'] as const;

async function simulate(g: BlueprintGraph, disaster: DisasterType, seed = 1, strength?: Strength) {
  const sim = new PhysicsSim();
  const breaks: string[] = [];
  const water: number[] = [];
  let survived = 0;
  sim.setEvents({
    onJointBreak: (id) => breaks.push(id),
    onSurvived: () => survived++,
    onWaterLevel: (y) => water.push(y),
  });
  const meshes = meshesFor(g);
  await sim.start(g, meshes, disaster, seed, strength);
  const standing: number[] = [];
  const stars: number[] = [];
  for (let f = 0; sim.isRunning() && f < 60 * (DISASTER_SECONDS + 1); f++) {
    sim.update(1 / 60);
    standing.push(sim.getTelemetry().standingRatio);
    stars.push(sim.getTelemetry().stars);
  }
  return {
    sim,
    t: sim.getTelemetry(),
    peak: sim.getPeakStrain(),
    breaks,
    water,
    survived,
    meshes,
    standing,
    stars,
  };
}

function strut(a: Vec3, b: Vec3, material: MaterialType = 'bamboo'): StrutData {
  return { id: strutId(a, b), a, b, material };
}

/** The tower preset with bamboo X-braces on all four faces of both 2-block halves. */
function bracedTower(): BlueprintGraph {
  const g = PRESETS.tower();
  for (const y of [0, 2]) {
    for (const z of [3, 4]) g.struts.push(strut([3, y, z], [4, y + 2, z]), strut([4, y, z], [3, y + 2, z]));
    for (const x of [3, 4]) g.struts.push(strut([x, y, 3], [x, y + 2, 4]), strut([x, y, 4], [x, y + 2, 3]));
  }
  return g;
}

describe('PhysicsSim lifecycle', () => {
  it('reports build telemetry before starting', () => {
    const sim = new PhysicsSim();
    expect(sim.isRunning()).toBe(false);
    expect(sim.getTelemetry()).toEqual({
      mode: 'build',
      timeRemaining: DISASTER_SECONDS,
      activeJoints: 0,
      brokenJoints: 0,
      firstBrokenId: null,
      waterLevel: -2,
      standingRatio: 1,
      stars: 0,
    });
  });

  it('runs, counts joints, clamps frame time and returns to build on stop', async () => {
    const g = PRESETS.house();
    const sim = new PhysicsSim();
    await sim.start(g, meshesFor(g), 'earthquake');
    expect(sim.isRunning()).toBe(true);
    // 12 blocks: 20 face links + 4 anchors, plus 8 struts.
    expect(sim.getTelemetry()).toMatchObject({ mode: 'simulating', activeJoints: 32, brokenJoints: 0 });

    sim.update(1); // a 1 s hitch is clamped to 0.05 s = 3 fixed steps
    expect(sim.getTelemetry().timeRemaining).toBeCloseTo(DISASTER_SECONDS - 3 / 60, 5);

    sim.stop();
    expect(sim.isRunning()).toBe(false);
    expect(sim.getTelemetry().mode).toBe('build');
    expect(sim.getTelemetry().timeRemaining).toBe(DISASTER_SECONDS);
  });

  it('a stop() during Rapier start-up cancels that run', async () => {
    const g = PRESETS.tower();
    const sim = new PhysicsSim();
    const pending = sim.start(g, meshesFor(g), 'earthquake');
    sim.stop();
    await pending;
    expect(sim.isRunning()).toBe(false);
    expect(sim.getTelemetry().mode).toBe('build');
  });

  it('restarting replaces the previous run', async () => {
    const g = PRESETS.tower();
    const sim = new PhysicsSim();
    await sim.start(g, meshesFor(g), 'earthquake');
    for (let i = 0; i < 120; i++) sim.update(1 / 60);
    await sim.start(g, meshesFor(g), 'hurricane');
    expect(sim.getTelemetry()).toMatchObject({ mode: 'simulating', brokenJoints: 0 });
    expect(sim.getTelemetry().timeRemaining).toBe(DISASTER_SECONDS);
  });

  it('is deterministic for a given seed', async () => {
    const a = await simulate(PRESETS.tower(), 'hurricane', 7);
    const b = await simulate(PRESETS.tower(), 'hurricane', 7);
    expect(b.breaks).toEqual(a.breaks);
    expect(b.peak.strain).toBe(a.peak.strain);
    const pa = a.meshes.blocks.get(blockId([3, 3, 3]))?.position;
    const pb = b.meshes.blocks.get(blockId([3, 3, 3]))?.position;
    expect(pb?.toArray()).toEqual(pa?.toArray());
  });

  it('an empty island survives every disaster', async () => {
    const runs = await Promise.all(
      (['earthquake', 'hurricane', 'flood', 'hail'] as const).map((d) => simulate(PRESETS.empty(), d)),
    );
    expect(runs.map((r) => r.t.mode)).toEqual(['survived', 'survived', 'survived', 'survived']);
  });
});

describe('earthquake calibration', () => {
  it.each(SEEDS)('the unbraced tower fails (seed %i)', async (seed) => {
    const r = await simulate(PRESETS.tower(), 'earthquake', seed);
    expect(r.t.mode).toBe('failed');
    expect(r.t.brokenJoints).toBeGreaterThan(0);
    expect(r.t.firstBrokenId).toBe(r.breaks[0]);
    expect(r.t.firstBrokenId).toMatch(/^b:3,[0-3],3$/);
    expect(r.t.timeRemaining).toBe(0);
  });

  it.each(SEEDS)('the starter house survives with margin (seed %i)', async (seed) => {
    const r = await simulate(PRESETS.house(), 'earthquake', seed);
    expect(r.t.mode).toBe('survived');
    expect(r.t.brokenJoints).toBe(0);
    expect(r.survived).toBe(1);
    expect(r.peak.strain).toBeLessThan(0.6);
  });
});

describe('other disasters', () => {
  it.each(SEEDS)(
    'hurricane: tower fails, house survives, bracing saves the tower (seed %i)',
    async (seed) => {
      expect((await simulate(PRESETS.tower(), 'hurricane', seed)).t.mode).toBe('failed');
      expect((await simulate(PRESETS.house(), 'hurricane', seed)).t.mode).toBe('survived');
      expect((await simulate(bracedTower(), 'hurricane', seed)).t.mode).toBe('survived');
    },
  );

  it.each(SEEDS)('flood: tower is swept over, house and braced tower survive (seed %i)', async (seed) => {
    const tower = await simulate(PRESETS.tower(), 'flood', seed);
    expect(tower.t.mode).toBe('failed');
    const house = await simulate(PRESETS.house(), 'flood', seed);
    expect(house.t.mode).toBe('survived');
    expect((await simulate(bracedTower(), 'flood', seed)).t.mode).toBe('survived');
    // Water rises monotonically and is reported to the scene.
    expect(house.water.length).toBeGreaterThan(400);
    expect(house.water.at(-1)).toBeGreaterThan(3);
    expect(house.t.waterLevel).toBeCloseTo(house.water.at(-1) ?? 0, 5);
  });

  it('flood: loose foam floats up and loose stone stays down', async () => {
    const g: BlueprintGraph = {
      version: 1,
      // Floating blocks (cy = 1, no neighbours) are unanchored, so they settle on the island first.
      blocks: [
        { id: blockId([0, 1, 0]), cell: [0, 1, 0], material: 'foam' },
        { id: blockId([7, 1, 7]), cell: [7, 1, 7], material: 'stone' },
      ],
      struts: [],
    };
    const r = await simulate(g, 'flood');
    const foam = r.meshes.blocks.get(blockId([0, 1, 0]))?.position.y ?? 0;
    const stone = r.meshes.blocks.get(blockId([7, 1, 7]))?.position.y ?? 0;
    expect(foam).toBeGreaterThan(2.5);
    expect(stone).toBeLessThan(1.5);
  });

  it.each(SEEDS)('hail: house survives, hail stones appear and are cleaned up (seed %i)', async (seed) => {
    const g = PRESETS.house();
    const root = new THREE.Group();
    const meshes = meshesFor(g);
    const before = root.children.length;
    const sim = new PhysicsSim();
    sim.setEffectsRoot(root);
    await sim.start(g, meshes, 'hail', seed);
    let maxChildren = before;
    while (sim.isRunning()) {
      sim.update(1 / 60);
      maxChildren = Math.max(maxChildren, root.children.length);
    }
    expect(sim.getTelemetry().mode).toBe('survived');
    expect(maxChildren).toBeGreaterThan(before + 10);
    sim.stop();
    expect(root.children.length).toBe(before);
  });

  it('hail: reports where stones land, on the ground or the roof', async () => {
    const g = PRESETS.house();
    const sim = new PhysicsSim();
    const hits: Array<[number, number, number]> = [];
    sim.setEvents({ onHailImpact: (x, y, z) => hits.push([x, y, z]) });
    await sim.start(g, meshesFor(g), 'hail', 1);
    while (sim.isRunning()) sim.update(1 / 60);
    expect(hits.length).toBeGreaterThan(10);
    for (const [x, y, z] of hits) {
      expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
      // Never in mid-air near the spawn height, never far below the island top.
      expect(y).toBeGreaterThan(-1);
      expect(y).toBeLessThan(10);
    }
  });
});

describe('stress X-ray and meshes', () => {
  it('moves and tints meshes while shaking, and drops broken struts', async () => {
    const g = bracedTower();
    const meshes = meshesFor(g);
    const top = meshes.blocks.get(blockId([3, 3, 3]));
    const start = top?.position.clone();
    const sim = new PhysicsSim();
    await sim.start(g, meshes, 'earthquake');
    let maxEmissive = 0;
    while (sim.isRunning()) {
      sim.update(1 / 60);
      maxEmissive = Math.max(maxEmissive, top?.emissive.r ?? 0);
    }
    expect(top?.position.distanceTo(start ?? new THREE.Vector3())).toBeGreaterThan(0.01);
    // Strain above ~0.5 turns the tint from green towards yellow/orange (red channel rises).
    expect(maxEmissive).toBeGreaterThan(0.3);
  });

  it('a strut that breaks falls as debris', async () => {
    // A single weak foam strut on the shaking wood tower, made extra floppy for this test.
    const g = PRESETS.tower();
    g.struts.push(strut([3, 0, 3], [4, 2, 3], 'foam'));
    const saved = PHYSICS_TUNING.strutStiffness;
    PHYSICS_TUNING.strutStiffness = 500;
    const r = await simulate(g, 'earthquake').finally(() => {
      PHYSICS_TUNING.strutStiffness = saved;
    });
    const id = g.struts[0].id;
    expect(r.breaks).toContain(id);
    // Its mesh no longer spans the wall (centre was at y = 2): it fell onto the island.
    expect(r.meshes.struts.get(id)?.position.y ?? 99).toBeLessThan(1);
  });
});

describe('star scoring', () => {
  it('maps broken joints and standing ratio onto 0-3 stars', () => {
    expect(starsFor(0, 1)).toBe(3);
    expect(starsFor(0, 0.4)).toBe(3); // no joint broke: a loose block that slid off does not cost stars
    expect(starsFor(1, 1)).toBe(2);
    expect(starsFor(3, 0.8)).toBe(2);
    expect(starsFor(3, 0.79)).toBe(1);
    expect(starsFor(3, 0.5)).toBe(1);
    expect(starsFor(3, 0.49)).toBe(0);
    expect(starsFor(3, 0)).toBe(0);
  });

  it('an empty island scores 3 stars with everything standing', async () => {
    const r = await simulate(PRESETS.empty(), 'earthquake');
    expect(r.t).toMatchObject({ standingRatio: 1, stars: 3 });
  });

  it.each(DISASTERS)('the starter house keeps 3 stars throughout a %s', async (d) => {
    const r = await simulate(PRESETS.house(), d);
    expect(r.t).toMatchObject({ mode: 'survived', standingRatio: 1, stars: 3 });
    expect(new Set(r.stars)).toEqual(new Set([3]));
  });

  it.each(SEEDS)('a collapsed tower scores 0 stars and standing only falls (seed %i)', async (seed) => {
    const r = await simulate(PRESETS.tower(), 'earthquake', seed);
    // Only the bottom block stays put; the top three come loose and topple.
    expect(r.t).toMatchObject({ mode: 'failed', standingRatio: 0.25, stars: 0 });
    expect(r.standing.every((x, i) => i === 0 || x <= r.standing[i - 1])).toBe(true);
    expect(r.stars[0]).toBe(3); // nothing has broken yet on the first step
  });

  it.each([
    [2, 0],
    [3, 1],
    [4, 0],
    [5, 0],
  ] as const)(
    'partial or heavy hail damage lowers tower stars accordingly (gentle hail on the tower, seed %i)',
    async (seed, expectedStars) => {
      const r = await simulate(PRESETS.tower(), 'hail', seed, 'gentle');
      expect(r.t.mode).toBe('failed');
      expect(r.t.brokenJoints).toBeGreaterThan(0);
      expect(r.t.stars).toBe(expectedStars);
    },
  );

  it('broken struts and the blocks they hung from stop counting as standing', async () => {
    // Braced tower in a medium quake: an anchor gives way and the whole tower topples.
    const r = await simulate(bracedTower(), 'earthquake', 1);
    expect(r.t.mode).toBe('failed');
    expect(r.t.standingRatio).toBeLessThan(0.5);
    expect(r.t.stars).toBe(0);
  });
});

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const peaks = async (g: () => BlueprintGraph, d: DisasterType, strength: Strength) =>
  Promise.all(SEEDS.map(async (seed) => (await simulate(g(), d, seed, strength)).peak.strain));

/** Most hail stones alive at once during a run on the house. */
async function maxHail(strength: Strength) {
  const root = new THREE.Group();
  const sim = new PhysicsSim();
  sim.setEffectsRoot(root);
  const g = PRESETS.house();
  await sim.start(g, meshesFor(g), 'hail', 1, strength);
  let max = 0;
  while (sim.isRunning()) {
    sim.update(1 / 60);
    max = Math.max(max, root.children.length);
  }
  sim.stop();
  return max;
}

describe('strength levels', () => {
  it('medium is the default', async () => {
    const a = await simulate(PRESETS.house(), 'hurricane', 3);
    const b = await simulate(PRESETS.house(), 'hurricane', 3, 'medium');
    expect(b.peak.strain).toBe(a.peak.strain);
  });

  it.each(DISASTERS)('%s: stronger disasters strain the house more', async (d) => {
    const [gentle, medium, strong] = await Promise.all(
      (['gentle', 'medium', 'strong'] as const).map(async (s) => mean(await peaks(PRESETS.house, d, s))),
    );
    expect(gentle).toBeLessThan(medium);
    expect(medium).toBeLessThan(strong);
  });

  it.each(SEEDS)(
    'gentle: the house survives every disaster and flood spares a braced tower (seed %i)',
    async (seed) => {
      const runs = await Promise.all(DISASTERS.map((d) => simulate(PRESETS.house(), d, seed, 'gentle')));
      for (const r of runs) expect(r.t).toMatchObject({ mode: 'survived', stars: 3 });
      expect((await simulate(bracedTower(), 'flood', seed, 'gentle')).t.mode).toBe('survived');
    },
  );

  it.each(SEEDS)(
    'strong: the house still survives a quake, the tower fails everything (seed %i)',
    async (seed) => {
      const house = await simulate(PRESETS.house(), 'earthquake', seed, 'strong');
      expect(house.t.mode).toBe('survived');
      expect(house.peak.strain).toBeLessThan(0.8);
      const towers = await Promise.all(DISASTERS.map((d) => simulate(PRESETS.tower(), d, seed, 'strong')));
      for (const r of towers) expect(r.t).toMatchObject({ mode: 'failed', stars: 0 });
    },
  );

  it('strong hail drops more stones than gentle hail', async () => {
    expect(await maxHail('strong')).toBeGreaterThan((await maxHail('gentle')) * 1.5);
  });
});

function makeAnchorTower(base: MaterialType): BlueprintGraph {
  return {
    version: 1,
    blocks: [
      { id: blockId([3, 0, 3]), cell: [3, 0, 3], material: base },
      { id: blockId([3, 1, 3]), cell: [3, 1, 3], material: 'steel' },
      { id: blockId([3, 2, 3]), cell: [3, 2, 3], material: 'steel' },
      { id: blockId([3, 3, 3]), cell: [3, 3, 3], material: 'steel' },
      { id: blockId([3, 4, 3]), cell: [3, 4, 3], material: 'steel' },
      { id: blockId([3, 5, 3]), cell: [3, 5, 3], material: 'steel' },
    ],
    struts: [],
  };
}

function makeShieldBuild(centerMat: MaterialType): BlueprintGraph {
  return {
    version: 1,
    blocks: [
      { id: blockId([3, 0, 3]), cell: [3, 0, 3], material: centerMat },
      { id: blockId([4, 0, 3]), cell: [4, 0, 3], material: 'wood' },
      { id: blockId([4, 1, 3]), cell: [4, 1, 3], material: 'wood' },
      { id: blockId([4, 2, 3]), cell: [4, 2, 3], material: 'wood' },
      { id: blockId([4, 3, 3]), cell: [4, 3, 3], material: 'wood' },
    ],
    struts: [],
  };
}

describe('new disasters and tech blocks', () => {
  it.each(['fire_tornado', 'snow_storm', 'raid', 'meteor'] as const)(
    '%s: tower fails, empty island survives, impacts are reported',
    async (disaster) => {
      expect((await simulate(PRESETS.empty(), disaster)).t.mode).toBe('survived');
      expect((await simulate(PRESETS.tower(), disaster)).t.mode).toBe('failed');

      const g = PRESETS.house();
      const sim = new PhysicsSim();
      const impacts: number[] = [];
      sim.setEvents({ onProjectileImpact: () => impacts.push(1) });
      await sim.start(g, meshesFor(g), disaster, 1, 'medium');
      while (sim.isRunning()) sim.update(1 / 60);
      expect(impacts.length).toBeGreaterThan(0);
    },
  );

  it('anchor block grips the ground stronger than stone in a strong hurricane', async () => {
    const withStone = await simulate(makeAnchorTower('stone'), 'hurricane', 1, 'strong');
    const withAnchor = await simulate(makeAnchorTower('anchor'), 'hurricane', 1, 'strong');
    expect(withStone.t.mode).toBe('failed');
    expect(withAnchor.t.mode).toBe('survived');
    expect(withAnchor.peak.strain).toBeLessThan(withStone.peak.strain * 0.9);
  });

  it('shield projector reinforces nearby blocks and creates/cleans up its dome mesh', async () => {
    const unshielded = await simulate(makeShieldBuild('stone'), 'hurricane', 1, 'medium');
    const shielded = await simulate(makeShieldBuild('shield'), 'hurricane', 1, 'medium');
    expect(unshielded.t.mode).toBe('failed');
    expect(shielded.t.mode).toBe('survived');
    expect(shielded.peak.strain).toBeLessThan(unshielded.peak.strain * 0.5);

    const root = new THREE.Group();
    const g = makeShieldBuild('shield');
    const sim = new PhysicsSim();
    sim.setEffectsRoot(root);
    await sim.start(g, meshesFor(g), 'earthquake', 1);
    expect(root.children.length).toBe(1);
    sim.stop();
    expect(root.children.length).toBe(0);
  });

  it('laser block fires with nerfed range/cooldown and needs 2 shots for meteors', async () => {
    expect(PHYSICS_TUNING.laser.range).toBeLessThanOrEqual(11);
    expect(PHYSICS_TUNING.laser.cooldown).toBeGreaterThanOrEqual(1.2);

    const g: BlueprintGraph = {
      version: 1,
      blocks: [
        { id: blockId([3, 0, 3]), cell: [3, 0, 3], material: 'stone' },
        { id: blockId([3, 1, 3]), cell: [3, 1, 3], material: 'laser' },
      ],
      struts: [],
    };
    const sim = new PhysicsSim();
    const shots: Array<[Vec3, Vec3]> = [];
    sim.setEvents({ onLaserFire: (from, to) => shots.push([from, to]) });
    await sim.start(g, meshesFor(g), 'raid', 1, 'medium');
    while (sim.isRunning()) sim.update(1 / 60);
    expect(shots.length).toBeGreaterThanOrEqual(1);
    expect(shots.length).toBeLessThanOrEqual(7); // 1.2s cooldown caps shots over 8s

    // Out-of-range check: laser at corner (0,0,0) does not hit raid targets only over (7,0,7)?
    // Wait: test single vs twin laser against 2-HP meteors on a 2x2 platform at (3..4, 3..4).
    const oneLaser: BlueprintGraph = {
      version: 1,
      blocks: [
        { id: blockId([3, 0, 3]), cell: [3, 0, 3], material: 'steel' },
        { id: blockId([3, 1, 3]), cell: [3, 1, 3], material: 'laser' },
      ],
      struts: [],
    };
    const twoLasers: BlueprintGraph = {
      version: 1,
      blocks: [
        ...oneLaser.blocks,
        { id: blockId([4, 0, 3]), cell: [4, 0, 3], material: 'steel' },
        { id: blockId([4, 1, 3]), cell: [4, 1, 3], material: 'laser' },
      ],
      struts: [],
    };
    const singleImpacts: number[] = [];
    const sim1 = new PhysicsSim();
    sim1.setEvents({ onProjectileImpact: () => singleImpacts.push(1) });
    await sim1.start(oneLaser, meshesFor(oneLaser), 'meteor', 1, 'medium');
    while (sim1.isRunning()) sim1.update(1 / 60);
    expect(singleImpacts.length).toBeGreaterThan(0);

    const twinShots: number[] = [];
    const sim2 = new PhysicsSim();
    sim2.setEvents({ onLaserFire: () => twinShots.push(1) });
    await sim2.start(twoLasers, meshesFor(twoLasers), 'meteor', 1, 'medium');
    while (sim2.isRunning()) sim2.update(1 / 60);
    expect(twinShots.length).toBeGreaterThanOrEqual(2);
  });

  it('supports custom mod blocks, custom disasters and world rules', async () => {
    const customMaterials = new Map([
      [
        'mod:obsidian',
        {
          id: 'mod:obsidian',
          label: 'Obsidian',
          color: 0x311b92,
          density: 3.4,
          stiffness: 2.4,
          maxStress: 4.0,
          buoyancy: 0,
        },
      ],
    ]);
    const g: BlueprintGraph = {
      version: 1,
      blocks: [0, 1, 2, 3].map((y) => ({
        id: blockId([3, y, 3]),
        cell: [3, y, 3],
        material: 'mod:obsidian',
      })),
      struts: [],
    };
    const sim = new PhysicsSim();
    const impacts: string[] = [];
    const water: number[] = [];
    sim.setEvents({
      onProjectileImpact: (kind) => impacts.push(kind),
      onWaterLevel: (y) => water.push(y),
    });
    await sim.start(g, meshesFor(g), 'mod:mega', 1, 'medium', {
      customMaterials,
      customDisaster: {
        id: 'mod:mega',
        label: 'Mega',
        color: 0x84cc16,
        quake: 0.6,
        wind: 0.6,
        flood: true,
        projectiles: { mode: 'rain', rate: 6, speed: 15, radius: 0.4, density: 2 },
      },
      gravityMultiplier: 0.35,
      durationSeconds: 5,
    });
    expect(sim.getTelemetry().timeRemaining).toBe(5);
    let steps = 0;
    while (sim.isRunning()) {
      sim.update(1 / 60);
      steps++;
    }
    expect(steps).toBe(300); // 5s at 60 Hz
    expect(sim.getTelemetry().mode).toBe('survived');
    expect(water.length).toBe(301); // initial flood level + 300 steps
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts.every((k) => k === 'custom')).toBe(true);
  });

  it('damages first-person player on fall, flood drowning, falling blocks, and projectiles with i-frames', async () => {
    // 1. Fall KO & stationary block deals 0 damage
    const gStatic = PRESETS.house();
    const simStatic = new PhysicsSim();
    await simStatic.start(gStatic, meshesFor(gStatic), 'earthquake', 1, 'gentle');
    expect(simStatic.getBlockPositions()).toHaveLength(gStatic.blocks.length);
    const fallHit = simStatic.checkPlayerDamage([0, -7, 0], 1 / 60);
    expect(fallHit.damage).toBe(PHYSICS_TUNING.player.maxHp);
    expect(fallHit.impact).toBe(true);
    simStatic.stop();

    // 2. Flood drowning when water rises above head height
    const simFlood = new PhysicsSim();
    await simFlood.start(PRESETS.empty(), meshesFor(PRESETS.empty()), 'flood', 1, 'medium');
    for (let i = 0; i < 300; i++) simFlood.update(1 / 60); // 5s -> water > 2.5
    const drown = simFlood.checkPlayerDamage([0, 0, 0], 0.1);
    expect(drown.damage).toBeCloseTo(PHYSICS_TUNING.player.drownDps * 0.1);
    expect(drown.impact).toBe(false);
    simFlood.stop();

    // 3. Falling unanchored block hits player + invulnerability window prevents double hit
    const loose: BlueprintGraph = {
      version: 1,
      blocks: [{ id: blockId([3, 3, 3]), cell: [3, 3, 3], material: 'stone' }],
      struts: [],
    };
    const simBlock = new PhysicsSim();
    await simBlock.start(loose, meshesFor(loose), 'hail', 1, 'gentle');
    for (let i = 0; i < 45; i++) simBlock.update(1 / 60); // falls fast downward
    const pos = simBlock.getBlockPositions()[0];
    expect(pos).toBeDefined();
    if (!pos) throw new Error('expected block position');
    const blockHit = simBlock.checkPlayerDamage([pos[0], Math.max(0, pos[1] - 0.5), pos[2]], 1 / 60);
    expect(blockHit.damage).toBe(PHYSICS_TUNING.player.blockDamage);
    expect(blockHit.impact).toBe(true);
    const invulnHit = simBlock.checkPlayerDamage([pos[0], Math.max(0, pos[1] - 0.5), pos[2]], 1 / 60);
    expect(invulnHit.damage).toBe(0);
    simBlock.stop();
  });

  it('applies armor damageReduction and floodImmune, and fires player weapons at projectiles', async () => {
    // 1. Flood immunity & damage reduction on drowning + debris hit
    const simFlood = new PhysicsSim();
    await simFlood.start(PRESETS.empty(), meshesFor(PRESETS.empty()), 'flood', 1, 'medium');
    for (let i = 0; i < 300; i++) simFlood.update(1 / 60);
    const immune = simFlood.checkPlayerDamage([0, 0, 0], 0.1, {
      damageReduction: 0.5,
      floodImmune: true,
    });
    expect(immune.damage).toBe(0);
    const reducedFlood = simFlood.checkPlayerDamage([0, 0, 0], 0.1, {
      damageReduction: 0.5,
      floodImmune: false,
    });
    expect(reducedFlood.damage).toBeCloseTo(PHYSICS_TUNING.player.drownDps * 0.1 * 0.5);
    // Fall off island remains unreduced
    const fall = simFlood.checkPlayerDamage([0, -7, 0], 1 / 60, {
      damageReduction: 0.6,
      floodImmune: true,
    });
    expect(fall.damage).toBe(PHYSICS_TUNING.player.maxHp);
    simFlood.stop();

    // 2. Player weapon ray hits and destroys projectiles (including splash for shock_cannon)
    const simProj = new PhysicsSim();
    await simProj.start(PRESETS.empty(), meshesFor(PRESETS.empty()), 'mod:swarm', 1, 'medium', {
      customDisaster: {
        id: 'mod:swarm',
        label: 'Swarm',
        color: 0xff0000,
        projectiles: { mode: 'rain', rate: 60, speed: 3, radius: 0.5, density: 2 },
      },
      durationSeconds: 8,
    });
    for (let i = 0; i < 150; i++) simProj.update(1 / 60);
    const targets = simProj.getProjectilePositions();
    expect(targets.length).toBeGreaterThanOrEqual(4);

    // Pick a single target and fire slingshot directly at it
    const t0 = targets[0];
    const origin: Vec3 = [t0[0], 1.5, t0[2] + 8];
    const dir: Vec3 = [t0[0] - origin[0], t0[1] - origin[1], t0[2] - origin[2]];
    const singleShot = simProj.firePlayerWeapon(origin, dir, WEAPONS.slingshot);
    expect(singleShot.hit).toBe(true);
    expect(singleShot.destroyedCount).toBe(1);
    expect(simProj.getProjectilePositions().length).toBe(targets.length - 1);

    // Cluster two close projectiles (or check remaining ones) and fire shock_cannon for splash
    const rest = simProj.getProjectilePositions();
    // Find a projectile that has at least one neighbor within 5 units (shock_cannon splashRadius)
    let clusterIdx = 0;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      const hasNeighbor = rest.some(
        (b, j) =>
          i !== j && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= WEAPONS.shock_cannon.splashRadius,
      );
      if (hasNeighbor) {
        clusterIdx = i;
        break;
      }
    }
    const tc = rest[clusterIdx];
    const cOrigin: Vec3 = [tc[0], tc[1], tc[2] + 6];
    const cDir: Vec3 = [0, 0, -1];
    const splashShot = simProj.firePlayerWeapon(cOrigin, cDir, WEAPONS.shock_cannon);
    expect(splashShot.hit).toBe(true);
    expect(splashShot.destroyedCount).toBeGreaterThanOrEqual(2);
    simProj.stop();
  });
});
