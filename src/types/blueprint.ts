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
  | 'rubber'
  | 'anchor'
  | 'pontoon'
  | 'steel'
  | 'carbon'
  | 'shield'
  | 'titanium'
  | 'laser'
  | 'magnet'
  | 'diamond';
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
/** 16x16 world-unit build area = 8x8 cells. */
export const GRID_CELLS = 8;
export const MAX_HEIGHT_CELLS = 8;
export const ISLAND_SIZE = GRID_CELLS * CELL_SIZE;
/** Length of every disaster run, in seconds. Survive this long with zero broken joints to win. */
export const DISASTER_SECONDS = 8;

export interface MaterialDef {
  id: MaterialType;
  label: string;
  /** Base colour (also used to paint the procedural texture). */
  color: number;
  /** Mass per unit volume, relative units. */
  density: number;
  /** Joint spring stiffness multiplier. */
  stiffness: number;
  /**
   * Break threshold. Strain ratio = joint stretch / (maxStress * a stretch unit owned by
   * PhysicsSim). Tuned by the physics package; the values here are starting points.
   */
  maxStress: number;
  /** 0 = sinks, 1 = neutrally buoyant, >1 floats. */
  buoyancy: number;
  /** Point cost in the unlock shop; omitted means unlocked from the start. */
  cost?: number;
  /** Shop filter category for unlockable items. */
  shopCategory?: 'structural' | 'defense';
  /** Short kid-friendly shop description. */
  description?: string;
  /** Multiplier applied to foundation anchor break limits for ground blocks. */
  anchorMultiplier?: number;
  /** Active defense behaviour during a disaster. */
  special?: 'shield' | 'laser';
}

export const MATERIALS: Record<BuiltinMaterialType, MaterialDef> = {
  wood: {
    id: 'wood',
    label: 'Wood',
    color: 0xc58b4c,
    density: 0.6,
    stiffness: 1.0,
    maxStress: 1.0,
    buoyancy: 1.3,
  },
  stone: {
    id: 'stone',
    label: 'Stone',
    color: 0x9aa0a8,
    density: 2.0,
    stiffness: 1.6,
    maxStress: 1.6,
    buoyancy: 0.0,
  },
  bamboo: {
    id: 'bamboo',
    label: 'Bamboo',
    color: 0x9ccc65,
    density: 0.45,
    stiffness: 0.7,
    maxStress: 1.3,
    buoyancy: 1.4,
  },
  foam: {
    id: 'foam',
    label: 'Foam',
    color: 0xf8bbd0,
    density: 0.15,
    stiffness: 0.3,
    maxStress: 0.5,
    buoyancy: 3.0,
  },
  rubber: {
    id: 'rubber',
    label: 'Rubber',
    color: 0xff7043,
    density: 0.7,
    stiffness: 0.45,
    maxStress: 2.2,
    buoyancy: 1.5,
    cost: 100,
    shopCategory: 'structural',
    description: 'Super-stretchy shock absorber that bends instead of snapping.',
  },
  anchor: {
    id: 'anchor',
    label: 'Anchor',
    color: 0x455a64,
    density: 2.8,
    stiffness: 2.0,
    maxStress: 2.6,
    buoyancy: 0.0,
    anchorMultiplier: 3.0,
    cost: 150,
    shopCategory: 'defense',
    description: 'Magnetic base that grips the island 3x tighter.',
  },
  pontoon: {
    id: 'pontoon',
    label: 'Pontoon',
    color: 0xffca28,
    density: 0.25,
    stiffness: 1.1,
    maxStress: 1.8,
    buoyancy: 3.8,
    cost: 200,
    shopCategory: 'structural',
    description: 'Tough inflatable float block that rides out big floods.',
  },
  steel: {
    id: 'steel',
    label: 'Steel',
    color: 0x607d8b,
    density: 2.6,
    stiffness: 2.0,
    maxStress: 2.6,
    buoyancy: 0.0,
    cost: 250,
    shopCategory: 'structural',
    description: 'Ultra-tough metal for heavy frames and braces.',
  },
  carbon: {
    id: 'carbon',
    label: 'Carbon',
    color: 0x37474f,
    density: 0.35,
    stiffness: 2.2,
    maxStress: 2.4,
    buoyancy: 0.8,
    cost: 300,
    shopCategory: 'structural',
    description: 'Featherlight space-age weave — super strong for tall towers.',
  },
  shield: {
    id: 'shield',
    label: 'Shield',
    color: 0x29b6f6,
    density: 1.4,
    stiffness: 1.3,
    maxStress: 1.5,
    buoyancy: 0.2,
    special: 'shield',
    cost: 350,
    shopCategory: 'defense',
    description: 'Projects a glowing aura that reinforces nearby blocks.',
  },
  titanium: {
    id: 'titanium',
    label: 'Titanium',
    color: 0xb0bec5,
    density: 1.8,
    stiffness: 2.6,
    maxStress: 3.4,
    buoyancy: 0.0,
    anchorMultiplier: 2.0,
    cost: 450,
    shopCategory: 'structural',
    description: 'Lighter than steel and way tougher, with built-in ground grip.',
  },
  laser: {
    id: 'laser',
    label: 'Laser',
    color: 0xef5350,
    density: 1.4,
    stiffness: 1.3,
    maxStress: 1.4,
    buoyancy: 0.2,
    special: 'laser',
    cost: 500,
    shopCategory: 'defense',
    description: 'Zaps incoming fireballs, snow, hail, raiders, and meteors.',
  },
  magnet: {
    id: 'magnet',
    label: 'Magnet',
    color: 0x7e57c2,
    density: 2.2,
    stiffness: 2.4,
    maxStress: 2.8,
    buoyancy: 0.0,
    anchorMultiplier: 5.0,
    cost: 600,
    shopCategory: 'defense',
    description: 'Super-powered electromagnet that locks onto the island 5x tighter.',
  },
  diamond: {
    id: 'diamond',
    label: 'Diamond',
    color: 0x4dd0e1,
    density: 2.4,
    stiffness: 3.0,
    maxStress: 4.5,
    buoyancy: 0.0,
    special: 'shield',
    cost: 800,
    shopCategory: 'defense',
    description: 'Nearly unbreakable crystal core that also projects a protective shield.',
  },
  door: {
    id: 'door',
    label: 'Door',
    color: 0x8d5524,
    density: 0.65,
    stiffness: 1.0,
    maxStress: 1.1,
    buoyancy: 1.2,
  },
};

