import type { BuiltinMaterialType, MaterialType } from './blueprint';

export interface MaterialDef {
  id: MaterialType;
  label: string;
  /** Base colour (also used to paint the procedural texture). */
  color: number;
  /** Mass per unit volume, relative units. */
  density: number;
  /** Joint spring stiffness multiplier. */
  stiffness: number;
  /**
   * Break threshold. Strain ratio = joint stretch / (maxStress * a stretch unit owned by
   * PhysicsSim). Tuned by the physics package; the values here are starting points.
   */
  maxStress: number;
  /** 0 = sinks, 1 = neutrally buoyant, >1 floats. */
  buoyancy: number;
  /** Point cost in the unlock shop; omitted means unlocked from the start. */
  cost?: number;
  /** Shop filter category for unlockable items. */
  shopCategory?: 'structural' | 'defense';
  /** Short kid-friendly shop description. */
  description?: string;
  /** Multiplier applied to foundation anchor break limits for ground blocks. */
  anchorMultiplier?: number;
  /** Active defense behaviour during a disaster. */
  special?: 'shield' | 'laser';
}

export const MATERIALS: Record<BuiltinMaterialType, MaterialDef> = {
  wood: {
    id: 'wood',
    label: 'Wood',
    color: 0xc58b4c,
    density: 0.6,
    stiffness: 1.0,
    maxStress: 1.0,
    buoyancy: 1.3,
  },
  stone: {
    id: 'stone',
    label: 'Stone',
    color: 0x9aa0a8,
    density: 2.0,
    stiffness: 1.6,
    maxStress: 1.6,
    buoyancy: 0.0,
  },
  bamboo: {
    id: 'bamboo',
    label: 'Bamboo',
    color: 0x9ccc65,
    density: 0.45,
    stiffness: 0.7,
    maxStress: 1.3,
    buoyancy: 1.4,
  },
  foam: {
    id: 'foam',
    label: 'Foam',
    color: 0xf8bbd0,
    density: 0.15,
    stiffness: 0.3,
    maxStress: 0.5,
    buoyancy: 3.0,
  },
  rubber: {
    id: 'rubber',
    label: 'Rubber',
    color: 0xff7043,
    density: 0.7,
    stiffness: 0.45,
    maxStress: 2.2,
    buoyancy: 1.5,
    cost: 100,
    shopCategory: 'structural',
    description: 'Super-stretchy shock absorber that bends instead of snapping.',
  },
  anchor: {
    id: 'anchor',
    label: 'Anchor',
    color: 0x455a64,
    density: 2.8,
    stiffness: 2.0,
    maxStress: 2.6,
    buoyancy: 0.0,
    anchorMultiplier: 3.0,
    cost: 150,
    shopCategory: 'defense',
    description: 'Magnetic base that grips the island 3x tighter.',
  },
  pontoon: {
    id: 'pontoon',
    label: 'Pontoon',
    color: 0xffca28,
    density: 0.25,
    stiffness: 1.1,
    maxStress: 1.8,
    buoyancy: 3.8,
    cost: 200,
    shopCategory: 'structural',
    description: 'Tough inflatable float block that rides out big floods.',
  },
  steel: {
    id: 'steel',
    label: 'Steel',
    color: 0x607d8b,
    density: 2.6,
    stiffness: 2.0,
    maxStress: 2.6,
    buoyancy: 0.0,
    cost: 250,
    shopCategory: 'structural',
    description: 'Ultra-tough metal for heavy frames and braces.',
  },
  carbon: {
    id: 'carbon',
    label: 'Carbon',
    color: 0x37474f,
    density: 0.35,
    stiffness: 2.2,
    maxStress: 2.4,
    buoyancy: 0.8,
    cost: 300,
    shopCategory: 'structural',
    description: 'Featherlight space-age weave — super strong for tall towers.',
  },
  shield: {
    id: 'shield',
    label: 'Shield',
    color: 0x29b6f6,
    density: 1.4,
    stiffness: 1.3,
    maxStress: 1.5,
    buoyancy: 0.2,
    special: 'shield',
    cost: 350,
    shopCategory: 'defense',
    description: 'Projects a glowing aura that reinforces nearby blocks.',
  },
  titanium: {
    id: 'titanium',
    label: 'Titanium',
    color: 0xb0bec5,
    density: 1.8,
    stiffness: 2.6,
    maxStress: 3.4,
    buoyancy: 0.0,
    anchorMultiplier: 2.0,
    cost: 450,
    shopCategory: 'structural',
    description: 'Lighter than steel and way tougher, with built-in ground grip.',
  },
  laser: {
    id: 'laser',
    label: 'Laser',
    color: 0xef5350,
    density: 1.4,
    stiffness: 1.3,
    maxStress: 1.4,
    buoyancy: 0.2,
    special: 'laser',
    cost: 500,
    shopCategory: 'defense',
    description: 'Zaps incoming fireballs, snow, hail, raiders, and meteors.',
  },
  magnet: {
    id: 'magnet',
    label: 'Magnet',
    color: 0x7e57c2,
    density: 2.2,
    stiffness: 2.4,
    maxStress: 2.8,
    buoyancy: 0.0,
    anchorMultiplier: 5.0,
    cost: 600,
    shopCategory: 'defense',
    description: 'Super-powered electromagnet that locks onto the island 5x tighter.',
  },
  diamond: {
    id: 'diamond',
    label: 'Diamond',
    color: 0x4dd0e1,
    density: 2.4,
    stiffness: 3.0,
    maxStress: 4.5,
    buoyancy: 0.0,
    special: 'shield',
    cost: 800,
    shopCategory: 'defense',
    description: 'Nearly unbreakable crystal core that also projects a protective shield.',
  },
  door: {
    id: 'door',
    label: 'Door',
    color: 0x8d5524,
    density: 0.65,
    stiffness: 1.0,
    maxStress: 1.1,
    buoyancy: 1.2,
  },
};

export const BASE_MATERIALS: BuiltinMaterialType[] = ['wood', 'stone', 'bamboo', 'foam', 'door'];
export const UNLOCKABLE_MATERIALS: BuiltinMaterialType[] = [
  'rubber',
  'anchor',
  'pontoon',
  'steel',
  'carbon',
  'shield',
  'titanium',
  'laser',
  'magnet',
  'diamond',
];
export const MATERIAL_ORDER: BuiltinMaterialType[] = [...BASE_MATERIALS, ...UNLOCKABLE_MATERIALS];

const BUILTIN_MATERIAL_SET = new Set<string>(MATERIAL_ORDER);

export function isBuiltinMaterial(m: string): m is BuiltinMaterialType {
  return BUILTIN_MATERIAL_SET.has(m);
}

export function getMaterialDef(m: MaterialType, custom?: ReadonlyMap<string, MaterialDef>): MaterialDef {
  if (isBuiltinMaterial(m)) return MATERIALS[m];
  return custom?.get(m) ?? MATERIALS.wood;
}
