import { describe, expect, it } from 'vitest';
import {
  BASE_MATERIALS,
  BASE_PRESETS,
  MATERIALS,
  PRESET_DEFS,
  UNLOCKABLE_MATERIALS,
  UNLOCKABLE_PRESETS,
} from '../types/blueprint';
import { BASE_GEAR, DEFAULT_WEAPON, GEAR, GEAR_ORDER } from '../types/gear';
import { LEVELS } from './levels';
import {
  CLEAR_BONUS,
  GEAR_KEY,
  POINTS_PER_STAR,
  PRESETS_KEY,
  PROGRESS_KEY,
  SHOP_KEY,
  SURVIVAL_KEY,
  computeAvailablePoints,
  computeSpentPoints,
  computeTotalPoints,
  computeUnlocked,
  loadBest,
  loadGear,
  loadSurvival,
  loadUnlockedMaterials,
  loadUnlockedPresets,
  recordResult,
  saveBest,
  saveGear,
  saveSurvival,
  saveUnlockedMaterials,
  saveUnlockedPresets,
  tryUnlockGear,
  tryUnlockMaterial,
  tryUnlockPreset,
  type StorageLike,
} from './progress';

function fakeStorage(initial?: string, key = PROGRESS_KEY): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[key, initial]]);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const [first, second, third] = LEVELS;
if (!first || !second || !third) throw new Error('need at least three levels');

describe('computeUnlocked', () => {
  it('opens only the first level at the start', () => {
    expect(computeUnlocked(LEVELS, {})).toEqual([first.id]);
  });

  it('needs the goal stars to open the next level', () => {
    expect(computeUnlocked(LEVELS, { [first.id]: 0 })).toEqual([first.id]);
    expect(computeUnlocked(LEVELS, { [first.id]: first.goalStars })).toEqual([first.id, second.id]);
  });

  it('does not skip ahead over a level that is not beaten', () => {
    expect(computeUnlocked(LEVELS, { [third.id]: 3 })).toEqual([first.id]);
  });
});

describe('recordResult', () => {
  it('unlocks the next level once and keeps the best score', () => {
    const win = recordResult(LEVELS, {}, first.id, 3);
    expect(win).toMatchObject({ goalReached: true, newlyUnlocked: second.id, best: { [first.id]: 3 } });
    const again = recordResult(LEVELS, win.best, first.id, 1);
    expect(again.best[first.id]).toBe(3);
    expect(again.newlyUnlocked).toBeNull();
  });

  it('reports a miss without unlocking', () => {
    const miss = recordResult(LEVELS, {}, second.id, 0);
    expect(miss).toMatchObject({ goalReached: false, newlyUnlocked: null });
  });

  it('ignores unknown levels', () => {
    expect(recordResult(LEVELS, {}, 'nope', 3)).toEqual({
      best: {},
      goalReached: false,
      newlyUnlocked: null,
    });
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage();
    saveBest({ [first.id]: 2 }, storage);
    expect(loadBest(LEVELS, storage)).toEqual({ [first.id]: 2 });
  });

  it('survives corrupt, hostile or missing data', () => {
    expect(loadBest(LEVELS, fakeStorage('{not json'))).toEqual({});
    expect(loadBest(LEVELS, fakeStorage('[1,2]'))).toEqual({});
    expect(loadBest(LEVELS, fakeStorage('null'))).toEqual({});
    expect(
      loadBest(LEVELS, fakeStorage(JSON.stringify({ [first.id]: 9, ghost: 3, [second.id]: 2 }))),
    ).toEqual({
      [second.id]: 2,
    });
    expect(loadBest(LEVELS, null)).toEqual({});
  });

  it('does not throw when storage is blocked', () => {
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadBest(LEVELS, blocked)).toEqual({});
    expect(() => saveBest({}, blocked)).not.toThrow();
  });
});