export const BASE_MATERIALS: BuiltinMaterialType[] = ['wood', 'stone', 'bamboo', 'foam', 'door'];
export const UNLOCKABLE_MATERIALS: BuiltinMaterialType[] = [
  'rubber',
  'anchor',
  'pontoon',
  'steel',
  'carbon',
  'shield',
  'titanium',
  'laser',
  'magnet',
  'diamond',
];
export const MATERIAL_ORDER: BuiltinMaterialType[] = [...BASE_MATERIALS, ...UNLOCKABLE_MATERIALS];
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

const BUILTIN_MATERIAL_SET = new Set<string>(MATERIAL_ORDER);
const BUILTIN_DISASTER_SET = new Set<string>(DISASTER_ORDER);

export function isBuiltinMaterial(m: string): m is BuiltinMaterialType {
  return BUILTIN_MATERIAL_SET.has(m);
}

export function isBuiltinDisaster(d: string): d is BuiltinDisasterType {
  return BUILTIN_DISASTER_SET.has(d);
}

export function getMaterialDef(m: MaterialType, custom?: ReadonlyMap<string, MaterialDef>): MaterialDef {
  if (isBuiltinMaterial(m)) return MATERIALS[m];
  return custom?.get(m) ?? MATERIALS.wood;
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
  c[0] >= 0 && c[0] < GRID_CELLS && c[2] >= 0 && c[2] < GRID_CELLS && c[1] >= 0 && c[1] < MAX_HEIGHT_CELLS;

export const cornerInBounds = (k: Vec3) =>
  k[0] >= 0 && k[0] <= GRID_CELLS && k[2] >= 0 && k[2] <= GRID_CELLS && k[1] >= 0 && k[1] <= MAX_HEIGHT_CELLS;

/** World-space centre of a cell. */
export function cellToWorld(c: Vec3): Vec3 {
  const half = ISLAND_SIZE / 2;
  return [
    c[0] * CELL_SIZE - half + CELL_SIZE / 2,
    c[1] * CELL_SIZE + CELL_SIZE / 2,
    c[2] * CELL_SIZE - half + CELL_SIZE / 2,
  ];
}

/** World-space position of a corner lattice point. */
export function cornerToWorld(k: Vec3): Vec3 {
  const half = ISLAND_SIZE / 2;
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
export const mirrorCellX = (c: Vec3): Vec3 => [GRID_CELLS - 1 - c[0], c[1], c[2]];
export const mirrorCornerX = (k: Vec3): Vec3 => [GRID_CELLS - k[0], k[1], k[2]];

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

// ---------------------------------------------------------------- presets

function block(cx: number, cy: number, cz: number, material: MaterialType): BlockData {
  const cell: Vec3 = [cx, cy, cz];
  return { id: blockId(cell), cell, material };
}

function strut(a: Vec3, b: Vec3, material: MaterialType): StrutData {
  return { id: strutId(a, b), a, b, material };
}

/** Tall, narrow, unbraced 1x4x1 wood tower. Designed to fail in an earthquake. */
function towerPreset(): BlueprintGraph {
  return { version: 1, blocks: [0, 1, 2, 3].map((y) => block(3, y, 3, 'wood')), struts: [] };
}

function addOuterWallBraces(
  struts: StrutData[],
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  material: MaterialType,
) {
  for (const z of [z0, z1]) {
    struts.push(strut([x0, y0, z], [x1, y1, z], material));
    struts.push(strut([x1, y0, z], [x0, y1, z], material));
  }
  for (const x of [x0, x1]) {
    struts.push(strut([x, y0, z0], [x, y1, z1], material));
    struts.push(strut([x, y0, z1], [x, y1, z0], material));
  }
}

/**
 * Compact house, 2x2 footprint and 3 layers tall: stone ground floor, wood upper floor, wood cap,
 * and bamboo diagonal cross-braces over the bottom two layers of all four walls. Designed to
 * survive a standard earthquake.
 */
function housePreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const x of [3, 4])
    for (const z of [3, 4]) {
      blocks.push(block(x, 0, z, 'stone'));
      blocks.push(block(x, 1, z, 'wood'));
      blocks.push(block(x, 2, z, 'wood')); // capped top
    }
  const struts: StrutData[] = [];
  addOuterWallBraces(struts, 3, 5, 3, 5, 0, 2, 'bamboo');
  return { version: 1, blocks, struts };
}

