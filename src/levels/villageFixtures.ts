/** Test helpers shared by the Village Island tests. */
import type { BlueprintGraph, MaterialType, Vec3 } from '../types/blueprint';
import { blockId } from '../types/blueprint';

export type BlockSpec = [number, number, number, MaterialType?];

export function graphOf(blocks: BlockSpec[]): BlueprintGraph {
  return {
    version: 1,
    blocks: blocks.map(([x, y, z, material]) => {
      const cell: Vec3 = [x, y, z];
      return { id: blockId(cell), cell, material: material ?? 'wood' };
    }),
    struts: [],
  };
}

/** A hut around ground cell (5, 5): walls west, east and north, a roof above, open to the south. */
export const HUT: BlockSpec[] = [
  [4, 0, 5],
  [6, 0, 5],
  [5, 0, 4],
  [5, 1, 5],
];
