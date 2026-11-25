/** Challenge-level progress: best stars per level, unlock rules, shop points and localStorage persistence. */
import type { BuiltinMaterialType, MaterialType, PresetName, Stars } from '../types/blueprint';
import { BASE_MATERIALS, MATERIALS, MATERIAL_ORDER, isBuiltinMaterial } from '../types/materials';
import { BASE_PRESETS, PRESET_DEFS, PRESET_ORDER, isPresetName } from '../types/presets';
import type { ArmorId, GearId, WeaponId } from '../types/gear';
import { BASE_GEAR, DEFAULT_WEAPON, GEAR, GEAR_ORDER, isArmorId, isGearId, isWeaponId } from '../types/gear';
import type { Level } from './levels';

export type BestStars = Record<string, Stars>;

export interface GearSave {
  unlocked: GearId[];
  armor: ArmorId | null;
  weapon: WeaponId | null;
}

export interface SurvivalSave {
  bestWave: number;
  bonusPoints: number;
}

export const PROGRESS_KEY = 'critter-haven:progress:v1';
export const SHOP_KEY = 'disaster-village:shop:v1';
export const GEAR_KEY = 'disaster-village:gear:v1';
export const PRESETS_KEY = 'disaster-village:presets:v1';
export const SURVIVAL_KEY = 'disaster-village:survival:v1';
export const POINTS_PER_STAR = 100;
export const CLEAR_BONUS = 50;

/** The slice of the Storage API we use, so tests can pass a fake. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, sandboxed iframe)
  }
}

const toStars = (v: unknown): Stars | null => (v === 0 || v === 1 || v === 2 || v === 3 ? v : null);

/** Reads saved best stars. Unknown level ids and malformed values are dropped; failures give {}. */
export function loadBest(
  levels: readonly Level[],
  storage: StorageLike | null = defaultStorage(),
): BestStars {
  const best: BestStars = {};
  try {
    const raw = storage?.getItem(PROGRESS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== 'object' || parsed === null) return best;
    const saved = new Map(Object.entries(parsed));
    for (const level of levels) {
      const stars = toStars(saved.get(level.id));
      if (stars !== null && stars > 0) best[level.id] = stars;
    }
  } catch {
    // corrupt JSON or blocked storage: start fresh
  }
  return best;
}

export function saveBest(best: BestStars, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(best));
  } catch {
    // quota or blocked storage: progress just will not persist
  }
}

/** The first level is always open; each later one opens when the one before reached its goal stars. */
export function computeUnlocked(levels: readonly Level[], best: BestStars): string[] {
  const out: string[] = [];
  for (const [i, level] of levels.entries()) {
    const prev = levels[i - 1];
    if (!prev || (best[prev.id] ?? 0) >= prev.goalStars) out.push(level.id);
    else break;
  }
  return out;
}

export interface ResultOutcome {
  best: BestStars;
  /** True when this run reached the level's goal stars. */
  goalReached: boolean;
  /** Id of the level this run opened for the first time, if any. */
  newlyUnlocked: string | null;
}

/** Folds a finished run into the best-stars table (never lowers a score). */
export function recordResult(
  levels: readonly Level[],
  best: BestStars,
  levelId: string,
  stars: Stars,
): ResultOutcome {
  const level = levels.find((l) => l.id === levelId);
  if (!level) return { best, goalReached: false, newlyUnlocked: null };
  const next: BestStars = { ...best };
  if (stars > (best[levelId] ?? 0)) next[levelId] = stars;
  const before = new Set(computeUnlocked(levels, best));
  const newlyUnlocked = computeUnlocked(levels, next).find((id) => !before.has(id)) ?? null;
  return { best: next, goalReached: stars >= level.goalStars, newlyUnlocked };
}

/** Total shop points earned across all levels based on best stars and first-clear goal bonuses. */
export function computeTotalPoints(levels: readonly Level[], best: BestStars): number {
  let total = 0;
  for (const level of levels) {
    const stars = best[level.id] ?? 0;
    if (stars <= 0) continue;
    total += stars * POINTS_PER_STAR;
    if (stars >= level.goalStars) total += CLEAR_BONUS;
  }
  return total;
}

/** Total points spent on unlocked tech blocks, first-person gear, and quick-builders. */
export function computeSpentPoints(
  unlocked: readonly MaterialType[],
  unlockedGear: readonly GearId[] = [],
  unlockedPresets: readonly PresetName[] = [],
): number {
  let spent = 0;
  for (const m of new Set(unlocked)) {
    if (isBuiltinMaterial(m)) spent += MATERIALS[m].cost ?? 0;
  }
  for (const g of new Set(unlockedGear)) {
    if (isGearId(g)) spent += GEAR[g].cost;
  }
  for (const p of new Set(unlockedPresets)) {
    if (isPresetName(p)) spent += PRESET_DEFS[p].cost ?? 0;
  }
  return spent;
}