/** Floating pontoon boat with a wood cabin, working door, mast, and bamboo braces. */
function boatPreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const x of [2, 3, 4, 5]) {
    for (const z of [3, 4]) {
      blocks.push(block(x, 0, z, 'pontoon'));
    }
  }
  // Cabin walls with an open interior at [4, 1, 3] and a door at [3, 1, 4]
  for (const [x, z, mat] of [
    [2, 3, 'wood'],
    [2, 4, 'wood'],
    [3, 3, 'wood'],
    [3, 4, 'door'],
    [4, 4, 'wood'],
    [5, 3, 'wood'],
    [5, 4, 'wood'],
  ] as const) {
    blocks.push(block(x, 1, z, mat));
  }
  blocks.push(block(3, 2, 3, 'bamboo'), block(3, 3, 3, 'bamboo'));
  const struts: StrutData[] = [];
  addOuterWallBraces(struts, 2, 6, 3, 5, 0, 2, 'bamboo');
  return { version: 1, blocks, struts };
}

const isBoxCorner = (x: number, z: number) => (x === 2 || x === 5) && (z === 2 || z === 5);
const isBoxEdge = (x: number, z: number) => x === 2 || x === 5 || z === 2 || z === 5;

/** Walk-in steel bunker with anchor corners, door entrance, and roof shield projector. */
function basePreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const x of [2, 3, 4, 5]) {
    for (const z of [2, 3, 4, 5]) {
      if (isBoxEdge(x, z)) {
        const y0Mat: MaterialType = x === 3 && z === 5 ? 'door' : isBoxCorner(x, z) ? 'anchor' : 'stone';
        blocks.push(block(x, 0, z, y0Mat));
        blocks.push(block(x, 1, z, 'steel'));
      }
      blocks.push(block(x, 2, z, x === 3 && z === 3 ? 'shield' : 'steel'));
    }
  }
  const struts: StrutData[] = [];
  addOuterWallBraces(struts, 2, 6, 2, 6, 0, 2, 'steel');
  return { version: 1, blocks, struts };
}

/** Braced 5-story defense spire with anchor base, shield core, carbon upper frame, and 4 lasers. */
function laserTowerPreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const x of [3, 4]) {
    for (const z of [3, 4]) {
      blocks.push(block(x, 0, z, 'anchor'));
      blocks.push(block(x, 1, z, 'steel'));
      blocks.push(block(x, 2, z, x === 3 && z === 3 ? 'shield' : 'steel'));
      blocks.push(block(x, 3, z, 'carbon'));
      blocks.push(block(x, 4, z, 'laser'));
    }
  }
  const struts: StrutData[] = [];
  addOuterWallBraces(struts, 3, 5, 3, 5, 0, 2, 'steel');
  addOuterWallBraces(struts, 3, 5, 3, 5, 2, 4, 'steel');
  return { version: 1, blocks, struts };
}

