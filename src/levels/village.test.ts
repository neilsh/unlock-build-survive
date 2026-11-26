import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GRID_CELLS, VILLAGE_GRID_CELLS, setIslandCells } from '../types/blueprint';
import {
  MAX_POPULATION,
  VILLAGE_KEY,
  findShelters,
  getVillageRound,
  loadVillageBest,
  nextPopulation,
  saveVillageBest,
  shelterProtection,
  totalBeds,
} from './village';
import { HUT, graphOf } from './villageFixtures';

beforeEach(() => setIslandCells(VILLAGE_GRID_CELLS));
afterEach(() => setIslandCells(GRID_CELLS));

describe('findShelters', () => {
  it('finds a roofed cell with three walls and gives it two beds', () => {
    const s = findShelters(graphOf(HUT));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ cell: [5, 5], roofId: 'b:5,1,5', walls: 3, beds: 2 });
    expect(totalBeds(s)).toBe(2);
  });

  it('needs a roof and at least two walls', () => {
    expect(findShelters(graphOf(HUT.slice(0, 3)))).toEqual([]);
    expect(
      findShelters(
        graphOf([
          [4, 0, 5],
          [5, 1, 5],
        ]),
      ),
    ).toEqual([]);
    expect(
      findShelters(
        graphOf([
          [4, 0, 5],
          [6, 0, 5],
          [5, 1, 5],
        ]),
      ),
    ).toHaveLength(1);
  });

  it('treats doors as openings, not walls, and ladders as no roof', () => {
    const door = graphOf([
      [4, 0, 5],
      [6, 0, 5, 'door'],
      [5, 0, 4, 'door'],
      [5, 1, 5],
    ]);
    expect(findShelters(door)).toEqual([]);
    const ladder = graphOf([
      [4, 0, 5],
      [6, 0, 5],
      [5, 1, 5, 'ladder'],
    ]);
    expect(findShelters(ladder)).toEqual([]);
  });

  it('counts every roofed interior cell of a bigger house', () => {
    const rows: Array<[number, number, number]> = [];
    for (let x = 3; x <= 6; x++) for (const z of [3, 6]) rows.push([x, 0, z]);
    for (const z of [4, 5]) for (const x of [3, 6]) rows.push([x, 0, z]);
    for (let x = 3; x <= 6; x++) for (let z = 3; z <= 6; z++) rows.push([x, 1, z]);
    const shelters = findShelters(graphOf(rows));
    expect(shelters.map((s) => s.cell)).toEqual([
      [4, 4],
      [4, 5],
      [5, 4],
      [5, 5],
    ]);
  });
});

describe('village rules', () => {
  it('walls stop most damage', () => {
    expect(shelterProtection(0)).toBe(0);
    expect(shelterProtection(2)).toBeLessThan(shelterProtection(3));
    expect(shelterProtection(4)).toBe(0.9);
  });

  it('a newcomer moves in only with a spare bed, up to the cap', () => {
    expect(nextPopulation(3, 2)).toBe(3);
    expect(nextPopulation(3, 4)).toBe(4);
    expect(nextPopulation(MAX_POPULATION, 99)).toBe(MAX_POPULATION);
  });

  it('rounds follow the deterministic survival schedule', () => {
    expect(getVillageRound(1).strength).toBe('gentle');
    expect(getVillageRound(7)).toEqual(getVillageRound(7));
  });

  it('persists the best round and survives bad storage', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    expect(loadVillageBest(storage)).toBe(0);
    saveVillageBest(4, storage);
    expect(data.get(VILLAGE_KEY)).toBe('4');
    expect(loadVillageBest(storage)).toBe(4);
    data.set(VILLAGE_KEY, 'nonsense');
    expect(loadVillageBest(storage)).toBe(0);
    expect(() =>
      saveVillageBest(2, {
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
  });
});
