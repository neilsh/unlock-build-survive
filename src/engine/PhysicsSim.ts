/**
 * OWNER: package A (Rapier sim, disasters, X-ray, win state). Contract below is fixed; internals are yours.
 *
 * Rules from the spec: fixed 1/60 s accumulator with dt clamped to 0.05; joined bodies must have
 * contacts disabled; ground-level blocks get breakable anchors to the kinematic island body;
 * strain ratio > 1 removes the joint and records the FIRST broken id; survive 8 s with zero broken
 * joints to win. Initialise Rapier lazily on `start` (rapier3d-compat embeds its wasm, no fetch).
 *
 * Must be runnable headless in Node (Vitest) when given a `MeshRegistry` of plain PieceHandles, so the
 * tower-fails / house-survives calibration does not need a browser. Use a seeded RNG for gusts/hail.
 *
 * Lifecycle: start() -> mode 'simulating', isRunning() true. When the countdown reaches 0 the sim
 * stops stepping, isRunning() becomes false and mode becomes 'survived' (onSurvived fires) or
 * 'failed'; meshes stay where they ended up. stop() returns to mode 'build'. Calling start() while
 * running first stops the previous run.
 *
 * ---------------------------------------------------------------------------------------------
 * Model (package A internals):
 *  - Every block is a dynamic cuboid body. Face-adjacent blocks are linked by a 6-DOF spring joint
 *    at the shared face centre (contacts disabled between them). Ground-level blocks get the same
 *    kind of spring to the kinematic island body: the foundation anchor. Anchored blocks keep
 *    contact with the island so it carries their weight; their colliders touch it exactly, so there
 *    is no frame-1 overlap. Springs are Rapier generic-joint position motors, so they are solved
 *    implicitly and stay stable at any stiffness.
 *  - A strut is a 2-force truss member: a distance spring between the two corner points it joins.
 *    While intact its mesh follows its two end points; once it breaks it becomes a falling stick.
 *  - Stretch of a block link = anchor-point separation + relative rotation angle * half a cell.
 *    Stretch of a strut = |length - rest length|. Strain ratio = stretch / (maxStress * stretchUnit),
 *    using the weaker material of the two pieces.
 *  - Strength (gentle / medium / strong) scales every disaster's driving force by
 *    PHYSICS_TUNING.strength: quake amplitude, wind force, flood current, and hail rate and speed.
 *    Medium (x1) is the calibrated baseline. Material limits never change with strength.
 *  - Scoring: a block is standing while it still has at least one intact link (anchor, face link
 *    or strut) and its centre sits within `standing.tolerance` of where it started, measured relative
 *    to the (possibly shaking) island. So an intact chunk that lost its anchor but did not move still
 *    counts, while a block whose every joint broke is rubble even if it happens to lie in place. A
 *    strut is standing while it is unbroken and every block it hangs from is standing. Falling is
 *    sticky: a piece that fell stays fallen.
 *    standingRatio = standing pieces / all pieces (1 for an empty island). Stars: 3 with zero broken
 *    joints, else 2 at >= 80 % standing, 1 at >= 50 %, else 0 (see `starsFor`).
 *  - Hail stones are drawn as simple spheres under the effects root (see setEffectsRoot; Game
 *    passes the scene) and removed again on stop(). With no root, hail is simulated but not drawn.
 */