/** Apex fortress with magnet corners, titanium armor, diamond core, walk-in door, and 4 lasers. */
function fortressPreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const x of [2, 3, 4, 5]) {
    for (const z of [2, 3, 4, 5]) {
      if (isBoxEdge(x, z)) {
        const y0Mat: MaterialType = x === 3 && z === 5 ? 'door' : isBoxCorner(x, z) ? 'magnet' : 'titanium';
        blocks.push(block(x, 0, z, y0Mat));
        blocks.push(block(x, 1, z, x === 4 && z === 2 ? 'diamond' : 'titanium'));
      }
      blocks.push(block(x, 2, z, 'titanium'));
      if (isBoxCorner(x, z)) {
        blocks.push(block(x, 3, z, 'laser'));
      }
    }
  }
  const struts: StrutData[] = [];
  addOuterWallBraces(struts, 2, 6, 2, 6, 0, 2, 'titanium');
  return { version: 1, blocks, struts };
}

/** Spanning stone & wood bridge with bamboo X-braced pillars and diagonal knee braces. */
function bridgePreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const x of [1, 6]) {
    for (const z of [3, 4]) {
      blocks.push(block(x, 0, z, 'stone'));
      blocks.push(block(x, 1, z, 'stone'));
    }
  }
  for (let x = 1; x <= 6; x++) {
    for (const z of [3, 4]) {
      blocks.push(block(x, 2, z, 'wood'));
    }
  }
  const struts: StrutData[] = [
    strut([1, 0, 3], [2, 2, 3], 'bamboo'),
    strut([2, 0, 3], [1, 2, 3], 'bamboo'),
    strut([1, 0, 5], [2, 2, 5], 'bamboo'),
    strut([2, 0, 5], [1, 2, 5], 'bamboo'),
    strut([6, 0, 3], [7, 2, 3], 'bamboo'),
    strut([7, 0, 3], [6, 2, 3], 'bamboo'),
    strut([6, 0, 5], [7, 2, 5], 'bamboo'),
    strut([7, 0, 5], [6, 2, 5], 'bamboo'),
    strut([2, 0, 3], [4, 2, 3], 'bamboo'),
    strut([6, 0, 3], [4, 2, 3], 'bamboo'),
    strut([2, 0, 5], [4, 2, 5], 'bamboo'),
    strut([6, 0, 5], [4, 2, 5], 'bamboo'),
  ];
  return { version: 1, blocks, struts };
}

/** Stepped stone & wood pyramid with a walk-in door, bamboo spire, and wall braces. */
function pyramidPreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const x of [2, 3, 4, 5]) {
    for (const z of [2, 3, 4, 5]) {
      if (isBoxEdge(x, z)) {
        blocks.push(block(x, 0, z, x === 3 && z === 5 ? 'door' : 'stone'));
        blocks.push(block(x, 1, z, 'wood'));
      }
    }
  }
  for (const x of [3, 4]) {
    for (const z of [3, 4]) {
      blocks.push(block(x, 2, z, 'stone'));
    }
  }
  blocks.push(block(3, 3, 3, 'bamboo'));
  const struts: StrutData[] = [];
  addOuterWallBraces(struts, 2, 6, 2, 6, 0, 2, 'bamboo');
  return { version: 1, blocks, struts };
}

/** Elevated bamboo treehouse on shock-absorbing rubber & anchor corner stilts. */
function treehousePreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const [x, z] of [
    [2, 2],
    [5, 2],
    [2, 5],
    [5, 5],
  ] as const) {
    blocks.push(block(x, 0, z, 'anchor'));
    blocks.push(block(x, 1, z, 'rubber'));
  }
  for (const x of [2, 3, 4, 5]) {
    for (const z of [2, 3, 4, 5]) {
      blocks.push(block(x, 2, z, 'wood'));
      if (isBoxEdge(x, z)) {
        blocks.push(block(x, 3, z, x === 3 && z === 5 ? 'door' : 'bamboo'));
      }
    }
  }
  for (const x of [3, 4]) {
    for (const z of [3, 4]) {
      blocks.push(block(x, 4, z, 'wood'));
    }
  }
  const struts: StrutData[] = [];
  addOuterWallBraces(struts, 2, 6, 2, 6, 0, 2, 'bamboo');
  addOuterWallBraces(struts, 2, 6, 2, 6, 2, 4, 'bamboo');
  return { version: 1, blocks, struts };
}

