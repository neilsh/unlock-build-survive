import type {
  BasePresetName,
  BlockData,
  BlueprintGraph,
  MaterialType,
  PresetDef,
  PresetName,
  StrutData,
  UnlockablePresetName,
  Vec3,
} from './blueprint';
import { blockId, emptyGraph, strutId } from './blueprint';

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

/**
 * Village Island (rounds and Village Creative) allows only these four starter quick-builders,
 * and only while Explore Mode is on.
 */
export const VILLAGE_PRESETS: readonly PresetName[] = BASE_PRESETS;

export type VillagePresetBlock = 'needs-explore' | 'not-in-village';

/** Why `preset` cannot be loaded in the Village right now, or null when it is allowed. */
export function villagePresetBlock(preset: PresetName, exploreMode: boolean): VillagePresetBlock | null {
  if (!exploreMode) return 'needs-explore';
  return VILLAGE_PRESETS.includes(preset) ? null : 'not-in-village';
}

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
