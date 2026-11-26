/**
 * Pure, serializable blueprint data. No three.js, Rapier or React imports allowed here.
 *
 * Coordinate conventions (shared by every engine module):
 *  - A block occupies one integer "cell" (cx, cy, cz). Cells are CELL_SIZE (2) world units wide.
 *  - cx and cz run 0..GRID_CELLS-1 across the island; cy runs 0..MAX_HEIGHT_CELLS-1 upward.
 *  - The island is centred on the world origin, with its top surface at world y = 0.
 *  - Strut endpoints are integer "corner" lattice points (kx, ky, kz). A block at cell (cx, cy, cz)
 *    has its 8 corners at (cx..cx+1, cy..cy+1, cz..cz+1). Corner (0,0,0) is the island's -x/-z edge.
 *  - Spatial hash keys are the strings "x,y,z" (see `key`).
 */

export type Vec3 = [number, number, number];

export type BuiltinMaterialType =
  | 'wood'
  | 'stone'
  | 'bamboo'
  | 'foam'
  | 'door'
  | 'ladder'
  | 'rubber'
  | 'anchor'
  | 'pontoon'
  | 'steel'
  | 'carbon'
  | 'shield'
  | 'titanium'
  | 'laser'
  | 'magnet'
  | 'diamond'
  | 'beaver'
  | 'owl'
  | 'spider';
export type MaterialType = BuiltinMaterialType | (string & {});

export type BuiltinDisasterType =
  | 'earthquake'
  | 'hurricane'
  | 'flood'
  | 'hail'
  | 'fire_tornado'
  | 'snow_storm'
  | 'raid'
  | 'meteor';
export type DisasterType = BuiltinDisasterType | (string & {});

export type ProjectileKind = 'hail' | 'fireball' | 'snowball' | 'raider' | 'meteor' | 'custom';
export type ToolType = 'block' | 'brace' | 'paint' | 'erase';
/** Camera azimuth presets in degrees: 0 = front (looking toward -z), 90 = right, 180 = back, 270 = left. */
export type Azimuth = 0 | 90 | 180 | 270;

export const CELL_SIZE = 2;
/** 16x16 world-unit build area = 8x8 cells. This is the default island; see `setIslandCells`. */
export const GRID_CELLS = 8;
export const MAX_HEIGHT_CELLS = 8;
export const ISLAND_SIZE = GRID_CELLS * CELL_SIZE;
/** The bigger Village Island: 14x14 cells (28x28 world units), roughly three times the build area. */
export const VILLAGE_GRID_CELLS = 14;

/**
 * Active build-area width in cells. Every level and mode uses the default 8x8 island except Village
 * Island, which switches it for the session. Engine and helpers read the island through the getters
 * below so the default island behaves exactly as before.
 */
let activeCells = GRID_CELLS;

/** Switches the active island size (clamped to 4..24 whole cells). */
export function setIslandCells(cells: number): void {
  activeCells = Number.isFinite(cells) ? Math.min(24, Math.max(4, Math.round(cells))) : GRID_CELLS;
}

/** Active island width in cells (GRID_CELLS unless Village Island is running). */
export const getGridCells = (): number => activeCells;

/** Active island width in world units. */
export const getIslandSize = (): number => activeCells * CELL_SIZE;
/** Length of every disaster run, in seconds. Survive this long with zero broken joints to win. */
export const DISASTER_SECONDS = 8;

export const DISASTER_ORDER: BuiltinDisasterType[] = [
  'earthquake',
  'hurricane',
  'flood',
  'hail',
  'fire_tornado',
  'snow_storm',
  'raid',
  'meteor',
];

const BUILTIN_DISASTER_SET = new Set<string>(DISASTER_ORDER);

export function isBuiltinDisaster(d: string): d is BuiltinDisasterType {
  return BUILTIN_DISASTER_SET.has(d);
}

export interface BlockData {
  /** Deterministic id: `b:cx,cy,cz` (see `blockId`). */
  id: string;
  cell: Vec3;
  material: MaterialType;
}

