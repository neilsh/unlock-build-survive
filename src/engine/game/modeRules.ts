/** Pure predicates over the current play mode, shared by the Game controllers. */
import { isMaterialAllowed } from '../../levels/constraints';
import { levelStore } from '../../levels/levelStore';
import { modStore } from '../../mods/modStore';
import { uiStore } from '../../state/store';
import type { BuildConstraints, MaterialType } from '../../types/blueprint';
import { MATERIAL_ORDER } from '../../types/materials';

export function isCreativeSandbox(): boolean {
  const s = uiStore.getState();
  return s.playMode === 'creative' && s.levelId === null;
}

export function isSurvivalMode(): boolean {
  const s = uiStore.getState();
  return s.playMode === 'survival' && s.levelId === null;
}

/** Survival waves pick the next disaster automatically; tells the player and returns true when locked. */
export function lockedBySurvival(): boolean {
  if (!isSurvivalMode()) return false;
  levelStore.setState({ notice: 'Survival waves pick the next disaster automatically.' });
  return true;
}

export function lockedBySurvivalEnd(): boolean {
  const s = uiStore.getState();
  return s.playMode === 'survival' && s.levelId === null && (s.survivalOver || s.mode === 'survived');
}

/** Disaster and strength are fixed while a challenge level is active. */
export function lockedByLevel(): boolean {
  if (uiStore.getState().levelId === null) return false;
  levelStore.setState({ notice: 'This level has its own disaster. Leave the level to pick another.' });
  return true;
}

/** Materials a player may currently cycle through (unlocked + mod blocks, minus level-forbidden ones). */
export function buildMaterialPool(constraints: BuildConstraints | null | undefined): MaterialType[] {
  const s = uiStore.getState();
  const customIds =
    s.levelId === null && s.playMode !== 'survival' ? modStore.getState().active.blocks.map((b) => b.id) : [];
  const base = isCreativeSandbox() ? MATERIAL_ORDER : s.unlockedMaterials;
  return [...base, ...customIds].filter((m) => isMaterialAllowed(constraints, m));
}
