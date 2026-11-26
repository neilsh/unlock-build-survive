/**
 * Headless sim for the Village Explore Mode builder crew: four quick-builders who live on the island,
 * wander around, and walk to a freshly loaded quick-build to hammer on it. They never get hurt.
 * No three.js, DOM or React, so it runs in Node tests. All randomness comes from a seeded PRNG.
 */
import { blockedGroundCells } from '../../levels/village';
import type { BlueprintGraph } from '../../types/blueprint';
import { CELL_SIZE, getGridCells, getIslandSize } from '../../types/blueprint';
import { mulberry32 } from '../../utils/rng';

export type BuilderState = 'idle' | 'walk' | 'build';

export interface Builder {
  id: number;
  x: number;
  z: number;
  /** Facing angle (radians, about +y). */
  heading: number;
  state: BuilderState;
  path: Array<[number, number]>;
  /** Seconds left standing still before the next wander. */
  wait: number;
  /** Seconds of hammering left at the build site (0 when not building). */
  buildLeft: number;
}

/** Explore Mode keeps exactly four builders on the Village island. */
export const BUILDER_COUNT = 4;
const WALK_SPEED = 2.4;
const BUILD_SECONDS = 4;
const WANDER_RANGE_STEPS = 4;
const WAIT_MIN = 1;
const WAIT_MAX = 3.5;

type Cell = [number, number];
const ck = (x: number, z: number) => `${x},${z}`;
const DIRS: readonly Cell[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class BuilderCrew {
  private rng: () => number;
  private builders: Builder[] = [];
  private blocked = new Set<string>();
  private n = getGridCells();

  constructor(private readonly seed = 11) {
    this.rng = mulberry32(seed);
  }

  getBuilders(): readonly Builder[] {
    return this.builders;
  }

  /** Puts the crew back at its camp near the island's corner (call after `setStructure`). */
  reset(): void {
    this.rng = mulberry32(this.seed);
    this.builders = [];
    const free = this.freeCells()
      .map((c) => ({ c, d: Math.hypot(c[0] - 1, c[1] - 1) }))
      .toSorted((a, b) => a.d - b.d || a.c[0] - b.c[0] || a.c[1] - b.c[1]);
    for (let i = 0; i < BUILDER_COUNT; i++) {
      const [cx, cz] = free[i]?.c ?? [0, 0];
      const [x, z] = this.cellCenter(cx, cz);
      this.builders.push({
        id: i + 1,
        x,
        z,
        heading: this.rng() * Math.PI * 2,
        state: 'idle',
        path: [],
        wait: WAIT_MIN + this.rng() * (WAIT_MAX - WAIT_MIN),
        buildLeft: 0,
      });
    }
  }

  /**
   * Re-reads the walls. Builders inside new walls step out. With `announce`, and a non-empty build,
   * the crew walks over and hammers on it (a quick-builder was just loaded).
   */
  setStructure(graph: BlueprintGraph, announce = false): void {
    this.n = getGridCells();
    this.blocked = blockedGroundCells(graph);
    for (const b of this.builders) {
      b.path = [];
      b.buildLeft = 0;
      b.state = 'idle';
      const [cx, cz] = this.cellOf(b.x, b.z);
      if (!this.passable(cx, cz)) {
        const out = this.nearestFree(cx, cz);
        if (out) [b.x, b.z] = this.cellCenter(out[0], out[1]);
      }
    }
    if (announce && graph.blocks.length > 0) this.startJob(graph);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const b of this.builders) this.step(b, dt);
  }

  // ------------------------------------------------------------------ job

  private startJob(graph: BlueprintGraph): void {
    const footprint = new Set<string>();
    let sx = 0;
    let sz = 0;
    for (const bl of graph.blocks) {
      footprint.add(ck(bl.cell[0], bl.cell[2]));
      sx += bl.cell[0];
      sz += bl.cell[2];
    }
    const mx = sx / graph.blocks.length;
    const mz = sz / graph.blocks.length;
    const spots: Cell[] = [];
    for (let x = 0; x < this.n; x++)
      for (let z = 0; z < this.n; z++) {
        if (!this.passable(x, z) || footprint.has(ck(x, z))) continue;
        if (DIRS.some(([dx, dz]) => footprint.has(ck(x + dx, z + dz)))) spots.push([x, z]);
      }
    if (spots.length === 0) return;
    const [wx, wz] = this.cellCenter(mx, mz);
    // Spread out: each builder takes the free spot nearest the build that nobody else claimed.
    const taken = new Set<number>();
    for (const b of this.builders) {
      const [bx, bz] = this.cellOf(b.x, b.z);
      let best = -1;
      let bestD = Infinity;
      spots.forEach(([x, z], i) => {
        if (taken.has(i)) return;
        const d = Math.hypot(x - bx, z - bz) * 0.5 + Math.hypot(x - mx, z - mz);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0) best = taken.size % spots.length;
      taken.add(best);
      const goal = spots[best] ?? spots[0];
      if (!goal) continue;
      const path = this.pathTo(bx, bz, (x, z) => x === goal[0] && z === goal[1]);
      if (!path) continue;
      b.path = path;
      b.state = path.length > 0 ? 'walk' : 'build';
      b.buildLeft = BUILD_SECONDS;
      b.heading = Math.atan2(wx - b.x, wz - b.z);
    }
  }

  // ------------------------------------------------------------------ stepping

  private step(b: Builder, dt: number): void {
    if (b.path.length > 0) {
      b.state = 'walk';
      this.walk(b, dt);
      if (b.path.length === 0 && b.buildLeft > 0) b.state = 'build';
      else if (b.path.length === 0) this.settle(b);
      return;
    }
    if (b.buildLeft > 0) {
      b.state = 'build';
      b.buildLeft -= dt;
      if (b.buildLeft <= 0) {
        b.buildLeft = 0;
        this.settle(b);
      }
      return;
    }
    b.state = 'idle';
    b.wait -= dt;
    if (b.wait <= 0) this.pickWander(b);
  }

  private settle(b: Builder): void {
    b.state = 'idle';
    b.wait = WAIT_MIN + this.rng() * (WAIT_MAX - WAIT_MIN);
  }

  private walk(b: Builder, dt: number): void {
    let budget = WALK_SPEED * dt;
    while (budget > 1e-9 && b.path.length > 0) {
      const [tx, tz] = this.cellCenter(...(b.path[0] ?? [0, 0]));
      const dx = tx - b.x;
      const dz = tz - b.z;
      const d = Math.hypot(dx, dz);
      b.heading = Math.atan2(dx, dz);
      if (d <= budget) {
        b.x = tx;
        b.z = tz;
        budget -= d;
        b.path.shift();
      } else {
        b.x += (dx / d) * budget;
        b.z += (dz / d) * budget;
        budget = 0;
      }
    }
  }

  private pickWander(b: Builder): void {
    const [sx, sz] = this.cellOf(b.x, b.z);
    const reach = this.reachable(sx, sz, WANDER_RANGE_STEPS);
    b.wait = WAIT_MIN + this.rng() * (WAIT_MAX - WAIT_MIN);
    const goal = reach[Math.floor(this.rng() * reach.length)];
    if (!goal) return;
    b.path = this.pathTo(sx, sz, (x, z) => x === goal[0] && z === goal[1]) ?? [];
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