export interface StrutData {
  /** Deterministic id: `s:ax,ay,az-bx,by,bz` with endpoints sorted (see `strutId`). */
  id: string;
  a: Vec3;
  b: Vec3;
  material: MaterialType;
}

/**
 * Validity rules (enforced by BuildController, assumed by PhysicsSim):
 *  - Block cells are in bounds and unique. Blocks may float: anything not connected to the ground
 *    simply falls when the simulation starts.
 *  - Strut endpoints are in bounds, distinct, and each one is either a corner of at least one block
 *    or on the ground (ky = 0). See `isStrutValid`.
 *  - Physics attaches each strut end to the first block from `blocksAtCorner` (sorted by id, so
 *    deterministic), or to the island anchor when no block has that corner.
 */
export interface BlueprintGraph {
  version: 1;
  blocks: BlockData[];
  struts: StrutData[];
}

export type BasePresetName = 'empty' | 'house' | 'tower' | 'bridge';
export type UnlockablePresetName =
  | 'pyramid'
  | 'boat'
  | 'treehouse'
  | 'base'
  | 'laser_tower'
  | 'dome'
  | 'fortress';
export type PresetName = BasePresetName | UnlockablePresetName;

export interface PresetDef {
  id: PresetName;
  label: string;
  color: number;
  cost?: number;
  description?: string;
  badges?: readonly string[];
}

// ---------------------------------------------------------------- helpers

export const key = (v: Vec3) => `${v[0]},${v[1]},${v[2]}`;
export const blockId = (cell: Vec3) => `b:${key(cell)}`;

export function strutId(a: Vec3, b: Vec3) {
  const [p, q] = key(a) <= key(b) ? [a, b] : [b, a];
  return `s:${key(p)}-${key(q)}`;
}

export const cellInBounds = (c: Vec3) =>
  c[0] >= 0 && c[0] < activeCells && c[2] >= 0 && c[2] < activeCells && c[1] >= 0 && c[1] < MAX_HEIGHT_CELLS;

export const cornerInBounds = (k: Vec3) =>
  k[0] >= 0 &&
  k[0] <= activeCells &&
  k[2] >= 0 &&
  k[2] <= activeCells &&
  k[1] >= 0 &&
  k[1] <= MAX_HEIGHT_CELLS;

/** World-space centre of a cell. */
export function cellToWorld(c: Vec3): Vec3 {
  const half = getIslandSize() / 2;
  return [
    c[0] * CELL_SIZE - half + CELL_SIZE / 2,
    c[1] * CELL_SIZE + CELL_SIZE / 2,
    c[2] * CELL_SIZE - half + CELL_SIZE / 2,
  ];
}

/** World-space position of a corner lattice point. */
export function cornerToWorld(k: Vec3): Vec3 {
  const half = getIslandSize() / 2;
  return [k[0] * CELL_SIZE - half, k[1] * CELL_SIZE, k[2] * CELL_SIZE - half];
}

/** The 8 corner lattice points of a cell. */
export function cellCorners(c: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const dx of [0, 1])
    for (const dy of [0, 1]) for (const dz of [0, 1]) out.push([c[0] + dx, c[1] + dy, c[2] + dz]);
  return out;
}

/** Mirror across the island's centre plane x = ISLAND_SIZE/2 (used by mirror-X build mode). */
export const mirrorCellX = (c: Vec3): Vec3 => [activeCells - 1 - c[0], c[1], c[2]];
export const mirrorCornerX = (k: Vec3): Vec3 => [activeCells - k[0], k[1], k[2]];

/** Inverse of `cellToWorld` for ground positions: the cell column (x, z) containing world (wx, wz). */
export function worldToCell(wx: number, wz: number): [number, number] {
  const half = getIslandSize() / 2;
  return [Math.floor((wx + half) / CELL_SIZE), Math.floor((wz + half) / CELL_SIZE)];
}