/** High-tech carbon & titanium bunker with a walk-in door, shield core, and twin lasers. */
function domePreset(): BlueprintGraph {
  const blocks: BlockData[] = [];
  for (const x of [2, 3, 4, 5]) {
    for (const z of [2, 3, 4, 5]) {
      if (isBoxEdge(x, z)) {
        const y0Mat: MaterialType = x === 3 && z === 5 ? 'door' : isBoxCorner(x, z) ? 'anchor' : 'titanium';
        blocks.push(block(x, 0, z, y0Mat));
        blocks.push(block(x, 1, z, 'carbon'));
      }
      blocks.push(block(x, 2, z, x === 3 && z === 3 ? 'shield' : 'carbon'));
    }
  }
  blocks.push(
    block(3, 3, 3, 'laser'),
    block(4, 3, 4, 'laser'),
    block(4, 3, 3, 'titanium'),
    block(3, 3, 4, 'titanium'),
  );
  const struts: StrutData[] = [];
  addOuterWallBraces(struts, 2, 6, 2, 6, 0, 2, 'carbon');
  return { version: 1, blocks, struts };
}

export const PRESET_DEFS: Record<PresetName, PresetDef> = {
  empty: { id: 'empty', label: 'Empty', color: 0x94a3b8 },
  house: { id: 'house', label: 'House', color: 0xc58b4c },
  tower: { id: 'tower', label: 'Tower', color: 0xd97706 },
  bridge: { id: 'bridge', label: 'Bridge', color: 0xb45309 },
  pyramid: {
    id: 'pyramid',
    label: 'Pyramid',
    color: 0xeab308,
    cost: 120,
    description: 'Stepped stone & wood pyramid with a secret walk-in door.',
    badges: ['Stepped', 'Door'],
  },
  boat: {
    id: 'boat',
    label: 'Boat',
    color: 0x0284c7,
    cost: 150,
    description: 'Floating pontoon boat with a cabin door that rides right over floods.',
    badges: ['Floats', 'Door'],
  },
  treehouse: {
    id: 'treehouse',
    label: 'Treehouse',
    color: 0x22c55e,
    cost: 200,
    description: 'Elevated bamboo treehouse on shock-absorbing rubber & anchor stilts.',
    badges: ['Elevated', 'Braced'],
  },
  base: {
    id: 'base',
    label: 'Base',
    color: 0x475569,
    cost: 250,
    description: 'Walk-in steel bunker with anchor corners, a working door, and a shield roof.',
    badges: ['Walk-in Door', 'Shield'],
  },
  laser_tower: {
    id: 'laser_tower',
    label: 'Laser Tower',
    color: 0xef4444,
    cost: 400,
    description: 'Braced 5-story defense spire with a shield core and 4 rooftop laser turrets.',
    badges: ['4 Lasers', 'Shield'],
  },
  dome: {
    id: 'dome',
    label: 'Shield Dome',
    color: 0x38bdf8,
    cost: 500,
    description: 'High-tech carbon & titanium bunker with a walk-in door, shield core, and twin lasers.',
    badges: ['Walk-in Door', 'Shield', '2 Lasers'],
  },
  fortress: {
    id: 'fortress',
    label: 'Fortress',
    color: 0x0891b2,
    cost: 650,
    description: 'Apex castle with magnet anchors, titanium walls, a diamond core, a door, and 4 lasers.',
    badges: ['Walk-in Door', '4 Lasers', 'Diamond'],
  },
};

export const BASE_PRESETS: readonly BasePresetName[] = ['empty', 'house', 'tower', 'bridge'];
export const UNLOCKABLE_PRESETS: readonly UnlockablePresetName[] = [
  'pyramid',
  'boat',
  'treehouse',
  'base',
  'laser_tower',
  'dome',
  'fortress',
];
export const PRESET_ORDER: readonly PresetName[] = [...BASE_PRESETS, ...UNLOCKABLE_PRESETS];

const PRESET_SET = new Set<string>(PRESET_ORDER);
export function isPresetName(s: string): s is PresetName {
  return PRESET_SET.has(s);
}

export const PRESETS: Record<PresetName, () => BlueprintGraph> = {
  empty: emptyGraph,
  tower: towerPreset,
  house: housePreset,
  bridge: bridgePreset,
  pyramid: pyramidPreset,
  boat: boatPreset,
  treehouse: treehousePreset,
  base: basePreset,
  laser_tower: laserTowerPreset,
  dome: domePreset,
  fortress: fortressPreset,
};

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
