import { describe, expect, it } from 'vitest';
import {
  GRID_CELLS,
  blockId,
  blocksAtCorner,
  cellCorners,
  cellInBounds,
  cellToWorld,
  cornerInBounds,
  cornerToWorld,
  emptyGraph,
  isStrutValid,
  mirrorCellX,
  mirrorCornerX,
  strutId,
} from './blueprint';
import { PRESETS } from './presets';

describe('blueprint helpers', () => {
  it('builds deterministic ids independent of strut endpoint order', () => {
    expect(blockId([1, 2, 3])).toBe('b:1,2,3');
    expect(strutId([0, 0, 0], [2, 2, 0])).toBe(strutId([2, 2, 0], [0, 0, 0]));
  });

  it('gives each cell 8 corners', () => {
    expect(new Set(cellCorners([3, 0, 3]).map((c) => c.join())).size).toBe(8);
  });

  it('presets are valid, unique and in bounds', () => {
    for (const make of Object.values(PRESETS)) {
      const g = make();
      const ids = [...g.blocks.map((b) => b.id), ...g.struts.map((s) => s.id)];
      expect(new Set(ids).size).toBe(ids.length);
      expect(g.blocks.every((b) => cellInBounds(b.cell))).toBe(true);
      expect(g.struts.every((s) => cornerInBounds(s.a) && cornerInBounds(s.b))).toBe(true);
      expect(g.struts.every((s) => isStrutValid(g, s.a, s.b))).toBe(true);
      expect(g.blocks.every((b) => b.id === blockId(b.cell))).toBe(true);
      expect(g.struts.every((s) => s.id === strutId(s.a, s.b))).toBe(true);
    }
  });

  it('tower is 1x4x1 unbraced and house is braced', () => {
    const tower = PRESETS.tower();
    expect(tower.blocks).toHaveLength(4);
    expect(tower.struts).toHaveLength(0);
    expect(PRESETS.house().struts).toHaveLength(8);
  });

  it('maps cells and corners onto a grid centred on the origin', () => {
    expect(cornerToWorld([0, 0, 0])).toEqual([-8, 0, -8]);
    expect(cornerToWorld([GRID_CELLS, 1, GRID_CELLS])).toEqual([8, 2, 8]);
    expect(cellToWorld([0, 0, 0])).toEqual([-7, 1, -7]);
  });

  it('mirrors cells and corners consistently across x', () => {
    const c: [number, number, number] = [1, 2, 3];
    expect(mirrorCellX(mirrorCellX(c))).toEqual(c);
    const mirroredCorners = cellCorners(mirrorCellX(c))
      .map((k) => k.join())
      .toSorted();
    expect(
      cellCorners(c)
        .map((k) => mirrorCornerX(k).join())
        .toSorted(),
    ).toEqual(mirroredCorners);
    expect(cellToWorld(mirrorCellX(c))[0]).toBe(-cellToWorld(c)[0]);
  });

  it('validates strut anchoring', () => {
    const g = emptyGraph();
    expect(isStrutValid(g, [0, 0, 0], [2, 0, 2])).toBe(true); // both on the ground
    expect(isStrutValid(g, [0, 0, 0], [0, 0, 0])).toBe(false); // zero length
    expect(isStrutValid(g, [0, 0, 0], [0, 2, 0])).toBe(false); // top end floats
    g.blocks.push(
      { id: blockId([0, 0, 0]), cell: [0, 0, 0], material: 'wood' },
      { id: blockId([0, 1, 0]), cell: [0, 1, 0], material: 'wood' },
    );
    expect(isStrutValid(g, [0, 0, 0], [0, 2, 0])).toBe(true);
    expect(blocksAtCorner(g, [1, 1, 1]).map((b) => b.id)).toEqual(['b:0,0,0', 'b:0,1,0']);
  });
});
