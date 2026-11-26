/**
 * Save & Continue persistence for the player's current village and mode settings.
 * Pure & headless-safe: no three.js, Rapier, or React imports.
 */
import type { BlockData, BlueprintGraph, DisasterType, Strength, StrutData, Vec3 } from '../types/blueprint';
import {
  DEFAULT_STRENGTH,
  STRENGTH_ORDER,
  blockId,
  cellInBounds,
  GRID_CELLS,
  VILLAGE_GRID_CELLS,
  cloneGraph,
  cornerInBounds,
  getGridCells,
  setIslandCells,
  isStrutValid,
  strutId,
} from '../types/blueprint';
import type { MultiplayerMode, PlayMode } from '../types/ui';
import type { StorageLike } from './progress';

export const SAVE_GAME_KEY = 'ubs:save:v1';

export interface SavedGame {
  version: 1;
  savedAt: number;
  graph: BlueprintGraph;
  playMode: PlayMode;
  exploreMode: boolean;
  moonGravity?: boolean;
  turboMode?: boolean;
  megaStorm?: boolean;
  multiplayerMode: MultiplayerMode;
  disaster: DisasterType;
  strength: Strength;
  survivalWave: number;
  battleTurn: 1 | 2;
  battleRound: number;
  battleP1Score: number;
  battleP2Score: number;
  /** Village Island only: the round reached and how many villagers lived there. */
  villageRound?: number;
  villagePopulation?: number;
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function toVec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return null;
  return [x, y, z];
}

function asFieldMap(v: unknown): Map<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return new Map(Object.entries(v));
}

function sanitizeGraph(raw: unknown): BlueprintGraph | null {
  const obj = asFieldMap(raw);
  if (!obj) return null;
  const rawBlocks = obj.get('blocks');
  const rawStruts = obj.get('struts');
  if (!Array.isArray(rawBlocks) || !Array.isArray(rawStruts)) return null;

  const blocks: BlockData[] = [];
  const seenBlocks = new Set<string>();
  for (const item of rawBlocks) {
    const b = asFieldMap(item);
    if (!b) continue;
    const cell = toVec3(b.get('cell'));
    const material = b.get('material');
    if (!cell || !cellInBounds(cell) || typeof material !== 'string' || !material.trim()) continue;
    const id = blockId(cell);
    if (seenBlocks.has(id)) continue;
    seenBlocks.add(id);
    blocks.push({ id, cell, material });
  }

  const graph: BlueprintGraph = { version: 1, blocks, struts: [] };
  const seenStruts = new Set<string>();
  const struts: StrutData[] = [];
  for (const item of rawStruts) {
    const s = asFieldMap(item);
    if (!s) continue;
    const a = toVec3(s.get('a'));
    const b = toVec3(s.get('b'));
    const material = s.get('material');
    if (!a || !b || !cornerInBounds(a) || !cornerInBounds(b)) continue;
    if (typeof material !== 'string' || !material.trim()) continue;
    if (!isStrutValid(graph, a, b)) continue;
    const id = strutId(a, b);
    if (seenStruts.has(id)) continue;
    seenStruts.add(id);
    struts.push({ id, a, b, material });
  }
  graph.struts = struts;
  return graph;
}

const isMultiplayerMode = (v: unknown): v is MultiplayerMode =>
  v === 'solo' || v === 'coop' || v === 'split' || v === 'battle' || v === 'bot';

const isStrength = (v: unknown): v is Strength =>
  typeof v === 'string' && (STRENGTH_ORDER as readonly string[]).includes(v);

const toPosInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fallback;

const toNonNegInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback;

/** Saves the current village and mode state to storage. Returns true if persisted. */
export function saveGameState(data: SavedGame, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const clean: SavedGame = {
      ...data,
      version: 1,
      graph: cloneGraph(data.graph),
    };
    storage.setItem(SAVE_GAME_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

/** Loads and sanitizes the saved game from storage, or returns null when missing/corrupt. */
export function loadGameState(storage: StorageLike | null = defaultStorage()): SavedGame | null {
  try {
    const raw = storage?.getItem(SAVE_GAME_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const obj = asFieldMap(parsed);
    if (!obj) return null;
    const isVillage = obj.get('playMode') === 'village';
    // Village Island saves use the big island, so check the build against that size.
    const previousCells = getGridCells();
    setIslandCells(isVillage ? VILLAGE_GRID_CELLS : GRID_CELLS);
    let graph: BlueprintGraph | null;
    try {
      graph = sanitizeGraph(obj.get('graph'));
    } finally {
      setIslandCells(previousCells);
    }
    if (!graph) return null;
    const savedAt = obj.get('savedAt');
    const disaster = obj.get('disaster');
    const rawMp = obj.get('multiplayerMode');
    const rawStrength = obj.get('strength');
    return {
      version: 1,
      savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0,
      graph,
      playMode: isVillage ? 'village' : obj.get('playMode') === 'survival' ? 'survival' : 'creative',
      exploreMode: obj.get('exploreMode') === true,
      moonGravity: obj.get('moonGravity') === true,
      turboMode: obj.get('turboMode') === true,
      megaStorm: obj.get('megaStorm') === true,
      multiplayerMode: isMultiplayerMode(rawMp) ? rawMp : 'solo',
      disaster: typeof disaster === 'string' && disaster.trim() ? disaster : 'earthquake',
      strength: isStrength(rawStrength) ? rawStrength : DEFAULT_STRENGTH,
      survivalWave: toPosInt(obj.get('survivalWave'), 1),
      battleTurn: obj.get('battleTurn') === 2 ? 2 : 1,
      battleRound: toPosInt(obj.get('battleRound'), 1),
      battleP1Score: toNonNegInt(obj.get('battleP1Score'), 0),
      battleP2Score: toNonNegInt(obj.get('battleP2Score'), 0),
      ...(isVillage
        ? {
            villageRound: toPosInt(obj.get('villageRound'), 1),
            villagePopulation: toPosInt(obj.get('villagePopulation'), 1),
          }
        : {}),
    };
  } catch {
    return null;
  }
}

export function hasSavedGame(storage: StorageLike | null = defaultStorage()): boolean {
  return loadGameState(storage) !== null;
}
