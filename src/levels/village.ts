/**
 * Village Island rules: shelter detection, bed capacity, round schedule and hazard numbers.
 * Pure & headless-safe: no three.js, Rapier or React imports.
 *
 * A *shelter cell* is an empty ground cell (x, 0, z) with a block directly above it (the roof, at
 * y = 1) and at least two solid walls among its four ground neighbours. Doors are openings, not
 * walls. Each shelter cell holds `BEDS_PER_SHELTER` villagers.
 */
import type { BlueprintGraph, BuildConstraints, Strength, Vec3 } from '../types/blueprint';
import { blockId, getGridCells } from '../types/blueprint';
import { getSurvivalWave, type SurvivalWaveDef } from './survival';

/** Block budget on the big island (the default 8x8 levels use 12-20). */
export const VILLAGE_CONSTRAINTS: BuildConstraints = { maxBlocks: 90 };
export const VILLAGER_MAX_HP = 100;
export const START_POPULATION = 3;
export const MAX_POPULATION = 12;
export const BEDS_PER_SHELTER = 2;
/** Villagers get this long after the disaster starts to reach a shelter before exposure bites. */
export const EXPOSURE_GRACE_SECONDS = 3.5;
/** Horizontal distance (world units) within which an impact or falling block can hurt a villager. */
export const IMPACT_RADIUS = 2.5;
export const IMPACT_DAMAGE = 34;
export const DEBRIS_RADIUS = 1.4;
export const DEBRIS_DPS = 50;
/** Villager HP lost per second while standing outside, by disaster strength (medium knocks out in ~4.5 s after the grace time). */
export const EXPOSURE_DPS: Record<Strength, number> = { gentle: 8, medium: 24, strong: 36 };
/** Players see a villager's HP bar when they are closer than this (world units). */
export const HP_BAR_RANGE = 9;

export interface ShelterCell {
  /** Ground cell column. */
  cell: [number, number];
  /** Block id of the roof directly above; the shelter is lost when it falls. */
  roofId: string;
  walls: number;
  beds: number;
}

/** Share of hazard damage a roofed shelter stops: a lean-to (2 walls) stops 60 %, 3+ walls stop 90 %. */
export function shelterProtection(walls: number): number {
  return walls >= 3 ? 0.9 : walls === 2 ? 0.6 : 0;
}

const NEIGHBOURS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const colKey = (x: number, z: number) => `${x},${z}`;

/** Ground-level cells (x,z) that villagers cannot walk through: any non-door ground block. */
export function blockedGroundCells(g: BlueprintGraph): Set<string> {
  const out = new Set<string>();
  for (const b of g.blocks)
    if (b.cell[1] === 0 && b.material !== 'door') out.add(colKey(b.cell[0], b.cell[2]));
  return out;
}

/** All shelter cells of a build, in deterministic (x, then z) order. */
export function findShelters(g: BlueprintGraph): ShelterCell[] {
  const byCell = new Map<string, string>();
  for (const b of g.blocks) byCell.set(`${b.cell[0]},${b.cell[1]},${b.cell[2]}`, b.material);
  const blocked = blockedGroundCells(g);
  const n = getGridCells();
  const out: ShelterCell[] = [];
  for (let x = 0; x < n; x++)
    for (let z = 0; z < n; z++) {
      if (blocked.has(colKey(x, z))) continue;
      const roof = byCell.get(`${x},1,${z}`);
      if (roof === undefined || roof === 'ladder') continue;
      const walls = NEIGHBOURS.filter(([dx, dz]) => blocked.has(colKey(x + dx, z + dz))).length;
      if (walls < 2) continue;
      const cell: Vec3 = [x, 1, z];
      out.push({ cell: [x, z], roofId: blockId(cell), walls, beds: BEDS_PER_SHELTER });
    }
  return out;
}

export const totalBeds = (shelters: readonly ShelterCell[]): number =>
  shelters.reduce((sum, s) => sum + s.beds, 0);

/** The disaster for village round `n`: the survival schedule, so rounds ramp up deterministically. */
export function getVillageRound(n: number): SurvivalWaveDef {
  return getSurvivalWave(n);
}

/** After a cleared round one new villager moves in if there is a spare bed (never above the cap). */
export function nextPopulation(population: number, beds: number): number {
  return beds > population && population < MAX_POPULATION ? population + 1 : population;
}

export const VILLAGE_KEY = 'disaster-village:village:v1';

/** Best round reached on Village Island (0 when none or storage is unavailable/corrupt). */
export function loadVillageBest(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): number {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(VILLAGE_KEY) ?? 'null');
    return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function saveVillageBest(
  round: number,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
): void {
  try {
    storage?.setItem(VILLAGE_KEY, JSON.stringify(round));
  } catch {
    // blocked storage: the best round just will not persist
  }
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
