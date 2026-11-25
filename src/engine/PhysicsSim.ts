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
  StrutData,
  Telemetry,
  Vec3,
} from '../types/blueprint';
import type { MaterialDef } from '../types/materials';
import {
  CELL_SIZE,
  DEFAULT_STRENGTH,
  DISASTER_SECONDS,
  ISLAND_SIZE,
  blocksAtCorner,
  cellToWorld,
  cornerToWorld,
  key,
} from '../types/blueprint';
import { getMaterialDef } from '../types/materials';
import type { ModDisasterDef } from '../mods/mods';
import type { WeaponDef } from '../types/gear';
import { mulberry32 } from '../utils/rng';
import type { MeshRegistry } from './BuildController';
import { createProjectileMaterials, type Projectile } from './physics/projectiles';
import { configureAxisSpring, isLinear, loadRapier, type Rapier } from './physics/rapier';
import {
  PHYSICS_TUNING,
  WATER_HIDDEN,
  clamp01,
  envelope,
  smooth,
  starsFor,
  tint,
  type PhysicsEvents,
  type PhysicsTelemetry,
  type PlayerHitResult,
  type PlayerProtection,
  type SimOptions,
  type WeaponFireResult,
} from './physics/tuning';
import type { BlockRec, LaserEntry, Link, ShieldDome, StrutEnd, StrutRec } from './physics/types';

export { PHYSICS_TUNING, loadRapier, starsFor };
export type { PhysicsEvents, PlayerHitResult, PlayerProtection, SimOptions, WeaponFireResult };
export const makeRng = mulberry32;

const T = PHYSICS_TUNING;

const tmpP1 = new THREE.Vector3();
const tmpP2 = new THREE.Vector3();
const tmpQ1 = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpWpQ = new THREE.Quaternion();
const tmpV1 = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpMid0 = new THREE.Vector3();
const tmpMid1 = new THREE.Vector3();
const tmpD0 = new THREE.Vector3();
const tmpD1 = new THREE.Vector3();
const tmpRot = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const UP_UNIT = new THREE.Vector3(0, 1, 0);

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
class SimRun {
  running = true;
  peakStrain = 0;
  peakStrainId: string | null = null;

  private readonly world: World;
  private readonly ground: RigidBody;
  private readonly blocks: BlockRec[] = [];
  private readonly struts: StrutRec[] = [];
  private readonly links: Link[] = [];
  private readonly shieldBlocks: BlockRec[] = [];
  private readonly shieldDomes: ShieldDome[] = [];
  private readonly lasers: LaserEntry[] = [];
  private projectiles: Projectile[] = [];
  private readonly projectileGeom = new THREE.SphereGeometry(1, 16, 12);
  private readonly projectileMats: Record<ProjectileKind, THREE.MeshStandardMaterial>;
  private readonly shieldGeom = new THREE.SphereGeometry(T.shield.radius, 20, 14);
  private readonly shieldMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  private readonly rng: () => number;
  private readonly quakePhase: number[];
  /** Wind / flood-current heading (radians) and how fast it swirls. */
  private flowAngle: number;
  private readonly flowSpin: number;
  private gust = 1;
  private gustTarget = 1;
  private gustTimer = 0;
  private spawnAccumulator = 0;
  private readonly spawnBox: { minX: number; maxX: number; minZ: number; maxZ: number; top: number };
  private readonly customMaterials?: ReadonlyMap<string, MaterialDef>;
  private readonly customDisaster?: ModDisasterDef;
  private readonly gravity: number;
  private readonly duration: number;

  private mode: Telemetry['mode'] = 'simulating';
  private time = 0;
  private accumulator = 0;
  private brokenCount = 0;
  private firstBrokenId: string | null = null;
  private waterLevel = WATER_HIDDEN;
  /** Set by breakLink: blocks whose last link broke must be marked loose at the next standing check. */
  private linksDirty = true;
  private standingRatio = 1;
  private playerInvuln = 0;

