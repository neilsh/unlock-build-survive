import { afterEach, describe, expect, it } from 'vitest';
import {
  GRID_CELLS,
  ISLAND_SIZE,
  VILLAGE_GRID_CELLS,
  cellInBounds,
  cellToWorld,
  cornerInBounds,
  cornerToWorld,
  getGridCells,
  getIslandSize,
  mirrorCellX,
  setIslandCells,
  worldToCell,
} from './blueprint';

afterEach(() => setIslandCells(GRID_CELLS));

describe('active island size', () => {
  it('defaults to the standard 8x8 island', () => {
    expect(getGridCells()).toBe(8);
    expect(getIslandSize()).toBe(ISLAND_SIZE);
    expect(cellInBounds([7, 0, 7])).toBe(true);
    expect(cellInBounds([8, 0, 0])).toBe(false);
  });

  it('grows bounds, world mapping and mirroring for the village island', () => {
    setIslandCells(VILLAGE_GRID_CELLS);
    expect(getIslandSize()).toBe(28);
    expect(cellInBounds([13, 7, 13])).toBe(true);
    expect(cellInBounds([14, 0, 0])).toBe(false);
    expect(cornerInBounds([14, 8, 14])).toBe(true);
    expect(cornerInBounds([15, 0, 0])).toBe(false);
    expect(cellToWorld([0, 0, 0])).toEqual([-13, 1, -13]);
    expect(cornerToWorld([14, 0, 14])).toEqual([14, 0, 14]);
    expect(mirrorCellX([2, 1, 3])).toEqual([11, 1, 3]);
  });

  it('worldToCell inverts cellToWorld on the ground plane', () => {
    for (const cells of [8, 14]) {
      setIslandCells(cells);
      for (const c of [0, 3, cells - 1]) {
        const [wx, , wz] = cellToWorld([c, 0, cells - 1 - c]);
        expect(worldToCell(wx, wz)).toEqual([c, cells - 1 - c]);
      }
    }
  });

  it('clamps silly sizes and ignores non-finite ones', () => {
    setIslandCells(999);
    expect(getGridCells()).toBe(24);
    setIslandCells(1);
    expect(getGridCells()).toBe(4);
    setIslandCells(Number.NaN);
    expect(getGridCells()).toBe(GRID_CELLS);
  });
});
