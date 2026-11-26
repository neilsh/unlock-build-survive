import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HUT, graphOf } from '../../levels/villageFixtures';
import { blockedGroundCells } from '../../levels/village';
import { GRID_CELLS, VILLAGE_GRID_CELLS, getIslandSize, setIslandCells } from '../../types/blueprint';
import { BUILDER_COUNT, BuilderCrew } from './BuilderCrew';

beforeEach(() => setIslandCells(VILLAGE_GRID_CELLS));
afterEach(() => setIslandCells(GRID_CELLS));

const run = (crew: BuilderCrew, seconds: number, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) crew.update(dt);
};

function makeCrew(seed = 11) {
  const crew = new BuilderCrew(seed);
  crew.setStructure(graphOf([]));
  crew.reset();
  return crew;
}

const states = (c: BuilderCrew) => c.getBuilders().map((b) => b.state);
const positions = (c: BuilderCrew) => c.getBuilders().map((b) => [b.x, b.z]);

describe('BuilderCrew', () => {
  it('has exactly four builders, all on the island', () => {
    const crew = makeCrew();
    expect(crew.getBuilders()).toHaveLength(BUILDER_COUNT);
    expect(BUILDER_COUNT).toBe(4);
    const half = getIslandSize() / 2;
    for (const b of crew.getBuilders()) {
      expect(Math.abs(b.x)).toBeLessThan(half);
      expect(Math.abs(b.z)).toBeLessThan(half);
    }
  });

  it('stays at four and wanders around while nothing is being built', () => {
    const crew = makeCrew();
    const before = positions(crew);
    run(crew, 30);
    expect(crew.getBuilders()).toHaveLength(4);
    expect(positions(crew)).not.toEqual(before);
  });

  it('is deterministic for the same seed', () => {
    const a = makeCrew(5);
    const b = makeCrew(5);
    run(a, 20);
    run(b, 20);
    expect(positions(a)).toEqual(positions(b));
  });

  it('walks over to a new quick-build, hammers on it, then goes back to wandering', () => {
    const crew = makeCrew();
    crew.setStructure(graphOf(HUT), true);
    expect(states(crew).every((s) => s === 'walk' || s === 'build')).toBe(true);
    run(crew, 60);
    // Done by now: nobody is stuck hammering.
    expect(states(crew).every((s) => s !== 'build')).toBe(true);
    expect(crew.getBuilders()).toHaveLength(4);
  });

  it('every builder reaches the site and builds before finishing', () => {
    const crew = makeCrew();
    crew.setStructure(graphOf(HUT), true);
    const built = new Set<number>();
    for (let t = 0; t < 40; t += 1 / 30) {
      crew.update(1 / 30);
      for (const b of crew.getBuilders()) if (b.state === 'build') built.add(b.id);
    }
    expect(built.size).toBe(4);
  });

  it('does nothing special when the build is empty (Clear)', () => {
    const crew = makeCrew();
    crew.setStructure(graphOf([]), true);
    expect(states(crew).every((s) => s === 'idle')).toBe(true);
  });

  it('never walks through walls', () => {
    const crew = makeCrew();
    const graph = graphOf(HUT);
    crew.setStructure(graph, true);
    const walls = blockedGroundCells(graph);
    const half = getIslandSize() / 2;
    for (let t = 0; t < 60; t += 1 / 30) {
      crew.update(1 / 30);
      for (const b of crew.getBuilders()) {
        const key = `${Math.floor((b.x + half) / 2)},${Math.floor((b.z + half) / 2)}`;
        expect(walls.has(key)).toBe(false);
      }
    }
  });

  it('steps builders out of a wall that appears on top of them', () => {
    const crew = makeCrew();
    const b0 = crew.getBuilders()[0];
    if (!b0) throw new Error('no builder');
    const half = getIslandSize() / 2;
    const cx = Math.floor((b0.x + half) / 2);
    const cz = Math.floor((b0.z + half) / 2);
    crew.setStructure(graphOf([[cx, 0, cz, 'stone']]));
    const key = `${Math.floor((b0.x + half) / 2)},${Math.floor((b0.z + half) / 2)}`;
    expect(key).not.toBe(`${cx},${cz}`);
  });
});
