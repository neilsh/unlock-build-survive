/**
 * Headless villager simulation for Village Island: deterministic wandering, running to shelter when a
 * disaster starts, and per-villager HP. No three.js, DOM or React, so it runs in Node tests.
 *
 * Villagers walk on the ground-level cell grid (cells with a non-door ground block are walls) and
 * follow shortest paths found by breadth-first search. All randomness comes from a seeded PRNG.
 */
import type { BlueprintGraph, Strength, Vec3 } from '../../types/blueprint';
import { CELL_SIZE, getGridCells, getIslandSize } from '../../types/blueprint';
import {
  DEBRIS_DPS,
  DEBRIS_RADIUS,
  EXPOSURE_DPS,
  EXPOSURE_GRACE_SECONDS,
  IMPACT_DAMAGE,
  IMPACT_RADIUS,
  VILLAGER_MAX_HP,
  blockedGroundCells,
  findShelters,
  shelterProtection,
  type ShelterCell,
} from '../../levels/village';
import { mulberry32 } from '../../utils/rng';

export type VillagerState = 'idle' | 'walk' | 'run' | 'sheltered' | 'down';

export interface Villager {
  id: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  state: VillagerState;
  /** Facing angle (radians, about +y). */
  heading: number;
  /** Index into the shelter list this villager is headed to or resting in, or -1. */
  shelter: number;
  path: Array<[number, number]>;
  /** Seconds left standing still before the next wander. */
  wait: number;
}

const WALK_SPEED = 1.6;
const RUN_SPEED = 5.5;
const WANDER_RANGE_STEPS = 5;
const WAIT_MIN = 0.8;
const WAIT_MAX = 3;