import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type {
  BlueprintGraph,
  DisasterType,
  ProjectileKind,
  Strength,
  Telemetry,
  Vec3,
} from '../types/blueprint';
import { DEFAULT_STRENGTH, DISASTER_SECONDS, ISLAND_SIZE } from '../types/blueprint';
import type { MaterialDef } from '../types/materials';
import type { ModDisasterDef } from '../mods/mods';
import type { WeaponDef } from '../types/gear';
import { mulberry32 } from '../utils/rng';
import type { MeshRegistry } from './BuildController';
import { checkPlayerDamage, firePlayerWeapon, updateLasers } from './physics/combat';
import type { SimContext } from './physics/context';
import { applyDisaster, disasterIntensity } from './physics/disasters';
import { createProjectileMaterials, type Projectile } from './physics/projectiles';
import { loadRapier, type Rapier } from './physics/rapier';
import { measureAndBreak, syncMeshes, updateStanding } from './physics/strain';
import {
  PHYSICS_TUNING,
  WATER_HIDDEN,
  starsFor,
  type PhysicsEvents,
  type PhysicsTelemetry,
  type PlayerHitResult,
  type PlayerProtection,
  type SimOptions,
  type WeaponFireResult,
} from './physics/tuning';
import type { BlockRec, LaserEntry, Link, ShieldDome, StrutRec } from './physics/types';
import { addBlocks, addStrut } from './physics/worldBuilder';

export { PHYSICS_TUNING, loadRapier, starsFor };
export type { PhysicsEvents, PlayerHitResult, PlayerProtection, SimOptions, WeaponFireResult };
export const makeRng = mulberry32;

const T = PHYSICS_TUNING;
// ------------------------------------------------------------------ public API

export class PhysicsSim {
  private run: SimRun | null = null;
  /** Bumped by start/stop so a slow Rapier init cannot resurrect a cancelled run. */
  private generation = 0;
  private effectsRoot: THREE.Object3D | null = null;

  constructor(private events: PhysicsEvents = {}) {}

  /** Build the Rapier world from the graph and begin the disaster. */
  async start(
    graph: BlueprintGraph,
    meshes: MeshRegistry,
    disaster: DisasterType,
    seed = 1,
    strength: Strength = DEFAULT_STRENGTH,
    options?: SimOptions,
  ): Promise<void> {
    this.stop();
    const gen = this.generation;
    const rapier = await loadRapier();
    if (gen !== this.generation) return; // stopped (or restarted) while Rapier was loading
    this.run = new SimRun(
      rapier,
      graph,
      meshes,
      disaster,
      seed,
      T.strength[strength],
      this.effectsRoot,
      () => this.events,
      options,
    );
  }

  /** Replace event handlers (Game wires these after construction). */
  setEvents(events: PhysicsEvents): void {
    this.events = events;
  }

  /**
   * Parent for meshes the sim creates itself (hail stones), in world space. Takes effect on the next
   * start(); headless runs can leave it unset.
   */
  setEffectsRoot(root: THREE.Object3D | null): void {
    this.effectsRoot = root;
  }

  /** Advance by a real frame delta (seconds); internally fixed-steps. */
  update(dtSeconds: number): void {
    this.run?.update(dtSeconds);
  }

  /** Destroy the Rapier world and reset the timer. The caller restores mesh transforms. */
  stop(): void {
    this.generation++;
    this.run?.dispose();
    this.run = null;
  }

  isRunning(): boolean {
    return this.run?.running ?? false;
  }

  getTelemetry(): PhysicsTelemetry {
    return (
      this.run?.telemetry() ?? {
        mode: 'build',
        timeRemaining: DISASTER_SECONDS,
        activeJoints: 0,
        brokenJoints: 0,
        firstBrokenId: null,
        waterLevel: WATER_HIDDEN,
        standingRatio: 1,
        stars: 0,
      }
    );
  }

  /** Highest strain ratio seen in the current run and the link it belongs to (calibration/tuning aid). */
  getPeakStrain(): { strain: number; id: string | null } {
    return this.run ? { strain: this.run.peakStrain, id: this.run.peakStrainId } : { strain: 0, id: null };
  }

  /** Live world centers of all blocks in the active simulation. */
  getBlockPositions(excludeIds?: ReadonlySet<string>): Vec3[] {
    return this.run?.blockPositions(excludeIds) ?? [];
  }

  /** Live world centers of active disaster projectiles. */
  getProjectilePositions(): Vec3[] {
    return this.run?.projectilePositions() ?? [];
  }

  /** Evaluates disaster & debris hits against a First-Person player at `feet`. */
  checkPlayerDamage(feet: Vec3, dt: number, protection?: PlayerProtection): PlayerHitResult {
    return (
      this.run?.checkPlayerDamage(feet, dt, protection) ?? {
        damage: 0,
        cause: null,
        impact: false,
      }
    );
  }

