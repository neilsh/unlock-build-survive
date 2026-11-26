import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VILLAGER_MAX_HP } from '../../levels/village';
import { HUT, graphOf, type BlockSpec } from '../../levels/villageFixtures';
import { GRID_CELLS, VILLAGE_GRID_CELLS, setIslandCells } from '../../types/blueprint';
import { VillageSim } from './VillageSim';

beforeEach(() => setIslandCells(VILLAGE_GRID_CELLS));
afterEach(() => setIslandCells(GRID_CELLS));

const run = (sim: VillageSim, seconds: number, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) sim.update(dt);
};

function makeSim(blocks: BlockSpec[] = HUT, population = 2, seed = 1) {
  const sim = new VillageSim(seed);
  sim.setStructure(graphOf(blocks));
  sim.reset(population);
  return sim;
}

const positions = (s: VillageSim) => s.getVillagers().map((v) => [v.x, v.z]);

const only = (sim: VillageSim) => {
  const v = sim.getVillagers()[0];
  if (!v) throw new Error('no villager');
  return v;
};

describe('VillageSim wandering', () => {
  it('spawns the requested population at full HP inside the island', () => {
    const sim = makeSim(HUT, 5);
    expect(sim.getVillagers()).toHaveLength(5);
    for (const v of sim.getVillagers()) {
      expect(v.hp).toBe(VILLAGER_MAX_HP);
      expect(Math.abs(v.x)).toBeLessThan(14);
      expect(Math.abs(v.z)).toBeLessThan(14);
    }
  });

  it('is deterministic for the same seed and different for another', () => {
    const a = makeSim(HUT, 4, 3);
    const b = makeSim(HUT, 4, 3);
    const c = makeSim(HUT, 4, 4);
    run(a, 12);
    run(b, 12);
    run(c, 12);
    expect(positions(a)).toEqual(positions(b));
    expect(positions(a)).not.toEqual(positions(c));
  });

  it('wanders around without ever entering a wall cell', () => {
    const sim = makeSim(HUT, 6);
    const start = sim.getVillagers().map((v) => [v.x, v.z]);
    const walls = [
      [4, 5],
      [6, 5],
      [5, 4],
    ] as const;
    for (let i = 0; i < 400; i++) {
      sim.update(1 / 20);
      for (const v of sim.getVillagers()) {
        for (const [cx, cz] of walls) {
          const wx = cx * 2 - 14;
          const wz = cz * 2 - 14;
          expect(v.x > wx + 0.01 && v.x < wx + 1.99 && v.z > wz + 0.01 && v.z < wz + 1.99).toBe(false);
        }
      }
    }
    expect(sim.getVillagers().map((v) => [v.x, v.z])).not.toEqual(start);
  });

  it('moves a villager out when a wall is built on top of them', () => {
    const sim = makeSim([], 1);
    const v = only(sim);
    const cx = Math.floor((v.x + 14) / 2);
    const cz = Math.floor((v.z + 14) / 2);
    sim.setStructure(graphOf([[cx, 0, cz]]));
    expect(Math.floor((v.x + 14) / 2) === cx && Math.floor((v.z + 14) / 2) === cz).toBe(false);
  });
});

describe('VillageSim disasters', () => {
  it('runs villagers to the hut and keeps two of them safe through a medium disaster', () => {
    const sim = makeSim(HUT, 2);
    sim.startDisaster('medium');
    run(sim, 8);
    const vs = sim.getVillagers();
    expect(vs.every((v) => v.state === 'sheltered')).toBe(true);
    // three walls stop 90 % of the exposure damage
    expect(vs.every((v) => v.hp > VILLAGER_MAX_HP * 0.2)).toBe(true);
    expect(sim.firstDead()).toBeNull();
  });

  it('knocks out villagers who have no shelter (any death loses)', () => {
    const sim = makeSim([], 2);
    sim.startDisaster('medium');
    run(sim, 8);
    expect(sim.firstDead()).not.toBeNull();
  });

  it('only two villagers fit in one shelter cell; the third is left outside', () => {
    const sim = makeSim(HUT, 3);
    sim.startDisaster('medium');
    run(sim, 10);
    const vs = sim.getVillagers();
    expect(vs.filter((v) => v.state === 'sheltered')).toHaveLength(2);
    expect(vs.filter((v) => v.hp <= 0)).toHaveLength(1);
  });

  it('a gentle disaster hurts but does not knock out an exposed villager in 8 s', () => {
    const sim = makeSim([], 1);
    sim.startDisaster('gentle');
    run(sim, 8);
    const v = only(sim);
    expect(v.hp).toBeGreaterThan(0);
    expect(v.hp).toBeLessThan(VILLAGER_MAX_HP);
  });

  it('a fallen roof ends the protection', () => {
    const sim = makeSim(HUT, 1);
    sim.startDisaster('medium');
    run(sim, 1);
    sim.setFallen(new Set(['b:5,1,5']));
    run(sim, 8);
    expect(sim.firstDead()).not.toBeNull();
  });

  it('impacts hurt nearby villagers, and walls cut the damage', () => {
    const sim = makeSim(HUT, 1);
    const v = only(sim);
    sim.impact(v.x, v.z);
    expect(v.hp).toBe(VILLAGER_MAX_HP - 34);
    sim.impact(v.x + 20, v.z);
    expect(v.hp).toBe(VILLAGER_MAX_HP - 34);

    const inside = makeSim(HUT, 1);
    inside.startDisaster('gentle');
    for (let i = 0; i < 200 && only(inside).state !== 'sheltered'; i++) inside.update(1 / 30);
    const s = only(inside);
    expect(s.state).toBe('sheltered');
    const before = s.hp;
    inside.impact(s.x, s.z);
    expect(before - s.hp).toBeCloseTo(3.4, 5);
  });

  it('falling blocks hurt only villagers beneath them', () => {
    const sim = makeSim([], 1);
    const v = only(sim);
    sim.debris([[v.x + 10, 3, v.z]], 0.5);
    expect(v.hp).toBe(VILLAGER_MAX_HP);
    sim.debris([[v.x, 3, v.z]], 0.5);
    expect(v.hp).toBe(VILLAGER_MAX_HP - 25);
  });

  it('restoreAll heals everyone after a round', () => {
    const sim = makeSim([], 1);
    sim.startDisaster('strong');
    run(sim, 8);
    expect(sim.firstDead()).not.toBeNull();
    sim.endDisaster();
    sim.restoreAll();
    expect(sim.firstDead()).toBeNull();
    expect(sim.aliveCount()).toBe(1);
  });
});
