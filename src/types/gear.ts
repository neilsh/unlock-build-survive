/**
 * Pure, serializable first-person gear definitions (armor & weapons).
 * No three.js, Rapier or React imports allowed here.
 */

export type ArmorId = 'hard_hat' | 'knight_armor' | 'hazard_suit' | 'mech_suit';
export type WeaponId = 'pebble_popper' | 'slingshot' | 'ray_blaster' | 'shock_cannon';
export type GearId = ArmorId | WeaponId;
export type GearSlot = 'armor' | 'weapon';

interface GearBase {
  id: GearId;
  slot: GearSlot;
  label: string;
  color: number;
  cost: number;
  description: string;
}

export interface ArmorDef extends GearBase {
  id: ArmorId;
  slot: 'armor';
  /** Flat bonus added to base max HP while equipped. */
  bonusHp: number;
  /** Fraction (0..1) of non-fall damage reduced. */
  damageReduction: number;
  /** True when the armor prevents flood drowning damage. */
  floodImmune?: boolean;
  /** Multiplier applied to first-person jump speed. */
  jumpMultiplier?: number;
}

export interface WeaponDef extends GearBase {
  id: WeaponId;
  slot: 'weapon';
  /** Damage dealt per shot to hit projectiles. */
  damage: number;
  /** Maximum ray hit distance in world units. */
  range: number;
  /** Minimum seconds between shots. */
  cooldown: number;
  /** Radius around the hit point where nearby projectiles also take damage (0 = single target). */
  splashRadius: number;
}

export type GearDef = ArmorDef | WeaponDef;

export const ARMORS: Record<ArmorId, ArmorDef> = {
  hard_hat: {
    id: 'hard_hat',
    slot: 'armor',
    label: 'Hard Hat',
    color: 0xfacc15,
    cost: 100,
    bonusHp: 40,
    damageReduction: 0.2,
    description: 'Bright safety helmet that adds +40 HP and cushions 20% of hits.',
  },
  knight_armor: {
    id: 'knight_armor',
    slot: 'armor',
    label: 'Knight Armor',
    color: 0x94a3b8,
    cost: 250,
    bonusHp: 100,
    damageReduction: 0.4,
    description: 'Heavy steel plate that doubles your HP and blocks 40% of damage.',
  },
  hazard_suit: {
    id: 'hazard_suit',
    slot: 'armor',
    label: 'Hazard Suit',
    color: 0xf97316,
    cost: 450,
    bonusHp: 120,
    damageReduction: 0.45,
    floodImmune: true,
    description: 'Sealed rescue suit with +120 HP, 45% armor, and flood breathing.',
  },
  mech_suit: {
    id: 'mech_suit',
    slot: 'armor',
    label: 'Mech Suit',
    color: 0x38bdf8,
    cost: 750,
    bonusHp: 200,
    damageReduction: 0.6,
    floodImmune: true,
    jumpMultiplier: 1.35,
    description: 'Powered exo-suit: +200 HP, 60% armor, floodproof, and boosted jumps!',
  },
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pebble_popper: {
    id: 'pebble_popper',
    slot: 'weapon',
    label: 'Pebble Popper',
    color: 0x10b981,
    cost: 0,
    damage: 1,
    range: 14,
    cooldown: 0.6,
    splashRadius: 0,
    description: 'Free starter popper that bats away falling hail, snowballs, and sparks!',
  },
  slingshot: {
    id: 'slingshot',
    slot: 'weapon',
    label: 'Slingshot',
    color: 0xd97706,
    cost: 100,
    damage: 1,
    range: 18,
    cooldown: 0.45,
    splashRadius: 0,
    description: 'Snappy pocket slingshot that knocks flying hazards out of the sky.',
  },
  ray_blaster: {
    id: 'ray_blaster',
    slot: 'weapon',
    label: 'Ray Blaster',
    color: 0xef4444,
    cost: 300,
    damage: 2,
    range: 28,
    cooldown: 0.35,
    splashRadius: 1.5,
    description: 'High-power laser blaster that vaporizes meteors in a single shot!',
  },
  shock_cannon: {
    id: 'shock_cannon',
    slot: 'weapon',
    label: 'Shock Cannon',
    color: 0xa855f7,
    cost: 550,
    damage: 2,
    range: 26,
    cooldown: 0.65,
    splashRadius: 5.0,
    description: 'Plasma blast cannon that clears whole waves of incoming hazards at once.',
  },
};

export const ARMOR_ORDER: readonly ArmorId[] = ['hard_hat', 'knight_armor', 'hazard_suit', 'mech_suit'];
export const WEAPON_ORDER: readonly WeaponId[] = [
  'pebble_popper',
  'slingshot',
  'ray_blaster',
  'shock_cannon',
];
export const BASE_GEAR: readonly GearId[] = ['pebble_popper'];
export const DEFAULT_WEAPON: WeaponId = 'pebble_popper';

export const GEAR: Record<GearId, GearDef> = {
  ...ARMORS,
  ...WEAPONS,
};

export const GEAR_ORDER: readonly GearId[] = [...ARMOR_ORDER, ...WEAPON_ORDER].toSorted(
  (a, b) => GEAR[a].cost - GEAR[b].cost,
);

const ARMOR_SET = new Set<string>(ARMOR_ORDER);
const WEAPON_SET = new Set<string>(WEAPON_ORDER);

export function isArmorId(id: string): id is ArmorId {
  return ARMOR_SET.has(id);
}

export function isWeaponId(id: string): id is WeaponId {
  return WEAPON_SET.has(id);
}

export function isGearId(id: string): id is GearId {
  return ARMOR_SET.has(id) || WEAPON_SET.has(id);
}