/** Remaining points available to spend in the shop. */
export function computeAvailablePoints(
  levels: readonly Level[],
  best: BestStars,
  unlocked: readonly MaterialType[],
  unlockedGear: readonly GearId[] = [],
  unlockedPresets: readonly PresetName[] = [],
  bonusPoints = 0,
): number {
  const bonus = Number.isFinite(bonusPoints) ? Math.max(0, Math.floor(bonusPoints)) : 0;
  return Math.max(
    0,
    computeTotalPoints(levels, best) + bonus - computeSpentPoints(unlocked, unlockedGear, unlockedPresets),
  );
}

function normalizeUnlocked(items: readonly MaterialType[]): BuiltinMaterialType[] {
  const set = new Set<string>(BASE_MATERIALS);
  for (const m of items) {
    if (isBuiltinMaterial(m)) set.add(m);
  }
  return MATERIAL_ORDER.filter((m) => set.has(m));
}

/** Reads unlocked materials from storage, always preserving base materials. */
export function loadUnlockedMaterials(storage: StorageLike | null = defaultStorage()): MaterialType[] {
  const set = new Set<BuiltinMaterialType>(BASE_MATERIALS);
  try {
    const raw = storage?.getItem(SHOP_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'string' && isBuiltinMaterial(item)) {
          set.add(item);
        }
      }
    }
  } catch {
    // corrupt JSON or blocked storage: start with base materials
  }
  return MATERIAL_ORDER.filter((m) => set.has(m));
}

export function saveUnlockedMaterials(
  unlocked: readonly MaterialType[],
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(SHOP_KEY, JSON.stringify(normalizeUnlocked(unlocked)));
  } catch {
    // quota or blocked storage: shop unlocks just will not persist
  }
}

/** Attempts to unlock `material` using available points; returns `{ unlocked, ok }`. */
export function tryUnlockMaterial(
  levels: readonly Level[],
  best: BestStars,
  unlocked: readonly MaterialType[],
  material: MaterialType,
  unlockedGear: readonly GearId[] = [],
  unlockedPresets: readonly PresetName[] = [],
  bonusPoints = 0,
): { unlocked: MaterialType[]; ok: boolean } {
  const current = normalizeUnlocked(unlocked);
  if (!isBuiltinMaterial(material)) return { unlocked: current, ok: false };
  const cost = MATERIALS[material].cost;
  if (cost === undefined || current.includes(material)) {
    return { unlocked: current, ok: false };
  }
  const available = computeAvailablePoints(levels, best, current, unlockedGear, unlockedPresets, bonusPoints);
  if (available < cost) {
    return { unlocked: current, ok: false };
  }
  return { unlocked: normalizeUnlocked([...current, material]), ok: true };
}

function normalizeGearIds(items: readonly string[]): GearId[] {
  const set = new Set<string>(BASE_GEAR);
  for (const item of items) {
    if (isGearId(item)) set.add(item);
  }
  return GEAR_ORDER.filter((g) => set.has(g));
}

function sanitizeGearSave(save: GearSave): GearSave {
  const unlocked = normalizeGearIds(save.unlocked);
  const armor = save.armor && isArmorId(save.armor) && unlocked.includes(save.armor) ? save.armor : null;
  const weapon =
    save.weapon && isWeaponId(save.weapon) && unlocked.includes(save.weapon) ? save.weapon : null;
  return { unlocked, armor, weapon };
}

/** Reads unlocked and equipped first-person gear from storage. */
export function loadGear(storage: StorageLike | null = defaultStorage()): GearSave {
  const empty: GearSave = { unlocked: [...BASE_GEAR], armor: null, weapon: DEFAULT_WEAPON };
  try {
    const raw = storage?.getItem(GEAR_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty;
    const saved = new Map(Object.entries(parsed));
    const rawUnlocked = saved.get('unlocked');
    const unlockedRaw = Array.isArray(rawUnlocked)
      ? rawUnlocked.filter((x): x is string => typeof x === 'string')
      : [];
    const rawArmor = saved.get('armor');
    const armor = typeof rawArmor === 'string' && isArmorId(rawArmor) ? rawArmor : null;
    const rawWeapon = saved.get('weapon');
    const weapon = saved.has('weapon')
      ? rawWeapon === null
        ? null
        : typeof rawWeapon === 'string' && isWeaponId(rawWeapon)
          ? rawWeapon
          : DEFAULT_WEAPON
      : DEFAULT_WEAPON;
    return sanitizeGearSave({ unlocked: normalizeGearIds(unlockedRaw), armor, weapon });
  } catch {
    return empty;
  }
}

export function saveGear(gear: GearSave, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(GEAR_KEY, JSON.stringify(sanitizeGearSave(gear)));
  } catch {
    // quota or blocked storage: gear state just will not persist
  }
}