  constructor(
    private readonly R: Rapier,
    graph: BlueprintGraph,
    meshes: MeshRegistry,
    private readonly disaster: DisasterType,
    seed: number,
    /** Disaster force multiplier from the strength level. */
    private readonly power: number,
    private readonly effectsRoot: THREE.Object3D | null,
    private readonly events: () => PhysicsEvents,
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

    const byCell = this.addBlocks(graph, meshes);
    for (const s of graph.struts) this.addStrut(graph, s, meshes, byCell);

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
    this.updateStanding();
    this.syncMeshes();
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

  checkPlayerDamage(feet: Vec3, dt: number, protection?: PlayerProtection): PlayerHitResult {
    if (!this.running) return { damage: 0, cause: null, impact: false };
    const safeDt = Math.max(0, dt);
    this.playerInvuln = Math.max(0, this.playerInvuln - safeDt);
    const [px, py, pz] = feet;

    if (py < T.player.fallY) {
      return { damage: T.player.maxHp, cause: 'You fell off the island!', impact: true };
    }

    let damage = 0;
    let cause: string | null = null;
    let impact = false;

    if (!protection?.floodImmune && this.waterLevel > py + 1.45) {
      damage += T.player.drownDps * safeDt;
      cause = 'Swept by the flood!';
    }

    if (this.playerInvuln <= 0) {
      let destroyedProj = false;
      for (const proj of this.projectiles) {
        if (proj.destroyed) continue;
        const v = proj.body.linvel();
        if (proj.landed && Math.hypot(v.x, v.y, v.z) < 3) continue;
        const pp = proj.body.translation();
        const clampedY = Math.max(
          py + T.player.radius,
          Math.min(py + T.player.height - T.player.radius, pp.y),
        );
        const d2 = (pp.x - px) ** 2 + (pp.y - clampedY) ** 2 + (pp.z - pz) ** 2;
        const hitDist = proj.radius + T.player.radius;
        if (d2 <= hitDist * hitDist) {
          proj.destroyed = true;
          destroyedProj = true;
          this.effectsRoot?.remove(proj.mesh);
          this.world.removeRigidBody(proj.body);
          damage += T.projectileDamage[proj.kind];
          cause = 'Hit by a falling hazard!';
          impact = true;
          this.playerInvuln = T.player.invulnSeconds;
          break;
        }
      }
      if (destroyedProj) this.compactProjectiles();

      if (!impact) {
        const half = CELL_SIZE / 2;
        for (const b of this.blocks) {
          const v = b.body.linvel();
          if (Math.hypot(v.x, v.y, v.z) < T.player.blockHitSpeed) continue;
          const bp = b.body.translation();
          if (
            Math.abs(bp.x - px) <= half + T.player.radius &&
            Math.abs(bp.z - pz) <= half + T.player.radius &&
            bp.y + half >= py + 0.15 &&
            bp.y - half <= py + T.player.height
          ) {
            damage += T.player.blockDamage;
            cause = 'Crushed by falling debris!';
            impact = true;
            this.playerInvuln = T.player.invulnSeconds;
            break;
          }
        }
      }
    }

    const mult = 1 - clamp01(protection?.damageReduction ?? 0);
    return { damage: damage * mult, cause, impact };
  }

  firePlayerWeapon(origin: Vec3, dir: Vec3, weapon: WeaponDef): WeaponFireResult {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const ux = len > 1e-6 ? dir[0] / len : 0;
    const uy = len > 1e-6 ? dir[1] / len : 0;
    const uz = len > 1e-6 ? dir[2] / len : -1;
    const defaultReach = Math.min(weapon.range, 20);
    const defaultPoint: Vec3 = [
      origin[0] + ux * defaultReach,
      origin[1] + uy * defaultReach,
      origin[2] + uz * defaultReach,
    ];
    if (!this.running) return { hit: false, hitPoint: defaultPoint, destroyedCount: 0 };

    let best: Projectile | null = null;
    let bestAlong = weapon.range;
    let bestPos: { x: number; y: number; z: number } | null = null;

    for (const proj of this.projectiles) {
      if (proj.destroyed) continue;
      const pp = proj.body.translation();
      const dx = pp.x - origin[0];
      const dy = pp.y - origin[1];
      const dz = pp.z - origin[2];
      const along = dx * ux + dy * uy + dz * uz;
      if (along <= 0 || along > weapon.range) continue;
      const perp2 = Math.max(0, dx * dx + dy * dy + dz * dz - along * along);
      const tol = Math.max(proj.radius + 1.4, along * 0.14);
      if (perp2 <= tol * tol && along < bestAlong) {
        best = proj;
        bestAlong = along;
        bestPos = pp;
      }
    }

    if (!best || !bestPos) {
      return { hit: false, hitPoint: defaultPoint, destroyedCount: 0 };
    }

    const hitPoint: Vec3 = [bestPos.x, bestPos.y, bestPos.z];
    const targets: Projectile[] = [best];
    if (weapon.splashRadius > 0) {
      const r2 = weapon.splashRadius * weapon.splashRadius;
      for (const proj of this.projectiles) {
        if (proj === best || proj.destroyed) continue;
        const pp = proj.body.translation();
        const d2 = (pp.x - bestPos.x) ** 2 + (pp.y - bestPos.y) ** 2 + (pp.z - bestPos.z) ** 2;
        if (d2 <= r2) targets.push(proj);
      }
    }

    const ev = this.events();
    let destroyedCount = 0;
    for (const target of targets) {
      target.hp -= weapon.damage;
      if (target.hp <= 0) {
        target.destroyed = true;
        destroyedCount++;
        const tp = target.body.translation();
        this.effectsRoot?.remove(target.mesh);
        this.world.removeRigidBody(target.body);
        ev.onProjectileImpact?.(target.kind, tp.x, tp.y, tp.z);
      } else {
        target.mesh.scale.multiplyScalar(0.82);
        const v = target.body.linvel();
        target.body.setLinvel({ x: v.x * 0.7, y: v.y * 0.7, z: v.z * 0.7 }, true);
      }
    }
    if (destroyedCount > 0) this.compactProjectiles();

    return { hit: true, hitPoint, destroyedCount };
  }

  update(dtSeconds: number) {
    if (!this.running) return;
    this.accumulator += Math.min(Math.max(dtSeconds, 0), T.maxFrameDt);
    while (this.running && this.accumulator >= T.step - 1e-9) {
      this.accumulator -= T.step;
      this.stepOnce();
    }
    this.syncMeshes();
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

  // ---------------------------------------------------------------- world construction

  private addBlocks(graph: BlueprintGraph, meshes: MeshRegistry) {
    const byCell = new Map<string, BlockRec>();
    const h = (CELL_SIZE / 2) * T.colliderScale;
    for (const b of graph.blocks) {
      const mat = getMaterialDef(b.material, this.customMaterials);
      const centre = new THREE.Vector3(...cellToWorld(b.cell));
      const body = this.world.createRigidBody(
        this.R.RigidBodyDesc.dynamic().setTranslation(centre.x, centre.y, centre.z).setCanSleep(false),
      );
      const col = this.world.createCollider(
        this.R.ColliderDesc.cuboid(h, CELL_SIZE / 2, h)
          .setDensity(mat.density)
          .setFriction(0.8),
        body,
      );
      const mesh = meshes.blocks.get(b.id);
      const rec: BlockRec = {
        data: b,
        body,
        mesh,
        meshOffsetPos: mesh ? mesh.position.clone().sub(centre) : new THREE.Vector3(),
        meshOffsetQuat: mesh ? mesh.quaternion.clone() : new THREE.Quaternion(),
        mass: col.mass(),
        buoyancy: mat.buoyancy,
        exposure: [1, 1, 1, 1],
        strain: 0,
        start: centre.clone(),
        fallen: false,
      };
      this.blocks.push(rec);
      byCell.set(key(b.cell), rec);
      if (mat.special === 'shield') {
        this.shieldBlocks.push(rec);
        if (this.effectsRoot) {
          const dome = new THREE.Mesh(this.shieldGeom, this.shieldMat);
          dome.position.copy(centre);
          this.effectsRoot.add(dome);
          this.shieldDomes.push({ rec, mesh: dome });
        }
      } else if (mat.special === 'laser') {
        this.lasers.push({ rec, cooldown: 0 });
      }
    }

    const at = (c: Vec3) => byCell.get(key(c));
    const shielded = (c: Vec3) => (at(c) ? 0.25 : 1);
    for (const rec of this.blocks) {
      const [cx, cy, cz] = rec.data.cell;
      rec.exposure = [
        shielded([cx + 1, cy, cz]),
        shielded([cx - 1, cy, cz]),
        shielded([cx, cy, cz + 1]),
        shielded([cx, cy, cz - 1]),
      ];
      for (const d of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] satisfies Vec3[]) {
        const other = at([cx + d[0], cy + d[1], cz + d[2]]);
        if (other) this.addBlockLink(rec, other, d);
      }
      if (cy === 0) this.addAnchor(rec);
    }
    return byCell;
  }

  /** 6-DOF spring joint; joint axes line up with world axes because every body starts unrotated. */
  private createSpring(
    b1: RigidBody,
    l1: THREE.Vector3,
    b2: RigidBody,
    l2: THREE.Vector3,
    stiffness: number,
    toGround: boolean,
  ) {
    // Locking LinX only to create the joint; the mask is cleared below so all six axes are springs.
    const data = this.R.JointData.generic(l1, l2, { x: 1, y: 0, z: 0 }, this.R.JointAxesMask.LinX);
    data.axesMask = this.R.JointAxesMask.LinX & this.R.JointAxesMask.LinY;
    const joint = this.world.createImpulseJoint(data, b1, b2, true);
    joint.setContactsEnabled(toGround);
    const A = this.R.JointAxis;
    const axes = [A.LinX, A.LinY, A.LinZ, A.AngX, A.AngY, A.AngZ];
    for (const axis of axes) {
      const k = (isLinear(this.R, axis) ? T.linkLinStiffness : T.linkAngStiffness) * stiffness;
      configureAxisSpring(
        this.R,
        this.world.impulseJoints,
        joint,
        axis,
        0,
        k,
        2 * T.linkDampingRatio * Math.sqrt(k),
      );
    }
    return joint;
  }

  private startsNearShield(blocks: BlockRec[]): boolean {
    if (this.shieldBlocks.length === 0) return false;
    const r2 = T.shield.radius * T.shield.radius;
    for (const s of this.shieldBlocks) {
      for (const b of blocks) {
        if (s.start.distanceToSquared(b.start) <= r2) return true;
      }
    }
    return false;
  }

  private addBlockLink(a: BlockRec, b: BlockRec, dir: Vec3) {
    const hc = CELL_SIZE / 2;
    const l1 = new THREE.Vector3(dir[0] * hc, dir[1] * hc, dir[2] * hc);
    const l2 = l1.clone().negate();
    const ma = getMaterialDef(a.data.material, this.customMaterials);
    const mb = getMaterialDef(b.data.material, this.customMaterials);
    const boost = this.startsNearShield([a, b]) ? T.shield.stiffnessMultiplier : 1;
    const joint = this.createSpring(
      a.body,
      l1,
      b.body,
      l2,
      Math.min(ma.stiffness, mb.stiffness) * boost,
      false,
    );
    this.links.push({
      // Report the weaker piece; on a tie the upper / later one (it is what comes loose).
      id: ma.maxStress < mb.maxStress ? a.data.id : b.data.id,
      kind: 'face',
      joint,
      body1: a.body,
      body2: b.body,
      local1: l1,
      local2: l2,
      rest: 0,
      limit: Math.min(ma.maxStress, mb.maxStress) * T.stretchUnit,
      blocks: [a, b],
      strut: null,
      strain: 0,
      broken: false,
    });
  }

  private addAnchor(rec: BlockRec) {
    const p = rec.body.translation();
    const l1 = new THREE.Vector3(p.x, p.y - CELL_SIZE / 2, p.z); // the island body sits at the origin
    const l2 = new THREE.Vector3(0, -CELL_SIZE / 2, 0);
    const mat = getMaterialDef(rec.data.material, this.customMaterials);
    const boost = this.startsNearShield([rec]) ? T.shield.stiffnessMultiplier : 1;
    const joint = this.createSpring(this.ground, l1, rec.body, l2, mat.stiffness * boost, true);
    this.links.push({
      id: rec.data.id,
      kind: 'anchor',
      joint,
      body1: this.ground,
      body2: rec.body,
      local1: l1,
      local2: l2,
      rest: 0,
      limit: mat.maxStress * T.stretchUnit * T.anchorStrength * (mat.anchorMultiplier ?? 1),
      blocks: [rec],
      strut: null,
      strain: 0,
      broken: false,
    });
  }

  private strutEnd(graph: BlueprintGraph, k: Vec3, byCell: Map<string, BlockRec>): StrutEnd | null {
    const w = new THREE.Vector3(...cornerToWorld(k));
    const owner = blocksAtCorner(graph, k)[0];
    const rec = owner ? byCell.get(key(owner.cell)) : undefined;
    if (rec) {
      const t = rec.body.translation();
      return { body: rec.body, local: w.sub(tmpV1.set(t.x, t.y, t.z)), rec };
    }
    if (k[1] === 0) return { body: this.ground, local: w, rec: null };
    return null;
  }

  private addStrut(graph: BlueprintGraph, s: StrutData, meshes: MeshRegistry, byCell: Map<string, BlockRec>) {
    const mesh = meshes.struts.get(s.id);
    const initA = new THREE.Vector3(...cornerToWorld(s.a));
    const initB = new THREE.Vector3(...cornerToWorld(s.b));
    const endA = this.strutEnd(graph, s.a, byCell);
    const endB = this.strutEnd(graph, s.b, byCell);
    const rec: StrutRec = {
      data: s,
      mesh,
      initA,
      initB,
      meshPos: mesh ? mesh.position.clone() : initA.clone().add(initB).multiplyScalar(0.5),
      meshQuat: mesh ? mesh.quaternion.clone() : new THREE.Quaternion(),
      endA,
      endB,
      debris: null,
      strain: 0,
      fallen: false,
    };
    this.struts.push(rec);
    // Both ends on one body (or an invalid end): the strut just rides along, it carries no load.
    if (!endA || !endB || endA.body === endB.body) return;

    const rest = initA.distanceTo(initB);
    const mat = getMaterialDef(s.material, this.customMaterials);
    const attached = [endA.rec, endB.rec].filter((r) => r !== null);
    const boost = this.startsNearShield(attached) ? T.shield.stiffnessMultiplier : 1;
    const k = T.strutStiffness * mat.stiffness * boost;
    const damping = 2 * T.strutDampingRatio * Math.sqrt(k);
    const joint = this.world.createImpulseJoint(
      this.R.JointData.spring(rest, k, damping, endA.local, endB.local),
      endA.body,
      endB.body,
      true,
    );
    joint.setContactsEnabled(false);
    // Same spring, but acceleration-based like the block links (mass-independent, stable).
    configureAxisSpring(this.R, this.world.impulseJoints, joint, this.R.JointAxis.LinX, rest, k, damping);
    this.links.push({
      id: s.id,
      kind: 'strut',
      joint,
      body1: endA.body,
      body2: endB.body,
      local1: endA.local,
      local2: endB.local,
      rest,
      limit: mat.maxStress * T.stretchUnit,
      blocks: attached,
      strut: rec,
      strain: 0,
      broken: false,
    });
  }

  // ---------------------------------------------------------------- disasters

  /** 0..1 strength for audio. */
  private intensity(): number {
    const env = envelope(this.time, this.duration);
    if (this.customDisaster) return env;
    if (this.disaster === 'hurricane') return env * clamp01(this.gust);
    if (this.disaster === 'fire_tornado') return env * clamp01(0.5 + 0.5 * this.gust);
    if (this.disaster === 'snow_storm') return env * clamp01(0.4 + 0.6 * this.gust);
    if (this.disaster === 'flood') return env * 0.7;
    return env;
  }

  /** Open area facing a flow along (dx, dz): the -x face meets a +x flow, and so on. */
  private static upstreamExposure(b: BlockRec, dx: number, dz: number) {
    const [px, nx, pz, nz] = b.exposure;
    return Math.max(0, -dx) * nx + Math.max(0, dx) * px + Math.max(0, -dz) * nz + Math.max(0, dz) * pz;
  }

  private applyDisaster() {
    if (this.customDisaster) return this.applyCustomDisaster(this.customDisaster);
    switch (this.disaster) {
      case 'earthquake':
        return this.applyQuake();
      case 'hurricane':
        return this.applyWind();
      case 'flood':
        return this.applyFlood();
      case 'hail':
        return this.applyHail();
      case 'fire_tornado':
        return this.applyFireTornado();
      case 'snow_storm':
        return this.applySnowStorm();
      case 'raid':
        return this.applyRaid();
      case 'meteor':
        return this.applyMeteor();
    }
  }

  private applyQuake(scale = 1) {
    const q = T.quake;
    const t = this.time;
    const env = envelope(t, this.duration);
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < q.freqs.length; i++) {
      const w = 2 * Math.PI * q.freqs[i];
      dx += q.weights[i] * Math.sin(w * t + this.quakePhase[i]);
      dz += q.weights[i] * Math.sin(w * 1.13 * t + this.quakePhase[i + 3]);
    }
    const amp = q.amplitude * scale * this.power * env;
    this.ground.setNextKinematicTranslation({ x: amp * dx, y: 0, z: amp * q.zRatio * dz });
  }