describe('points and shop unlocks', () => {
  it('computes points per best star plus clear bonus', () => {
    expect(computeTotalPoints(LEVELS, {})).toBe(0);
    // first has goalStars=1, third has goalStars=2
    const best = { [first.id]: 3 as const, [third.id]: 1 as const };
    expect(computeTotalPoints(LEVELS, best)).toBe(3 * POINTS_PER_STAR + CLEAR_BONUS + 1 * POINTS_PER_STAR);
  });

  it('computes spent and available points without dropping below zero', () => {
    const best = { [first.id]: 2 as const }; // 2 * 100 + 50 = 250 pts
    expect(computeSpentPoints(BASE_MATERIALS)).toBe(0);
    expect(computeSpentPoints([...BASE_MATERIALS, 'anchor'])).toBe(MATERIALS.anchor.cost);
    expect(computeAvailablePoints(LEVELS, best, [...BASE_MATERIALS, 'anchor'])).toBe(
      250 - (MATERIALS.anchor.cost ?? 0),
    );
    expect(computeAvailablePoints(LEVELS, {}, [...BASE_MATERIALS, 'laser'])).toBe(0);
  });

  it('tryUnlockMaterial validates cost and ownership', () => {
    const best = { [first.id]: 2 as const }; // 250 pts
    // Laser costs 500 -> fails
    expect(tryUnlockMaterial(LEVELS, best, BASE_MATERIALS, 'laser').ok).toBe(false);
    // Anchor costs 150 -> succeeds
    const buyAnchor = tryUnlockMaterial(LEVELS, best, BASE_MATERIALS, 'anchor');
    expect(buyAnchor.ok).toBe(true);
    expect(buyAnchor.unlocked).toContain('anchor');
    // Buying anchor again -> fails
    expect(tryUnlockMaterial(LEVELS, best, buyAnchor.unlocked, 'anchor').ok).toBe(false);
    // Remaining 100 pts < Steel 250 -> fails
    expect(tryUnlockMaterial(LEVELS, best, buyAnchor.unlocked, 'steel').ok).toBe(false);
  });

  it('round-trips unlocked materials and handles corrupt storage', () => {
    const storage = fakeStorage();
    saveUnlockedMaterials([...BASE_MATERIALS, 'shield'], storage);
    expect(loadUnlockedMaterials(storage)).toEqual([...BASE_MATERIALS, 'shield']);
    expect(loadUnlockedMaterials(fakeStorage('{bad', SHOP_KEY))).toEqual(BASE_MATERIALS);
    expect(loadUnlockedMaterials(fakeStorage(JSON.stringify(['nope', 123, 'laser']), SHOP_KEY))).toEqual([
      ...BASE_MATERIALS,
      'laser',
    ]);
  });

  it('gives every shop unlockable a positive cost, description, category, and ascending price order', () => {
    expect(UNLOCKABLE_MATERIALS.length).toBeGreaterThanOrEqual(10);
    let prevCost = 0;
    for (const m of UNLOCKABLE_MATERIALS) {
      const def = MATERIALS[m];
      expect(def.cost).toBeGreaterThan(0);
      expect(def.description?.trim().length).toBeGreaterThan(0);
      expect(def.shopCategory === 'structural' || def.shopCategory === 'defense').toBe(true);
      expect(def.cost!).toBeGreaterThanOrEqual(prevCost);
      prevCost = def.cost!;
    }
  });

  it('unlocks new shop items at their point tiers and gates diamond at 800 pts', () => {
    // first (3*100 + 50 = 350) -> enough for rubber (100) and pontoon (200), not diamond (800)
    const oneLevel = { [first.id]: 3 as const };
    const buyRubber = tryUnlockMaterial(LEVELS, oneLevel, BASE_MATERIALS, 'rubber');
    expect(buyRubber.ok).toBe(true);
    expect(buyRubber.unlocked).toContain('rubber');

    const buyPontoon = tryUnlockMaterial(LEVELS, oneLevel, buyRubber.unlocked, 'pontoon');
    expect(buyPontoon.ok).toBe(true);
    expect(buyPontoon.unlocked).toContain('pontoon');
    expect(computeAvailablePoints(LEVELS, oneLevel, buyPontoon.unlocked)).toBe(50);

    expect(tryUnlockMaterial(LEVELS, oneLevel, BASE_MATERIALS, 'diamond').ok).toBe(false);

    // Three cleared 3-star levels (3 * 350 = 1050 pts) -> diamond unlocks
    const threeLevels = { [first.id]: 3 as const, [second.id]: 3 as const, [third.id]: 3 as const };
    const buyDiamond = tryUnlockMaterial(LEVELS, threeLevels, BASE_MATERIALS, 'diamond');
    expect(buyDiamond.ok).toBe(true);
    expect(buyDiamond.unlocked).toContain('diamond');
  });

  it('validates first-person gear metadata, shared points pool, and gear persistence', () => {
    expect(GEAR_ORDER).toHaveLength(8);
    for (const id of BASE_GEAR) {
      expect(GEAR[id].cost).toBe(0);
    }
    for (const id of GEAR_ORDER.filter((g) => !BASE_GEAR.includes(g))) {
      expect(GEAR[id].cost).toBeGreaterThan(0);
    }
    for (const id of GEAR_ORDER) {
      expect(GEAR[id].description.trim().length).toBeGreaterThan(0);
    }

    // first level 3 stars = 350 pts
    const best = { [first.id]: 3 as const };
    // Spend 100 on rubber material + 100 on hard_hat + 100 on slingshot = 300 pts spent, 50 remaining
    const matRes = tryUnlockMaterial(LEVELS, best, BASE_MATERIALS, 'rubber');
    expect(matRes.ok).toBe(true);
    const hatRes = tryUnlockGear(LEVELS, best, matRes.unlocked, [], 'hard_hat');
    expect(hatRes.ok).toBe(true);
    const slingRes = tryUnlockGear(LEVELS, best, matRes.unlocked, hatRes.unlocked, 'slingshot');
    expect(slingRes.ok).toBe(true);
    expect(computeSpentPoints(matRes.unlocked, slingRes.unlocked)).toBe(300);
    expect(computeAvailablePoints(LEVELS, best, matRes.unlocked, slingRes.unlocked)).toBe(50);

    // Duplicate unlock or insufficient points fails
    expect(tryUnlockGear(LEVELS, best, matRes.unlocked, slingRes.unlocked, 'hard_hat').ok).toBe(false);
    expect(tryUnlockGear(LEVELS, best, matRes.unlocked, slingRes.unlocked, 'knight_armor').ok).toBe(false);

    // Persistence round-trip & corrupt/unowned sanitization
    const storage = fakeStorage();
    saveGear({ unlocked: ['hard_hat', 'slingshot'], armor: 'hard_hat', weapon: 'slingshot' }, storage);
    expect(loadGear(storage)).toEqual({
      unlocked: [...BASE_GEAR, 'hard_hat', 'slingshot'],
      armor: 'hard_hat',
      weapon: 'slingshot',
    });

    expect(loadGear(fakeStorage('{bad', GEAR_KEY))).toEqual({
      unlocked: [...BASE_GEAR],
      armor: null,
      weapon: DEFAULT_WEAPON,
    });
    expect(
      loadGear(
        fakeStorage(
          JSON.stringify({
            unlocked: ['nope', 'slingshot'],
            armor: 'mech_suit', // not owned -> dropped
            weapon: 'slingshot',
          }),
          GEAR_KEY,
        ),
      ),
    ).toEqual({ unlocked: [...BASE_GEAR, 'slingshot'], armor: null, weapon: 'slingshot' });
  });

  it('validates quick-builder preset metadata, shared points pool, and persistence', () => {
    expect(UNLOCKABLE_PRESETS).toEqual([
      'pyramid',
      'boat',
      'treehouse',
      'base',
      'laser_tower',
      'dome',
      'fortress',
    ]);
    let prevCost = 0;
    for (const p of UNLOCKABLE_PRESETS) {
      const def = PRESET_DEFS[p];
      expect(def.cost).toBeGreaterThan(0);
      expect(def.description?.trim().length).toBeGreaterThan(0);
      expect(def.badges?.length).toBeGreaterThan(0);
      expect(def.cost!).toBeGreaterThanOrEqual(prevCost);
      prevCost = def.cost!;
    }

    // 350 pts -> buy rubber (100) + hard_hat (100) + boat (150) = 350 pts spent, 0 remaining
    const best = { [first.id]: 3 as const };
    const matRes = tryUnlockMaterial(LEVELS, best, BASE_MATERIALS, 'rubber');
    const gearRes = tryUnlockGear(LEVELS, best, matRes.unlocked, [], 'hard_hat');
    const boatRes = tryUnlockPreset(LEVELS, best, matRes.unlocked, gearRes.unlocked, BASE_PRESETS, 'boat');
    expect(boatRes.ok).toBe(true);
    expect(boatRes.unlocked).toContain('boat');
    expect(computeSpentPoints(matRes.unlocked, gearRes.unlocked, boatRes.unlocked)).toBe(350);
    expect(computeAvailablePoints(LEVELS, best, matRes.unlocked, gearRes.unlocked, boatRes.unlocked)).toBe(0);

    // Duplicate or unaffordable unlock fails
    expect(
      tryUnlockPreset(LEVELS, best, matRes.unlocked, gearRes.unlocked, boatRes.unlocked, 'boat').ok,
    ).toBe(false);
    expect(tryUnlockPreset(LEVELS, best, BASE_MATERIALS, [], BASE_PRESETS, 'laser_tower').ok).toBe(false);

    // Round-trip & corrupt storage handling
    const storage = fakeStorage();
    saveUnlockedPresets([...BASE_PRESETS, 'base'], storage);
    expect(loadUnlockedPresets(storage)).toEqual([...BASE_PRESETS, 'base']);
    expect(loadUnlockedPresets(fakeStorage('{bad', PRESETS_KEY))).toEqual(BASE_PRESETS);
    expect(loadUnlockedPresets(fakeStorage(JSON.stringify(['bogus', 42, 'fortress']), PRESETS_KEY))).toEqual([
      ...BASE_PRESETS,
      'fortress',
    ]);
  });

  it('persists survival records safely and includes survival bonusPoints in shop spending', () => {
    const storage = fakeStorage();
    saveSurvival({ bestWave: 4, bonusPoints: 180 }, storage);
    expect(loadSurvival(storage)).toEqual({ bestWave: 4, bonusPoints: 180 });

    // Corrupt, negative, and non-integer data sanitize to 0
    expect(loadSurvival(fakeStorage('{bad', SURVIVAL_KEY))).toEqual({ bestWave: 0, bonusPoints: 0 });
    expect(loadSurvival(fakeStorage('[1,2]', SURVIVAL_KEY))).toEqual({ bestWave: 0, bonusPoints: 0 });
    expect(
      loadSurvival(fakeStorage(JSON.stringify({ bestWave: -2, bonusPoints: 12.5 }), SURVIVAL_KEY)),
    ).toEqual({ bestWave: 0, bonusPoints: 0 });

    // Even with 0 level stars, bonusPoints fund Shop purchases
    expect(computeAvailablePoints(LEVELS, {}, BASE_MATERIALS, [], BASE_PRESETS, 150)).toBe(150);
    expect(tryUnlockMaterial(LEVELS, {}, BASE_MATERIALS, 'anchor', [], BASE_PRESETS, 150).ok).toBe(true);
    expect(tryUnlockGear(LEVELS, {}, BASE_MATERIALS, [], 'hard_hat', BASE_PRESETS, 100).ok).toBe(true);
    expect(tryUnlockPreset(LEVELS, {}, BASE_MATERIALS, [], BASE_PRESETS, 'boat', 150).ok).toBe(true);
  });
});