type Cell = [number, number];
const ck = (x: number, z: number) => `${x},${z}`;
const DIRS: readonly Cell[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class VillageSim {
  private rng: () => number;
  private villagers: Villager[] = [];
  private blocked = new Set<string>();
  private shelters: ShelterCell[] = [];
  private fallen: ReadonlySet<string> = new Set();
  private n = getGridCells();
  private disasterActive = false;
  private strength: Strength = 'medium';
  private disasterTime = 0;
  private nextId = 1;

  constructor(private readonly seed = 1) {
    this.rng = mulberry32(seed);
  }

  // ------------------------------------------------------------------ queries

  getVillagers(): readonly Villager[] {
    return this.villagers;
  }

  getShelters(): readonly ShelterCell[] {
    return this.shelters;
  }

  aliveCount(): number {
    return this.villagers.filter((v) => v.state !== 'down').length;
  }

  /** The first villager whose HP ran out, or null. Any death loses the village. */
  firstDead(): Villager | null {
    return this.villagers.find((v) => v.hp <= 0) ?? null;
  }

  /** True when the villager is resting in a shelter whose roof is still up. */
  isProtected(v: Villager): boolean {
    return v.state === 'sheltered' && this.shelterValid(v.shelter);
  }

  // ------------------------------------------------------------------ setup

  /** Starts a new population on free cells (call after `setStructure`). Resets HP and the PRNG. */
  reset(population: number): void {
    this.rng = mulberry32(this.seed);
    this.nextId = 1;
    this.disasterActive = false;
    this.villagers = [];
    this.addVillagers(population);
  }

  /** Adds villagers on free cells, up to `population` in total. */
  addVillagers(population: number): void {
    const free = this.freeCells();
    while (this.villagers.length < population && free.length > 0) {
      const i = Math.floor(this.rng() * free.length);
      const [cx, cz] = free.splice(i, 1)[0] ?? [0, 0];
      const [x, z] = this.cellCenter(cx, cz);
      this.villagers.push({
        id: this.nextId++,
        x,
        z,
        hp: VILLAGER_MAX_HP,
        maxHp: VILLAGER_MAX_HP,
        state: 'idle',
        heading: this.rng() * Math.PI * 2,
        shelter: -1,
        path: [],
        wait: WAIT_MIN + this.rng() * (WAIT_MAX - WAIT_MIN),
      });
    }
  }

  /** Heals everyone and stands them up (between rounds). */
  restoreAll(): void {
    for (const v of this.villagers) {
      v.hp = v.maxHp;
      v.state = 'idle';
      v.shelter = -1;
      v.path = [];
      v.wait = WAIT_MIN;
    }
    this.disasterActive = false;
  }

  /** Re-reads the build: walls, shelters and walkable cells. Villagers inside new walls are moved out. */
  setStructure(graph: BlueprintGraph): void {
    this.n = getGridCells();
    this.blocked = blockedGroundCells(graph);
    this.shelters = findShelters(graph);
    this.fallen = new Set();
    for (const v of this.villagers) {
      v.path = [];
      v.shelter = -1;
      if (v.state !== 'down') v.state = 'idle';
      const [cx, cz] = this.cellOf(v.x, v.z);
      if (!this.passable(cx, cz)) {
        const out = this.nearestFree(cx, cz);
        if (out) [v.x, v.z] = this.cellCenter(out[0], out[1]);
      }
    }
  }

  /** Blocks that fell during the run; a shelter whose roof fell stops protecting. */
  setFallen(ids: ReadonlySet<string>): void {
    this.fallen = ids;
  }

  // ------------------------------------------------------------------ disaster lifecycle

  startDisaster(strength: Strength): void {
    this.disasterActive = true;
    this.strength = strength;
    this.disasterTime = 0;
    for (const v of this.villagers) {
      v.shelter = -1;
      v.path = [];
      if (v.state !== 'down') v.state = 'idle';
    }
    this.assignShelters();
  }

  endDisaster(): void {
    this.disasterActive = false;
    for (const v of this.villagers) {
      if (v.state === 'sheltered' || v.state === 'run') v.state = 'idle';
      v.shelter = -1;
      v.path = [];
      v.wait = WAIT_MIN;
    }
  }

  // ------------------------------------------------------------------ hazards

  /** A projectile landed at world (x, z): hurts villagers within `IMPACT_RADIUS`, less if sheltered. */
  impact(x: number, z: number): void {
    for (const v of this.villagers) {
      if (v.state === 'down') continue;
      if (Math.hypot(v.x - x, v.z - z) <= IMPACT_RADIUS) this.hurt(v, IMPACT_DAMAGE);
    }
  }

  /** Airborne fallen blocks (world centres) hurt villagers beneath them. */
  debris(positions: readonly Vec3[], dt: number): void {
    for (const p of positions) {
      for (const v of this.villagers) {
        if (v.state === 'down') continue;
        if (Math.hypot(v.x - p[0], v.z - p[2]) <= DEBRIS_RADIUS) this.hurt(v, DEBRIS_DPS * dt);
      }
    }
  }

  private hurt(v: Villager, raw: number): void {
    const protection = this.isProtected(v) ? shelterProtection(this.shelters[v.shelter]?.walls ?? 0) : 0;
    v.hp = Math.max(0, v.hp - raw * (1 - protection));
    if (v.hp <= 0) {
      v.state = 'down';
      v.path = [];
    }
  }

  // ------------------------------------------------------------------ stepping

  update(dt: number): void {
    if (dt <= 0) return;
    if (this.disasterActive) {
      this.disasterTime += dt;
      if (this.disasterTime > EXPOSURE_GRACE_SECONDS) {
        const dps = EXPOSURE_DPS[this.strength];
        for (const v of this.villagers) if (v.state !== 'down') this.hurt(v, dps * dt);
      }
      // A roof that fell sends its sleepers looking for another bed.
      let lost = false;
      for (const v of this.villagers) {
        if (v.shelter >= 0 && !this.shelterValid(v.shelter) && v.state !== 'down') {
          v.shelter = -1;
          v.path = [];
          v.state = 'idle';
          lost = true;
        }
      }
      if (lost) this.assignShelters();
    }
    for (const v of this.villagers) {
      if (v.state === 'down' || v.state === 'sheltered') continue;
      this.step(v, dt);
    }
  }

  private step(v: Villager, dt: number): void {
    if (v.path.length === 0) {
      if (v.shelter >= 0 && this.atShelter(v)) {
        v.state = 'sheltered';
        const s = this.shelters[v.shelter];
        if (s) [v.x, v.z] = this.cellCenter(s.cell[0], s.cell[1]);
        return;
      }
      v.state = 'idle';
      v.wait -= dt;
      if (v.wait <= 0) this.pickWander(v);
      return;
    }
    const speed = this.disasterActive ? RUN_SPEED : WALK_SPEED;
    v.state = this.disasterActive ? 'run' : 'walk';
    let budget = speed * dt;
    while (budget > 1e-9 && v.path.length > 0) {
      const [tx, tz] = this.cellCenter(...(v.path[0] ?? [0, 0]));
      const dx = tx - v.x;
      const dz = tz - v.z;
      const d = Math.hypot(dx, dz);
      v.heading = Math.atan2(dx, dz);
      if (d <= budget) {
        v.x = tx;
        v.z = tz;
        budget -= d;
        v.path.shift();
      } else {
        v.x += (dx / d) * budget;
        v.z += (dz / d) * budget;
        budget = 0;
      }
    }
    if (v.path.length === 0) {
      if (v.shelter >= 0 && this.atShelter(v)) {
        v.state = 'sheltered';
      } else {
        v.state = 'idle';
        v.wait = WAIT_MIN + this.rng() * (WAIT_MAX - WAIT_MIN);
      }
    }
  }

  private pickWander(v: Villager): void {
    const [sx, sz] = this.cellOf(v.x, v.z);
    const reach = this.reachable(sx, sz, WANDER_RANGE_STEPS);
    if (reach.length === 0) {
      v.wait = WAIT_MAX;
      return;
    }
    const goal = reach[Math.floor(this.rng() * reach.length)] ?? reach[0];
    if (!goal) return;
    v.path = this.pathTo(sx, sz, (x, z) => x === goal[0] && z === goal[1]) ?? [];
    v.wait = WAIT_MIN + this.rng() * (WAIT_MAX - WAIT_MIN);
  }

  // ------------------------------------------------------------------ shelter assignment

  private shelterValid(i: number): boolean {
    const s = this.shelters[i];
    return s !== undefined && !this.fallen.has(s.roofId);
  }

  private occupancy(i: number): number {
    return this.villagers.filter((v) => v.shelter === i && v.state !== 'down').length;
  }

  private atShelter(v: Villager): boolean {
    const s = this.shelters[v.shelter];
    if (!s) return false;
    const [cx, cz] = this.cellOf(v.x, v.z);
    return cx === s.cell[0] && cz === s.cell[1];
  }

  /** Sends every shelterless villager (in id order) to the nearest reachable shelter with a free bed. */
  private assignShelters(): void {
    for (const v of this.villagers) {
      if (v.state === 'down' || v.shelter >= 0) continue;
      const [sx, sz] = this.cellOf(v.x, v.z);
      const open = (x: number, z: number): number => {
        const i = this.shelters.findIndex((s) => s.cell[0] === x && s.cell[1] === z);
        return i >= 0 && this.shelterValid(i) && this.occupancy(i) < (this.shelters[i]?.beds ?? 0) ? i : -1;
      };
      let found = -1;
      const path = this.pathTo(sx, sz, (x, z) => {
        const i = open(x, z);
        if (i >= 0) found = i;
        return i >= 0;
      });
      if (path && found >= 0) {
        v.shelter = found;
        v.path = path;
        v.state = path.length === 0 ? 'sheltered' : 'run';
        if (path.length === 0) {
          const s = this.shelters[found];
          if (s) [v.x, v.z] = this.cellCenter(s.cell[0], s.cell[1]);
        }
      } else {
        // No bed within reach: panic around instead.
        v.wait = 0;
        this.pickWander(v);
      }
    }
  }

  // ------------------------------------------------------------------ grid helpers

  private cellCenter(cx: number, cz: number): Cell {
    const half = getIslandSize() / 2;
    return [cx * CELL_SIZE - half + CELL_SIZE / 2, cz * CELL_SIZE - half + CELL_SIZE / 2];
  }

  private cellOf(x: number, z: number): Cell {
    const half = getIslandSize() / 2;
    const clamp = (c: number) => Math.min(this.n - 1, Math.max(0, c));
    return [clamp(Math.floor((x + half) / CELL_SIZE)), clamp(Math.floor((z + half) / CELL_SIZE))];
  }

  private passable(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.n && cz < this.n && !this.blocked.has(ck(cx, cz));
  }

  private freeCells(): Cell[] {
    const out: Cell[] = [];
    for (let x = 0; x < this.n; x++)
      for (let z = 0; z < this.n; z++) if (this.passable(x, z)) out.push([x, z]);
    return out;
  }

  private nearestFree(cx: number, cz: number): Cell | null {
    const seen = new Set([ck(cx, cz)]);
    const queue: Cell[] = [[cx, cz]];
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i] ?? [0, 0];
      if (this.passable(x, z)) return [x, z];
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.n || nz >= this.n || seen.has(ck(nx, nz))) continue;
        seen.add(ck(nx, nz));
        queue.push([nx, nz]);
      }
    }
    return null;
  }

  /** Cells reachable from (sx, sz) within `steps` moves, excluding the start. */
  private reachable(sx: number, sz: number, steps: number): Cell[] {
    const dist = new Map<string, number>([[ck(sx, sz), 0]]);
    const queue: Cell[] = [[sx, sz]];
    const out: Cell[] = [];
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i] ?? [0, 0];
      const d = dist.get(ck(x, z)) ?? 0;
      if (d >= steps) continue;
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.passable(nx, nz) || dist.has(ck(nx, nz))) continue;
        dist.set(ck(nx, nz), d + 1);
        queue.push([nx, nz]);
        out.push([nx, nz]);
      }
    }
    return out;
  }

  /** Shortest path (excluding the start cell) to the first cell satisfying `isGoal`; null if none. */
  private pathTo(sx: number, sz: number, isGoal: (x: number, z: number) => boolean): Cell[] | null {
    if (isGoal(sx, sz)) return [];
    const prev = new Map<string, Cell | null>([[ck(sx, sz), null]]);
    const queue: Cell[] = [[sx, sz]];
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i] ?? [0, 0];
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.passable(nx, nz) || prev.has(ck(nx, nz))) continue;
        prev.set(ck(nx, nz), [x, z]);
        if (isGoal(nx, nz)) {
          const path: Cell[] = [];
          let cur: Cell | null | undefined = [nx, nz];
          while (cur && !(cur[0] === sx && cur[1] === sz)) {
            path.unshift(cur);
            cur = prev.get(ck(cur[0], cur[1]));
          }
          return path;
        }
        queue.push([nx, nz]);
      }
    }
    return null;
  }
}