  private applyWindForce(force: number, spinSpeed: number, reset = true): { wx: number; wz: number } {
    const w = T.wind;
    this.gustTimer -= T.step;
    if (this.gustTimer <= 0) {
      this.gustTimer = 0.4 + this.rng() * 0.8;
      this.gustTarget = w.gustMin + this.rng() * (1 - w.gustMin) * 1.3;
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, T.step * 4);
    this.flowAngle += spinSpeed * T.step;
    const wx = Math.cos(this.flowAngle);
    const wz = Math.sin(this.flowAngle);
    const strength = force * this.power * envelope(this.time, this.duration) * this.gust;
    for (const b of this.blocks) {
      const height = 1 + w.heightGain * Math.max(0, b.body.translation().y);
      const f = strength * SimRun.upstreamExposure(b, wx, wz) * height;
      if (reset) b.body.resetForces(false);
      b.body.addForce({ x: wx * f, y: 0, z: wz * f }, true);
    }
    return { wx, wz };
  }

  private applyWind() {
    this.applyWindForce(T.wind.force, this.flowSpin);
  }

  private applyFlood(reset = true) {
    const f = T.flood;
    const env = envelope(this.time, this.duration);
    this.waterLevel = f.start + (f.peak - f.start) * smooth(this.time / f.riseSeconds);
    this.events().onWaterLevel?.(this.waterLevel);
    const cx = Math.cos(this.flowAngle);
    const cz = Math.sin(this.flowAngle);
    for (const b of this.blocks) {
      if (reset) b.body.resetForces(false);
      const p = b.body.translation();
      const sub = clamp01((this.waterLevel - (p.y - CELL_SIZE / 2)) / CELL_SIZE);
      if (sub <= 0) continue;
      const v = b.body.linvel();
      const drag = f.drag * sub * b.mass;
      // The current pushes upstream faces regardless of material, so heavy blocks resist it better.
      const push = f.current * this.power * env * sub * SimRun.upstreamExposure(b, cx, cz);
      b.body.addForce(
        {
          x: cx * push - v.x * drag,
          y: sub * b.mass * this.gravity * b.buoyancy - v.y * drag,
          z: cz * push - v.z * drag,
        },
        true,
      );
    }
  }

