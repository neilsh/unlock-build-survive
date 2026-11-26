import { describe, expect, it } from 'vitest';
import { pickFirst, pickNeighbor, type NavRect } from './MenuNavigator';

const box = (left: number, top: number, w = 100, h = 40): NavRect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe('pickNeighbor', () => {
  // 0 1
  // 2 3
  const grid = [box(0, 0), box(200, 0), box(0, 100), box(200, 100)];

  it('moves between grid cells in each direction', () => {
    expect(pickNeighbor(grid, 0, 'right')).toBe(1);
    expect(pickNeighbor(grid, 0, 'down')).toBe(2);
    expect(pickNeighbor(grid, 3, 'left')).toBe(2);
    expect(pickNeighbor(grid, 3, 'up')).toBe(1);
  });

  it('returns -1 when nothing lies that way', () => {
    expect(pickNeighbor(grid, 0, 'up')).toBe(-1);
    expect(pickNeighbor(grid, 0, 'left')).toBe(-1);
    expect(pickNeighbor(grid, 3, 'down')).toBe(-1);
    expect(pickNeighbor(grid, 99, 'down')).toBe(-1);
  });

  it('prefers the aligned item over a closer but off-axis one', () => {
    const rects = [box(0, 0), box(150, 60), box(0, 160)];
    expect(pickNeighbor(rects, 0, 'down')).toBe(2);
  });
});

describe('pickFirst', () => {
  it('picks the top-left-most item', () => {
    expect(pickFirst([box(200, 100), box(300, 0), box(10, 0), box(0, 100)])).toBe(2);
    expect(pickFirst([])).toBe(-1);
  });
});