/** Attempts to unlock first-person `gearId` using available points; returns `{ unlocked, ok }`. */
export function tryUnlockGear(
  levels: readonly Level[],
  best: BestStars,
  unlockedMaterials: readonly MaterialType[],
  unlockedGear: readonly GearId[],
  gearId: GearId,
  unlockedPresets: readonly PresetName[] = [],
  bonusPoints = 0,
): { unlocked: GearId[]; ok: boolean } {
  const current = normalizeGearIds(unlockedGear);
  if (!isGearId(gearId) || current.includes(gearId)) {
    return { unlocked: current, ok: false };
  }
  const available = computeAvailablePoints(
    levels,
    best,
    unlockedMaterials,
    current,
    unlockedPresets,
    bonusPoints,
  );
  if (available < GEAR[gearId].cost) {
    return { unlocked: current, ok: false };
  }
  return { unlocked: normalizeGearIds([...current, gearId]), ok: true };
}

function normalizeUnlockedPresets(items: readonly string[]): PresetName[] {
  const set = new Set<string>(BASE_PRESETS);
  for (const item of items) {
    if (isPresetName(item)) set.add(item);
  }
  return PRESET_ORDER.filter((p) => set.has(p));
}

/** Reads unlocked quick-builder presets from storage, always preserving base presets. */
export function loadUnlockedPresets(storage: StorageLike | null = defaultStorage()): PresetName[] {
  const set = new Set<PresetName>(BASE_PRESETS);
  try {
    const raw = storage?.getItem(PRESETS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'string' && isPresetName(item)) {
          set.add(item);
        }
      }
    }
  } catch {
    // corrupt JSON or blocked storage: start with base presets
  }
  return PRESET_ORDER.filter((p) => set.has(p));
}

export function saveUnlockedPresets(
  unlocked: readonly PresetName[],
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PRESETS_KEY, JSON.stringify(normalizeUnlockedPresets(unlocked)));
  } catch {
    // quota or blocked storage: preset unlocks just will not persist
  }
}

/** Attempts to unlock quick-builder `preset` using available points; returns `{ unlocked, ok }`. */
export function tryUnlockPreset(
  levels: readonly Level[],
  best: BestStars,
  unlockedMaterials: readonly MaterialType[],
  unlockedGear: readonly GearId[],
  unlockedPresets: readonly PresetName[],
  preset: PresetName,
  bonusPoints = 0,
): { unlocked: PresetName[]; ok: boolean } {
  const current = normalizeUnlockedPresets(unlockedPresets);
  if (!isPresetName(preset)) return { unlocked: current, ok: false };
  const cost = PRESET_DEFS[preset].cost;
  if (cost === undefined || current.includes(preset)) {
    return { unlocked: current, ok: false };
  }
  const available = computeAvailablePoints(
    levels,
    best,
    unlockedMaterials,
    unlockedGear,
    current,
    bonusPoints,
  );
  if (available < cost) {
    return { unlocked: current, ok: false };
  }
  return { unlocked: normalizeUnlockedPresets([...current, preset]), ok: true };
}

const toNonNegInt = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

function sanitizeSurvivalSave(save: SurvivalSave): SurvivalSave {
  return {
    bestWave: toNonNegInt(save.bestWave),
    bonusPoints: toNonNegInt(save.bonusPoints),
  };
}

/** Reads best Survival wave and earned Survival bonus points from storage. */
export function loadSurvival(storage: StorageLike | null = defaultStorage()): SurvivalSave {
  const empty: SurvivalSave = { bestWave: 0, bonusPoints: 0 };
  try {
    const raw = storage?.getItem(SURVIVAL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty;
    const saved = new Map(Object.entries(parsed));
    return sanitizeSurvivalSave({
      bestWave: toNonNegInt(saved.get('bestWave')),
      bonusPoints: toNonNegInt(saved.get('bonusPoints')),
    });
  } catch {
    return empty;
  }
}

export function saveSurvival(save: SurvivalSave, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(SURVIVAL_KEY, JSON.stringify(sanitizeSurvivalSave(save)));
  } catch {
    // quota or blocked storage: survival record just will not persist
  }
}