  private applyHail() {
    const h = T.hail;
    this.spawnAccumulator += h.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.spawnHail();
    }
    this.updateProjectiles();
  }

  private applyFireTornado() {
    const ft = T.fire_tornado;
    this.applyWindForce(ft.windForce, ft.swirlSpeed);
    this.spawnAccumulator += ft.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      const angle = this.flowAngle + (this.rng() - 0.5) * 2.2;
      const dist = 12 + this.rng() * 3;
      const sx = Math.cos(angle) * dist;
      const sz = Math.sin(angle) * dist;
      const sy = 2.5 + this.rng() * Math.max(6, this.spawnBox.top + 3);
      const r = ft.radiusMin + this.rng() * (ft.radiusMax - ft.radiusMin);
      this.spawnTargetedProjectile('fireball', sx, sy, sz, r, ft.density, ft.speed * Math.sqrt(this.power));
    }
    this.updateProjectiles();
  }

  private applySnowStorm() {
    const sn = T.snow_storm;
    const { wx, wz } = this.applyWindForce(sn.windForce, this.flowSpin);
    this.spawnAccumulator += sn.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      const b = this.spawnBox;
      const r = sn.radiusMin + this.rng() * (sn.radiusMax - sn.radiusMin);
      const x = b.minX + this.rng() * (b.maxX - b.minX) - wx * 2;
      const z = b.minZ + this.rng() * (b.maxZ - b.minZ) - wz * 2;
      const y = b.top + sn.height * (0.6 + 0.4 * this.rng());
      const speed = sn.speed * Math.sqrt(this.power);
      this.spawnProjectile('snowball', x, y, z, wx * 3.5, -speed, wz * 3.5, r, sn.density, speed, 0);
    }
    this.updateProjectiles();
  }

  private applyRaid() {
    const rd = T.raid;
    this.spawnAccumulator += rd.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      const angle = this.rng() * Math.PI * 2;
      const sx = Math.cos(angle) * rd.spawnRadius;
      const sz = Math.sin(angle) * rd.spawnRadius;
      const sy = 2 + this.rng() * Math.max(5, this.spawnBox.top + 2);
      const r = rd.radiusMin + this.rng() * (rd.radiusMax - rd.radiusMin);
      this.spawnTargetedProjectile('raider', sx, sy, sz, r, rd.density, rd.speed * Math.sqrt(this.power));
    }
    this.updateProjectiles();
  }

  private applyMeteor() {
    const mt = T.meteor;
    this.spawnAccumulator += mt.perSecond * this.power * envelope(this.time, this.duration) * T.step;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      const b = this.spawnBox;
      const r = mt.radiusMin + this.rng() * (mt.radiusMax - mt.radiusMin);
      const x = b.minX + this.rng() * (b.maxX - b.minX);
      const z = b.minZ + this.rng() * (b.maxZ - b.minZ);
      const y = b.top + mt.height * (0.7 + 0.3 * this.rng());
      const speed = mt.speed * Math.sqrt(this.power);
      const vx = (this.rng() - 0.5) * 4;
      const vz = (this.rng() - 0.5) * 4;
      this.spawnProjectile('meteor', x, y, z, vx, -speed, vz, r, mt.density, speed, 0);
    }
    this.updateProjectiles();
  }

  private applyCustomDisaster(def: ModDisasterDef) {
    for (const b of this.blocks) b.body.resetForces(false);
    if (def.quake) this.applyQuake(def.quake);
    if (def.wind) this.applyWindForce(T.wind.force * def.wind, this.flowSpin, false);
    if (def.flood) this.applyFlood(false);
    if (def.projectiles) {
      const p = def.projectiles;
      const env = envelope(this.time, this.duration);
      this.spawnAccumulator += p.rate * this.power * env * T.step;
      while (this.spawnAccumulator >= 1) {
        this.spawnAccumulator -= 1;
        const speed = p.speed * Math.sqrt(this.power);
        if (p.mode === 'rain') {
          const b = this.spawnBox;
          const x = b.minX + this.rng() * (b.maxX - b.minX);
          const z = b.minZ + this.rng() * (b.maxZ - b.minZ);
          const y = b.top + 14 * (0.6 + 0.4 * this.rng());
          this.spawnProjectile('custom', x, y, z, 0, -speed, 0, p.radius, p.density, speed, 0);
        } else {
          const angle = this.rng() * Math.PI * 2;
          const sx = Math.cos(angle) * 14.5;
          const sz = Math.sin(angle) * 14.5;
          const sy = 2 + this.rng() * Math.max(5, this.spawnBox.top + 2);
          this.spawnTargetedProjectile('custom', sx, sy, sz, p.radius, p.density, speed);
        }
      }
      this.updateProjectiles();
    }
  }

  private spawnHail() {
    const h = T.hail;
    const b = this.spawnBox;
    const r = h.radiusMin + this.rng() * (h.radiusMax - h.radiusMin);
    const x = b.minX + this.rng() * (b.maxX - b.minX);
    const z = b.minZ + this.rng() * (b.maxZ - b.minZ);
    const y = b.top + h.height * (0.6 + 0.4 * this.rng());
    const speed = h.speed * Math.sqrt(this.power);
    this.spawnProjectile('hail', x, y, z, 0, -speed, 0, r, h.density, speed, 0);
  }

  private spawnTargetedProjectile(
    kind: ProjectileKind,
    sx: number,
    sy: number,
    sz: number,
    r: number,
    density: number,
    speed: number,
  ) {
    const b = this.spawnBox;
    let tx = (b.minX + b.maxX) * 0.5 + (this.rng() - 0.5) * 2;
    let ty = Math.max(1, b.top * 0.5);
    let tz = (b.minZ + b.maxZ) * 0.5 + (this.rng() - 0.5) * 2;
    if (this.blocks.length > 0) {
      const target = this.blocks[Math.floor(this.rng() * this.blocks.length)];
      if (target) {
        const tp = target.body.translation();
        tx = tp.x + (this.rng() - 0.5) * 1.2;
        ty = tp.y + (this.rng() - 0.5) * 0.8;
        tz = tp.z + (this.rng() - 0.5) * 1.2;
      }
    }
    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const dist = Math.max(0.1, Math.hypot(dx, dy, dz));
    const flight = dist / speed;
    const vx = (dx / dist) * speed;
    const vz = (dz / dist) * speed;
    const vy = (dy / dist) * speed + 0.45 * this.gravity * flight;
    this.spawnProjectile(kind, sx, sy, sz, vx, vy, vz, r, density, speed, Math.hypot(vx, vz));
  }

  private spawnProjectile(
    kind: ProjectileKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    density: number,
    speed: number,
    horizSpeed: number,
  ) {
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(vx, vy, vz).setCcdEnabled(true),
    );
    this.world.createCollider(this.R.ColliderDesc.ball(r).setDensity(density).setRestitution(0.2), body);
    const mesh = new THREE.Mesh(this.projectileGeom, this.projectileMats[kind]);
    mesh.scale.setScalar(r);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    this.effectsRoot?.add(mesh);
    this.projectiles.push({
      kind,
      body,
      mesh,
      radius: r,
      speed,
      horizSpeed,
      hp: kind === 'meteor' ? 2 : 1,
      landed: false,
      destroyed: false,
    });
  }

  private compactProjectiles() {
    let write = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (p && !p.destroyed) this.projectiles[write++] = p;
    }
    this.projectiles.length = write;
  }

  private updateProjectiles() {
    // Report each projectile's first hit (its flight is suddenly slowed), and cull ones that fell off.
    const ev = this.events();
    let write = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const s = this.projectiles[i];
      if (!s || s.destroyed) continue;
      const p = s.body.translation();
      const v = s.body.linvel();
      const hit =
        s.horizSpeed > 0.5
          ? Math.hypot(v.x, v.z) < s.horizSpeed * 0.65 || v.y > 1.5 || p.y <= s.radius + 0.15
          : v.y > -s.speed * 0.5;
      if (!s.landed && hit) {
        s.landed = true;
        ev.onProjectileImpact?.(s.kind, p.x, p.y - s.radius, p.z);
        if (s.kind === 'hail') ev.onHailImpact?.(p.x, p.y - s.radius, p.z);
      }
      if (p.y > -20) {
        this.projectiles[write++] = s;
      } else {
        this.effectsRoot?.remove(s.mesh);
        this.world.removeRigidBody(s.body);
      }
    }
    this.projectiles.length = write;
  }

  private updateLasers() {
    if (this.lasers.length === 0) return;
    const range2 = T.laser.range * T.laser.range;
    const ev = this.events();
    let destroyedAny = false;
    for (const laser of this.lasers) {
      laser.cooldown = Math.max(0, laser.cooldown - T.step);
      if (laser.rec.fallen || laser.cooldown > 0) continue;
      const lp = laser.rec.body.translation();
      let best: Projectile | null = null;
      let bestDist2 = range2;
      let bestPos: { x: number; y: number; z: number } | null = null;
      for (const proj of this.projectiles) {
        if (proj.destroyed || proj.landed) continue;
        const pp = proj.body.translation();
        const d2 = (pp.x - lp.x) ** 2 + (pp.y - lp.y) ** 2 + (pp.z - lp.z) ** 2;
        if (d2 <= bestDist2) {
          bestDist2 = d2;
          best = proj;
          bestPos = pp;
        }
      }
      if (best && bestPos) {
        best.hp -= 1;
        if (best.hp <= 0) {
          best.destroyed = true;
          destroyedAny = true;
          this.effectsRoot?.remove(best.mesh);
          this.world.removeRigidBody(best.body);
        } else {
          best.mesh.scale.multiplyScalar(0.82);
          const v = best.body.linvel();
          best.body.setLinvel({ x: v.x * 0.7, y: v.y * 0.7, z: v.z * 0.7 }, true);
        }
        laser.cooldown = T.laser.cooldown;
        ev.onLaserFire?.([lp.x, lp.y, lp.z], [bestPos.x, bestPos.y, bestPos.z]);
      }
    }
    if (destroyedAny) this.compactProjectiles();
  }

  // ---------------------------------------------------------------- stepping & strain

  private stepOnce() {
    this.time += T.step;
    this.applyDisaster();
    this.updateLasers();
    this.world.step();
    this.measureAndBreak();
    this.updateStanding();
    const ev = this.events();
    ev.onIntensity?.(this.disaster, this.intensity());

    if (this.time >= this.duration - 1e-9) {
      this.time = this.duration;
      this.running = false;
      this.mode = this.brokenCount === 0 ? 'survived' : 'failed';
      ev.onIntensity?.(this.disaster, 0);
      if (this.mode === 'survived') ev.onSurvived?.();
    }
  }

  private static worldPoint(body: RigidBody, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const r = body.rotation();
    const t = body.translation();
    tmpWpQ.set(r.x, r.y, r.z, r.w);
    out.copy(local).applyQuaternion(tmpWpQ);
    out.x += t.x;
    out.y += t.y;
    out.z += t.z;
    return out;
  }

  private static linkStretch(l: Link): number {
    const p1 = SimRun.worldPoint(l.body1, l.local1, tmpP1);
    const p2 = SimRun.worldPoint(l.body2, l.local2, tmpP2);
    if (l.kind === 'strut') return Math.abs(p1.distanceTo(p2) - l.rest);
    // Every body starts unrotated, so the rest relative rotation is the identity.
    const r1 = l.body1.rotation();
    const r2 = l.body2.rotation();
    tmpQ1.set(r1.x, r1.y, r1.z, r1.w).invert();
    tmpQ2.set(r2.x, r2.y, r2.z, r2.w);
    tmpQ1.multiply(tmpQ2);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(tmpQ1.w)));
    return p1.distanceTo(p2) + angle * (CELL_SIZE / 2);
  }

  private isProtectedByShield(
    l: Link,
    shieldPositions: ReadonlyArray<{ x: number; y: number; z: number }>,
    r2: number,
  ): boolean {
    for (const sp of shieldPositions) {
      for (const b of l.blocks) {
        const bp = b.body.translation();
        const d2 = (sp.x - bp.x) ** 2 + (sp.y - bp.y) ** 2 + (sp.z - bp.z) ** 2;
        if (d2 <= r2) return true;
      }
    }
    return false;
  }

  private measureAndBreak() {
    for (const b of this.blocks) b.strain = 0;
    for (const s of this.struts) s.strain = 0;
    const activeShieldPos: Array<{ x: number; y: number; z: number }> = [];
    for (const s of this.shieldBlocks) {
      if (!s.fallen) activeShieldPos.push(s.body.translation());
    }
    const r2 = T.shield.radius * T.shield.radius;
    for (const l of this.links) {
      if (l.broken) continue;
      const limit =
        activeShieldPos.length > 0 && this.isProtectedByShield(l, activeShieldPos, r2)
          ? l.limit * T.shield.stressMultiplier
          : l.limit;
      l.strain = SimRun.linkStretch(l) / limit;
      if (l.strain > this.peakStrain) {
        this.peakStrain = l.strain;
        this.peakStrainId = l.id;
      }
      if (l.strain > 1) {
        this.breakLink(l);
        continue;
      }
      for (const b of l.blocks) b.strain = Math.max(b.strain, l.strain);
      if (l.strut) l.strut.strain = l.strain;
    }
  }

  private breakLink(l: Link) {
    l.broken = true;
    l.strain = 0;
    if (l.joint) this.world.removeImpulseJoint(l.joint, true);
    l.joint = null;
    this.brokenCount++;
    this.firstBrokenId ??= l.id;
    this.linksDirty = true;
    if (l.strut) this.makeDebris(l.strut);
    this.events().onJointBreak?.(l.id);
  }

  /** A broken strut becomes a free-falling stick. */
  private makeDebris(s: StrutRec) {
    this.strutEndsInto(s, tmpV1, tmpV2);
    SimRun.strutMeshPoseInto(s, tmpV1, tmpV2, tmpPos, tmpQuat);
    const mid = tmpV1.clone().add(tmpV2).multiplyScalar(0.5);
    const dir = tmpV2.clone().sub(tmpV1);
    const len = Math.max(0.4, dir.length());
    const rot = new THREE.Quaternion().setFromUnitVectors(UP_UNIT, dir.normalize());
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic()
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }),
    );
    this.world.createCollider(
      this.R.ColliderDesc.capsule(len / 2 - 0.15, 0.15).setDensity(
        getMaterialDef(s.data.material, this.customMaterials).density,
      ),
      body,
    );
    s.debris = body;
    // From now on the mesh pose is stored relative to the debris body.
    const inv = rot.clone().invert();
    s.meshPos = tmpPos.clone().sub(mid).applyQuaternion(inv);
    s.meshQuat = inv.multiply(tmpQuat);
  }

  private strutEndsInto(s: StrutRec, outA: THREE.Vector3, outB: THREE.Vector3): void {
    if (s.endA) SimRun.worldPoint(s.endA.body, s.endA.local, outA);
    else outA.copy(s.initA);
    if (s.endB) SimRun.worldPoint(s.endB.body, s.endB.local, outB);
    else outB.copy(s.initB);
  }

  /** Mesh pose that maps the blueprint segment initA-initB onto the current segment a-b. */
  private static strutMeshPoseInto(
    s: StrutRec,
    a: THREE.Vector3,
    b: THREE.Vector3,
    outPos: THREE.Vector3,
    outQuat: THREE.Quaternion,
  ): void {
    tmpD0.subVectors(s.initB, s.initA).normalize();
    tmpD1.subVectors(b, a).normalize();
    tmpRot.setFromUnitVectors(tmpD0, tmpD1);
    tmpMid0.addVectors(s.initA, s.initB).multiplyScalar(0.5);
    tmpMid1.addVectors(a, b).multiplyScalar(0.5);
    outPos.subVectors(s.meshPos, tmpMid0).applyQuaternion(tmpRot).add(tmpMid1);
    outQuat.multiplyQuaternions(tmpRot, s.meshQuat);
  }

  // ---------------------------------------------------------------- scoring

  /** Marks pieces that came loose or drifted away as fallen and refreshes standingRatio. */
  private updateStanding() {
    if (this.linksDirty) {
      this.linksDirty = false;
      const held = new Set<BlockRec>();
      for (const l of this.links) if (!l.broken) for (const b of l.blocks) held.add(b);
      for (const b of this.blocks) if (!held.has(b)) b.fallen = true;
    }
    const g = this.ground.translation();
    const tol2 = T.standing.tolerance ** 2;
    for (const b of this.blocks) {
      if (b.fallen) continue;
      const p = b.body.translation();
      const drift2 =
        (p.x - g.x - b.start.x) ** 2 + (p.y - g.y - b.start.y) ** 2 + (p.z - g.z - b.start.z) ** 2;
      if (drift2 > tol2) b.fallen = true;
    }
    for (const s of this.struts) {
      if (s.fallen) continue;
      if (s.debris || s.endA?.rec?.fallen || s.endB?.rec?.fallen) s.fallen = true;
    }
    const total = this.blocks.length + this.struts.length;
    let fallen = 0;
    for (const b of this.blocks) if (b.fallen) fallen++;
    for (const s of this.struts) if (s.fallen) fallen++;
    this.standingRatio = total === 0 ? 1 : (total - fallen) / total;
  }

  // ---------------------------------------------------------------- rendering sync

  private syncMeshes() {
    for (const b of this.blocks) {
      if (!b.mesh) continue;
      const r = b.body.rotation();
      const t = b.body.translation();
      tmpQ1.set(r.x, r.y, r.z, r.w);
      b.mesh.position.copy(b.meshOffsetPos).applyQuaternion(tmpQ1);
      b.mesh.position.x += t.x;
      b.mesh.position.y += t.y;
      b.mesh.position.z += t.z;
      b.mesh.quaternion.multiplyQuaternions(tmpQ1, b.meshOffsetQuat);
      tint(b.mesh, b.strain);
    }
    for (const s of this.struts) {
      if (!s.mesh) continue;
      if (s.debris) {
        const r = s.debris.rotation();
        const t = s.debris.translation();
        tmpQ1.set(r.x, r.y, r.z, r.w);
        s.mesh.position.copy(s.meshPos).applyQuaternion(tmpQ1);
        s.mesh.position.x += t.x;
        s.mesh.position.y += t.y;
        s.mesh.position.z += t.z;
        s.mesh.quaternion.multiplyQuaternions(tmpQ1, s.meshQuat);
      } else {
        this.strutEndsInto(s, tmpV1, tmpV2);
        SimRun.strutMeshPoseInto(s, tmpV1, tmpV2, s.mesh.position, s.mesh.quaternion);
      }
      tint(s.mesh, s.strain);
    }
    for (const p of this.projectiles) {
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    for (const d of this.shieldDomes) {
      d.mesh.visible = !d.rec.fallen;
      const t = d.rec.body.translation();
      d.mesh.position.set(t.x, t.y, t.z);
    }
  }
}