  /** Fires a First-Person weapon ray from `origin` along `dir`, damaging or destroying hazards. */
  firePlayerWeapon(origin: Vec3, dir: Vec3, weapon: WeaponDef): WeaponFireResult {
    if (this.run?.running) return this.run.firePlayerWeapon(origin, dir, weapon);
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const ux = len > 1e-6 ? dir[0] / len : 0;
    const uy = len > 1e-6 ? dir[1] / len : 0;
    const uz = len > 1e-6 ? dir[2] / len : -1;
    const reach = Math.min(weapon.range, 20);
    return {
      hit: false,
      hitPoint: [origin[0] + ux * reach, origin[1] + uy * reach, origin[2] + uz * reach],
      destroyedCount: 0,
    };
  }
}

/** One disaster run: owns the Rapier world. Created only after Rapier is initialised. */
class SimRun implements SimContext {
  running = true;
  peakStrain = 0;
  peakStrainId: string | null = null;

  readonly world: World;
  readonly ground: RigidBody;
  readonly blocks: BlockRec[] = [];
  readonly struts: StrutRec[] = [];
  readonly links: Link[] = [];
  readonly shieldBlocks: BlockRec[] = [];
  readonly shieldDomes: ShieldDome[] = [];
  readonly lasers: LaserEntry[] = [];
  projectiles: Projectile[] = [];
  readonly projectileGeom = new THREE.SphereGeometry(1, 16, 12);
  readonly projectileMats: Record<ProjectileKind, THREE.MeshStandardMaterial>;
  readonly shieldGeom = new THREE.SphereGeometry(T.shield.radius, 20, 14);
  readonly shieldMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  readonly rng: () => number;
  readonly quakePhase: number[];
  /** Wind / flood-current heading (radians) and how fast it swirls. */
  flowAngle: number;
  readonly flowSpin: number;
  gust = 1;
  gustTarget = 1;
  gustTimer = 0;
  spawnAccumulator = 0;
  readonly spawnBox: { minX: number; maxX: number; minZ: number; maxZ: number; top: number };
  readonly customMaterials?: ReadonlyMap<string, MaterialDef>;
  readonly customDisaster?: ModDisasterDef;
  readonly gravity: number;
  readonly duration: number;

  mode: Telemetry['mode'] = 'simulating';
  time = 0;
  accumulator = 0;
  brokenCount = 0;
  firstBrokenId: string | null = null;
  waterLevel = WATER_HIDDEN;
  /** Set by breakLink: blocks whose last link broke must be marked loose at the next standing check. */
  linksDirty = true;
  standingRatio = 1;
  playerInvuln = 0;

  constructor(
    readonly R: Rapier,
    graph: BlueprintGraph,
    meshes: MeshRegistry,
    readonly disaster: DisasterType,
    seed: number,
    /** Disaster force multiplier from the strength level. */
    readonly power: number,
    readonly effectsRoot: THREE.Object3D | null,
    readonly events: () => PhysicsEvents,
    options?: SimOptions,
  ) {
    this.customMaterials = options?.customMaterials;
    this.customDisaster = options?.customDisaster;
    this.gravity = T.gravity * (options?.gravityMultiplier ?? 1);
    this.duration = options?.durationSeconds ?? DISASTER_SECONDS;
    const customColor = this.customDisaster?.color ?? 0x84cc16;
    this.projectileMats = createProjectileMaterials(customColor);

    const world = new this.R.World({ x: 0, y: -this.gravity, z: 0 });
    world.timestep = T.step;
    world.numSolverIterations = T.solverIterations;
    this.world = world;

    const half = ISLAND_SIZE / 2;
    this.ground = world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased());
    world.createCollider(
      this.R.ColliderDesc.cuboid(half, 1, half).setTranslation(0, -1, 0).setFriction(1),
      this.ground,
    );

