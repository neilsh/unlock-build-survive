import { describe, expect, it } from 'vitest';
import { PRESETS } from '../types/presets';
import type { StorageLike } from './progress';
import { SAVE_GAME_KEY, hasSavedGame, loadGameState, saveGameState, type SavedGame } from './saveGame';

function fakeStorage(initial?: string): StorageLike {
  const data = new Map<string, string>(initial === undefined ? [] : [[SAVE_GAME_KEY, initial]]);
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('saveGame', () => {
  it('round-trips a saved village and mode settings through storage', () => {
    const storage = fakeStorage();
    expect(hasSavedGame(storage)).toBe(false);

    const sample: SavedGame = {
      version: 1,
      savedAt: 123456,
      graph: PRESETS.house(),
      playMode: 'survival',
      exploreMode: true,
      moonGravity: true,
      turboMode: false,
      megaStorm: true,
      multiplayerMode: 'coop',
      disaster: 'hail',
      strength: 'strong',
      survivalWave: 4,
      battleTurn: 2,
      battleRound: 3,
      battleP1Score: 5,
      battleP2Score: 6,
    };

    expect(saveGameState(sample, storage)).toBe(true);
    expect(hasSavedGame(storage)).toBe(true);
    const loaded = loadGameState(storage);
    expect(loaded).toEqual(sample);
  });

  it('handles corrupt JSON, blocked storage, and invalid blocks or struts safely', () => {
    expect(loadGameState(fakeStorage('{broken'))).toBeNull();
    expect(hasSavedGame(fakeStorage('{broken'))).toBe(false);
    expect(loadGameState(fakeStorage('null'))).toBeNull();

    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(
      saveGameState(
        {
          version: 1,
          savedAt: 1,
          graph: PRESETS.tower(),
          playMode: 'creative',
          exploreMode: false,
          multiplayerMode: 'solo',
          disaster: 'earthquake',
          strength: 'medium',
          survivalWave: 1,
          battleTurn: 1,
          battleRound: 1,
          battleP1Score: 0,
          battleP2Score: 0,
        },
        blocked,
      ),
    ).toBe(false);
    expect(loadGameState(blocked)).toBeNull();

    const hostile = fakeStorage(
      JSON.stringify({
        graph: {
          version: 1,
          blocks: [
            { id: 'b:0,0,0', cell: [0, 0, 0], material: 'wood' },
            { id: 'bad', cell: [99, 0, 0], material: 'wood' }, // out of bounds -> dropped
            { id: 'dup', cell: [0, 0, 0], material: 'stone' }, // duplicate cell -> dropped
          ],
          struts: [
            { id: 's:bad', a: [0, 0, 0], b: [0, 5, 0], material: 'bamboo' }, // unanchored -> dropped
            { id: 's:ok', a: [0, 0, 0], b: [1, 1, 0], material: 'bamboo' }, // valid
          ],
        },
        playMode: 'weird',
        multiplayerMode: 'invalid',
        strength: 'impossible',
        survivalWave: -3,
      }),
    );

    const loaded = loadGameState(hostile)!;
    expect(loaded.graph.blocks).toHaveLength(1);
    expect(loaded.graph.blocks[0]?.material).toBe('wood');
    expect(loaded.graph.struts).toHaveLength(1);
    expect(loaded.playMode).toBe('creative');
    expect(loaded.multiplayerMode).toBe('solo');
    expect(loaded.strength).toBe('medium');
    expect(loaded.survivalWave).toBe(1);
  });
});
