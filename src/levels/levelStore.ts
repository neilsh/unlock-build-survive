/** Level-only UI state that does not belong in the shared UIState contract. */
import { createStore, useStoreSelector } from '../state/createStore';
import type { BestStars } from './progress';

export interface LevelInfo {
  /** Blocks currently on the island. */
  blocksUsed: number;
  /** Layers tall the current build is. */
  height: number;
  /** Best stars earned per level id. */
  best: BestStars;
  /** Id of the level opened by the latest run, shown once as "Next level unlocked". */
  justUnlocked: string | null;
  /** Short kid-friendly hint about a refused action; null when there is nothing to say. */
  notice: string | null;
}

const initial: LevelInfo = { blocksUsed: 0, height: 0, best: {}, justUnlocked: null, notice: null };

export const levelStore = createStore<LevelInfo>(initial);

const selectAll = (info: LevelInfo): LevelInfo => info;

export function useLevelInfo(): LevelInfo;
export function useLevelInfo<S>(selector: (info: LevelInfo) => S): S;
export function useLevelInfo(selector: (info: LevelInfo) => unknown = selectAll): unknown {
  return useStoreSelector(levelStore, selector);
}
