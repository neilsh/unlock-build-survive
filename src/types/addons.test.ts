import { describe, expect, it } from 'vitest';
import {
  ADDON_TUNING,
  DISASTER_ADDONS_OFF,
  DISASTER_ADDON_IDS,
  DISASTER_ADDON_INFO,
  disasterAddonSimOptions,
  pickDisasterAddons,
} from './addons';

describe('disaster add-ons', () => {
  it('produce no sim options when everything is off (physics untouched)', () => {
    expect(disasterAddonSimOptions(DISASTER_ADDONS_OFF)).toEqual({});
    expect(disasterAddonSimOptions({})).toEqual({});
  });

  it('map each add-on to exactly its own knob', () => {
    expect(disasterAddonSimOptions({ bouncyBlocks: true })).toEqual({
      blockRestitution: ADDON_TUNING.bouncyRestitution,
    });
    expect(disasterAddonSimOptions({ giantHail: true })).toEqual({
      projectileScale: ADDON_TUNING.giantProjectileScale,
    });
    expect(disasterAddonSimOptions({ doubleTrouble: true })).toEqual({
      spawnRateMultiplier: ADDON_TUNING.doubleSpawnRate,
    });
    expect(disasterAddonSimOptions({ slowMotion: true })).toEqual({ timeScale: ADDON_TUNING.slowTimeScale });
  });

  it('stack when several are on', () => {
    const all = disasterAddonSimOptions({
      bouncyBlocks: true,
      giantHail: true,
      doubleTrouble: true,
      slowMotion: true,
    });
    expect(Object.keys(all)).toHaveLength(4);
  });

  it('keeps spawn load and slow-mo within sane bounds', () => {
    expect(ADDON_TUNING.doubleSpawnRate).toBeLessThanOrEqual(2);
    expect(ADDON_TUNING.slowTimeScale).toBeGreaterThan(0.2);
    expect(ADDON_TUNING.slowTimeScale).toBeLessThan(1);
    expect(ADDON_TUNING.bouncyRestitution).toBeLessThanOrEqual(1);
  });

  it('pickDisasterAddons only accepts literal true and ignores other fields', () => {
    expect(pickDisasterAddons({ bouncyBlocks: true, giantHail: 'yes', slowMotion: 1 })).toEqual({
      bouncyBlocks: true,
      giantHail: false,
      doubleTrouble: false,
      slowMotion: false,
    });
    expect(pickDisasterAddons({})).toEqual(DISASTER_ADDONS_OFF);
  });

  it('has a label, badge and description for every add-on', () => {
    for (const id of DISASTER_ADDON_IDS) {
      const info = DISASTER_ADDON_INFO[id];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.badge.length).toBeGreaterThan(0);
      expect(info.desc.length).toBeGreaterThan(0);
    }
    expect(Object.keys(DISASTER_ADDONS_OFF).toSorted()).toEqual([...DISASTER_ADDON_IDS].toSorted());
  });
});
