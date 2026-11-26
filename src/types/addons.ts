/**
 * The "extra" menu add-ons that tweak a disaster run (bouncy blocks, giant hail, double trouble,
 * slow motion). Pure data + helpers: no three.js / Rapier / React. Each add-on only adds optional
 * `SimOptions`-style knobs, so with every add-on off the simulation is byte-for-byte unchanged.
 */

export type DisasterAddonId = 'bouncyBlocks' | 'giantHail' | 'doubleTrouble' | 'slowMotion';

export type DisasterAddonFlags = Record<DisasterAddonId, boolean>;

/** Optional simulation knobs produced by the disaster add-ons (all absent when nothing is on). */
export interface DisasterAddonSimOptions {
  /** Restitution (0..1) given to every block collider. */
  blockRestitution?: number;
  /** Multiplies the radius of every falling/flying disaster projectile. */
  projectileScale?: number;
  /** Multiplies how many projectiles a disaster spawns per second. */
  spawnRateMultiplier?: number;
  /** Multiplies the speed the simulation clock runs at (< 1 is slow motion). */
  timeScale?: number;
}

export const DISASTER_ADDON_IDS: readonly DisasterAddonId[] = [
  'bouncyBlocks',
  'giantHail',
  'doubleTrouble',
  'slowMotion',
];

export const ADDON_TUNING = {
  bouncyRestitution: 0.85,
  giantProjectileScale: 1.6,
  doubleSpawnRate: 2,
  slowTimeScale: 0.4,
} as const;

export const DISASTER_ADDONS_OFF: DisasterAddonFlags = {
  bouncyBlocks: false,
  giantHail: false,
  doubleTrouble: false,
  slowMotion: false,
};

export const DISASTER_ADDON_INFO: Readonly<
  Record<DisasterAddonId, { label: string; badge: string; desc: string }>
> = {
  bouncyBlocks: { label: 'Bouncy Blocks', badge: 'Bouncy', desc: 'Every block boings like a rubber ball!' },
  giantHail: { label: 'Giant Hail', badge: 'Giant', desc: 'Falling hail, meteors and fireballs are huge!' },
  doubleTrouble: {
    label: 'Double Trouble',
    badge: 'x2',
    desc: 'Twice as many hailstones, meteors and more!',
  },
  slowMotion: { label: 'Slow-Mo Storm', badge: 'Slow-Mo', desc: 'Disasters play in dramatic slow motion.' },
};

/** Reads the four add-on flags out of any object that carries them (e.g. UI state or a save file). */
export function pickDisasterAddons(src: { [K in DisasterAddonId]?: unknown }): DisasterAddonFlags {
  return {
    bouncyBlocks: src.bouncyBlocks === true,
    giantHail: src.giantHail === true,
    doubleTrouble: src.doubleTrouble === true,
    slowMotion: src.slowMotion === true,
  };
}

/** Sim options for the active add-ons. Returns `{}` when none are on (so physics stays untouched). */
export function disasterAddonSimOptions(flags: Partial<DisasterAddonFlags>): DisasterAddonSimOptions {
  const out: DisasterAddonSimOptions = {};
  if (flags.bouncyBlocks) out.blockRestitution = ADDON_TUNING.bouncyRestitution;
  if (flags.giantHail) out.projectileScale = ADDON_TUNING.giantProjectileScale;
  if (flags.doubleTrouble) out.spawnRateMultiplier = ADDON_TUNING.doubleSpawnRate;
  if (flags.slowMotion) out.timeScale = ADDON_TUNING.slowTimeScale;
  return out;
}
