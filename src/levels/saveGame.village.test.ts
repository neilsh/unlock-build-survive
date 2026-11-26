import { afterEach, describe, expect, it } from 'vitest';
import { GRID_CELLS, VILLAGE_GRID_CELLS, getGridCells, setIslandCells } from '../types/blueprint';
import { loadGameState, saveGameState, type SavedGame } from './saveGame';
import { graphOf } from './villageFixtures';

afterEach(() => setIslandCells(GRID_CELLS));

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

const base = (over: Partial<SavedGame>): SavedGame => ({
  version: 1,
  savedAt: 1,
  graph: graphOf([[12, 0, 12]]),
  playMode: 'village',
  exploreMode: false,
  multiplayerMode: 'solo',
  disaster: 'hail',
  strength: 'gentle',
  survivalWave: 1,
  battleTurn: 1,
  battleRound: 1,
  battleP1Score: 0,
  battleP2Score: 0,
  villageRound: 4,
  villagePopulation: 6,
  ...over,
});

describe('saved village games', () => {
  it('keeps blocks that only fit on the big island, and the round and population', () => {
    const storage = memory();
    setIslandCells(VILLAGE_GRID_CELLS);
    saveGameState(base({}), storage);
    setIslandCells(GRID_CELLS);
    const loaded = loadGameState(storage);
    expect(loaded?.playMode).toBe('village');
    expect(loaded?.graph.blocks).toHaveLength(1);
    expect(loaded).toMatchObject({ villageRound: 4, villagePopulation: 6 });
    expect(getGridCells()).toBe(GRID_CELLS); // loading must not leave the island switched
  });

  it('keeps Village Creative saves on the big island too', () => {
    const storage = memory();
    saveGameState(base({ playMode: 'villageCreative', villageRound: undefined }), storage);
    const loaded = loadGameState(storage);
    expect(loaded?.playMode).toBe('villageCreative');
    expect(loaded?.graph.blocks).toHaveLength(1);
    expect(getGridCells()).toBe(GRID_CELLS);
  });

  it('still drops out-of-bounds blocks from ordinary saves', () => {
    const storage = memory();
    saveGameState(
      base({ playMode: 'creative', villageRound: undefined, villagePopulation: undefined }),
      storage,
    );
    const loaded = loadGameState(storage);
    expect(loaded?.playMode).toBe('creative');
    expect(loaded?.graph.blocks).toHaveLength(0);
    expect(loaded?.villageRound).toBeUndefined();
  });
});