/** Blocks that have corner `k` as one of their 8 corners, sorted by id. */
export function blocksAtCorner(g: BlueprintGraph, k: Vec3): BlockData[] {
  return g.blocks
    .filter(
      (b) =>
        [0, 1].includes(k[0] - b.cell[0]) &&
        [0, 1].includes(k[1] - b.cell[1]) &&
        [0, 1].includes(k[2] - b.cell[2]),
    )
    .toSorted((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

/** True when a strut a-b obeys the validity rules above against graph `g`. */
export function isStrutValid(g: BlueprintGraph, a: Vec3, b: Vec3): boolean {
  if (!cornerInBounds(a) || !cornerInBounds(b) || key(a) === key(b)) return false;
  const anchored = (k: Vec3) => k[1] === 0 || blocksAtCorner(g, k).length > 0;
  return anchored(a) && anchored(b);
}

export function emptyGraph(): BlueprintGraph {
  return { version: 1, blocks: [], struts: [] };
}

export const cloneGraph = (g: BlueprintGraph): BlueprintGraph => ({
  version: g.version,
  blocks: g.blocks.map((b) => ({ id: b.id, cell: [...b.cell], material: b.material })),
  struts: g.struts.map((s) => ({ id: s.id, a: [...s.a], b: [...s.b], material: s.material })),
});

// ---------------------------------------------------------------- telemetry & debug API

/**
 * build: editing. simulating: disaster running. Once the 8 s countdown ends the sim stops stepping
 * and the mode becomes survived (zero broken joints) or failed (at least one). Rewind -> build.
 */
export type GameMode = 'build' | 'simulating' | 'survived' | 'failed';

/** Build limits imposed by a challenge level. Omitted fields mean "no limit". */
export interface BuildConstraints {
  maxBlocks?: number;
  /** Materials the player may use; omitted means all. */
  materials?: readonly MaterialType[];
}

/** How hard a disaster hits. Medium is the calibrated baseline (tower fails, starter house survives). */
export type Strength = 'gentle' | 'medium' | 'strong';
export const STRENGTH_ORDER: readonly Strength[] = ['gentle', 'medium', 'strong'];
export const DEFAULT_STRENGTH: Strength = 'medium';

/** 3 = not a single joint broke; else 2 at >= 80 % standing, 1 at >= 50 %, 0 below (see starsFor). */
export type Stars = 0 | 1 | 2 | 3;

export interface Telemetry {
  mode: GameMode;
  timeRemaining: number;
  /** Strength of the current (or next) disaster. */
  strength: Strength;
  /**
   * Fraction (0..1) of pieces (blocks and struts) still standing: still held by an intact joint and
   * not displaced from where they started. 1 while building. Basis of the star rating.
   */
  standingRatio: number;
  /** Star rating of the run so far; only final once mode is survived or failed. 0 while building. */
  stars: Stars;
  blockCount: number;
  strutCount: number;
  activeJoints: number;
  brokenJoints: number;
  firstBrokenId: string | null;
  waterLevel: number;
}

export interface GameDebugApi {
  loadPreset(name: PresetName): void;
  /** Returns false if the cell is out of bounds or occupied. */
  placeBlock(x: number, y: number, z: number, material: MaterialType): boolean;
  /** Returns false if the strut is invalid (see `isStrutValid`) or already exists. */
  addStrut(a: Vec3, b: Vec3, material: MaterialType): boolean;
  getGraph(): BlueprintGraph;
  setCameraAzimuth(degrees: Azimuth): void;
  /** Resolves once Rapier is initialised and the first step can run. */
  startDisaster(type: DisasterType, seed?: number, strength?: Strength): Promise<void>;
  rewind(): void;
  /**
   * Runs a started disaster up to `seconds` of sim time ahead synchronously, in the same fixed steps
   * the frame loop would take, and returns the telemetry afterwards. Stops early when the run ends.
   * Lets tests finish a run without waiting on (slow, software-rendered) frames.
   */
  advance(seconds: number): Telemetry;
  getTelemetry(): Telemetry;
}

declare global {
  interface Window {
    __GAME_DEBUG__?: GameDebugApi;
  }
}