    const byCell = addBlocks(this, graph, meshes);
    for (const s of graph.struts) addStrut(this, graph, s, meshes, byCell);

    this.rng = makeRng(seed);
    this.quakePhase = Array.from({ length: 6 }, () => this.rng() * Math.PI * 2);
    this.flowAngle = this.rng() * Math.PI * 2;
    this.flowSpin = (this.rng() - 0.5) * 0.6;

    const ps = this.blocks.map((b) => b.body.translation());
    this.spawnBox = ps.length
      ? {
          minX: Math.min(...ps.map((p) => p.x)) - 1.5,
          maxX: Math.max(...ps.map((p) => p.x)) + 1.5,
          minZ: Math.min(...ps.map((p) => p.z)) - 1.5,
          maxZ: Math.max(...ps.map((p) => p.z)) + 1.5,
          top: Math.max(...ps.map((p) => p.y)) + 1,
        }
      : { minX: -4, maxX: 4, minZ: -4, maxZ: 4, top: 0 };

    if (disaster === 'flood' || this.customDisaster?.flood) {
      this.waterLevel = T.flood.start;
      this.events().onWaterLevel?.(this.waterLevel);
    }
    updateStanding(this);
    syncMeshes(this);
  }

  telemetry(): PhysicsTelemetry {
    return {
      mode: this.mode,
      timeRemaining: Math.max(0, this.duration - this.time),
      activeJoints: this.links.length - this.brokenCount,
      brokenJoints: this.brokenCount,
      firstBrokenId: this.firstBrokenId,
      waterLevel: this.waterLevel,
      standingRatio: this.standingRatio,
      stars: starsFor(this.brokenCount, this.standingRatio),
    };
  }

  blockPositions(excludeIds?: ReadonlySet<string>): Vec3[] {
    const out: Vec3[] = [];
    for (const b of this.blocks) {
      if (excludeIds?.has(b.data.id)) continue;
      const p = b.body.translation();
      out.push([p.x, p.y, p.z]);
    }
    return out;
  }

  projectilePositions(): Vec3[] {
    const out: Vec3[] = [];
    for (const proj of this.projectiles) {
      if (proj.destroyed) continue;
      const p = proj.body.translation();
      out.push([p.x, p.y, p.z]);
    }
    return out;
  }

  update(dtSeconds: number) {
    if (!this.running) return;
    this.accumulator += Math.min(Math.max(dtSeconds, 0), T.maxFrameDt);
    while (this.running && this.accumulator >= T.step - 1e-9) {
      this.accumulator -= T.step;
      this.stepOnce();
    }
    syncMeshes(this);
  }

  dispose() {
    this.running = false;
    for (const p of this.projectiles) this.effectsRoot?.remove(p.mesh);
    this.projectiles = [];
    for (const d of this.shieldDomes) this.effectsRoot?.remove(d.mesh);
    this.shieldDomes.length = 0;
    this.projectileGeom.dispose();
    for (const mat of Object.values(this.projectileMats)) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.shieldGeom.dispose();
    this.shieldMat.dispose();
    this.world.free();
  }

  private stepOnce() {
    this.time += T.step;
    applyDisaster(this);
    updateLasers(this);
    this.world.step();
    measureAndBreak(this);
    updateStanding(this);
    const ev = this.events();
    ev.onIntensity?.(this.disaster, disasterIntensity(this));

    if (this.time >= this.duration - 1e-9) {
      this.time = this.duration;
      this.running = false;
      this.mode = this.brokenCount === 0 ? 'survived' : 'failed';
      ev.onIntensity?.(this.disaster, 0);
      if (this.mode === 'survived') ev.onSurvived?.();
    }
  }

  checkPlayerDamage(feet: Vec3, dt: number, protection?: PlayerProtection): PlayerHitResult {
    return checkPlayerDamage(this, feet, dt, protection);
  }

  firePlayerWeapon(origin: Vec3, dir: Vec3, weapon: WeaponDef): WeaponFireResult {
    return firePlayerWeapon(this, origin, dir, weapon);
  }
}
