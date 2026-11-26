import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';
import type { ModDisasterDef } from '../../mods/mods';
import type { DisasterType, ProjectileKind, Telemetry } from '../../types/blueprint';
import type { MaterialDef } from '../../types/materials';
import type { Projectile } from './projectiles';
import type { Rapier } from './rapier';
import type { PhysicsEvents } from './tuning';
import type { BlockRec, HelperEntry, LaserEntry, Link, ShieldDome, StrutRec } from './types';

/**
 * Shared mutable state of one disaster run. `SimRun` implements it and the stateless functions in
 * worldBuilder / disasters / combat / strain operate on it, so there is no per-system class
 * indirection in the hot loop and RNG call order stays identical.
 */
export interface SimContext {
  readonly R: Rapier;
  readonly world: World;
  readonly ground: RigidBody;
  readonly blocks: BlockRec[];
  readonly struts: StrutRec[];
  readonly links: Link[];
  readonly shieldBlocks: BlockRec[];
  readonly shieldDomes: ShieldDome[];
  readonly lasers: LaserEntry[];
  readonly helpers: HelperEntry[];
  projectiles: Projectile[];
  readonly projectileGeom: THREE.SphereGeometry;
  readonly projectileMats: Record<ProjectileKind, THREE.MeshStandardMaterial>;
  readonly shieldGeom: THREE.SphereGeometry;
  readonly shieldMat: THREE.MeshBasicMaterial;
  readonly rng: () => number;
  readonly quakePhase: number[];
  flowAngle: number;
  readonly flowSpin: number;
  gust: number;
  gustTarget: number;
  gustTimer: number;
  spawnAccumulator: number;
  readonly spawnBox: { minX: number; maxX: number; minZ: number; maxZ: number; top: number };
  readonly customMaterials?: ReadonlyMap<string, MaterialDef>;
  readonly customDisaster?: ModDisasterDef;
  readonly gravity: number;
  readonly duration: number;
  readonly disaster: DisasterType;
  /** Disaster force multiplier from the strength level. */
  readonly power: number;
  readonly effectsRoot: THREE.Object3D | null;
  readonly events: () => PhysicsEvents;
  running: boolean;
  peakStrain: number;
  peakStrainId: string | null;
  mode: Telemetry['mode'];
  time: number;
  brokenCount: number;
  firstBrokenId: string | null;
  waterLevel: number;
  /** Set by breakLink: blocks whose last link broke must be marked loose at the next standing check. */
  linksDirty: boolean;
  standingRatio: number;
  playerInvuln: number;
  /** Hit-protection timer for Player 2 (split-screen), separate from Player 1's. */
  player2Invuln: number;
}
