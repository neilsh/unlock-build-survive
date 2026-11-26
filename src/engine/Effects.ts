/**
 * Disaster visuals: camera shake, quake dust, wind streaks and leaves, flood splashes and hail puffs.
 *
 * Every effect is a fixed-size pool of instanced meshes (one draw call each, no per-frame
 * allocation), so it stays cheap on tablets. A particle that is not alive is parked at scale 0.
 * Particles shrink instead of fading, which avoids transparency sorting and keeps the look toy-like.
 * Hail puffs are spawned where the physics reports a stone landing (see hailImpact).
 * `prefers-reduced-motion` turns the shake off and halves the particle rates.
 */
import * as THREE from 'three';
import type { BuiltinDisasterType, DisasterType, ProjectileKind, Vec3 } from '../types/blueprint';
import { getIslandSize, isBuiltinDisaster } from '../types/blueprint';
import { intToHex } from '../utils/color';

export interface CustomDisasterFx {
  color: number;
  quake?: boolean;
  wind?: boolean;
}

/** If setDisasterFx is not called for this long, the disaster is treated as over. */
const STALE_SECONDS = 0.3;
const SHAKE_MAX = 0.32;
const SHAKE_FREQ = 26;
/** Half-width of the island's rock slab; flood water below the top (y 0) is hidden inside it. */
const slabHalf = (): number => getIslandSize() / 2 + 1.5;
const LASER_POOL = 8;
const LASER_LIFE = 0.18;
const UP_AXIS = new THREE.Vector3(0, 1, 0);

const SKY_TINTS: Partial<Record<BuiltinDisasterType, string>> = {
  hurricane: '#7f98ad',
  hail: '#a3b4c4',
  flood: '#8fb3cc',
  fire_tornado: '#d97742',
  snow_storm: '#dcebf7',
  raid: '#8f8aa3',
  meteor: '#6d597a',
};

const IMPACT_COLORS: Record<ProjectileKind, [string, string]> = {
  hail: ['#f4fbff', '#dff3ff'],
  snowball: ['#ffffff', '#e0f2fe'],
  fireball: ['#ff6a00', '#ffd54f'],
  raider: ['#90a4ae', '#ffab40'],
  meteor: ['#ff5722', '#ffd740'],
  custom: ['#a3e635', '#fef08a'],
};

const scratchM = new THREE.Matrix4();
const scratchQ = new THREE.Quaternion();
const scratchE = new THREE.Euler();
const scratchS = new THREE.Vector3();
const scratchP = new THREE.Vector3();
const scratchC = new THREE.Color();

const lambert = (color: string) => new THREE.MeshLambertMaterial({ color });

interface Spec {
  count: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

interface SpawnOptions {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  life: number;
  /** Downward acceleration, units/s^2. */
  gravity?: number;
  /** Fraction of velocity lost per second. */
  drag?: number;
  /** Growth multiplier over life (1 = constant size, >1 = puffs outwards before shrinking). */
  grow?: number;
  spin?: number;
  color: string | number;
  /** Stretch along the x axis, for streaks. */
  stretch?: number;
}

/** Fixed pool of instanced particles with simple ballistic motion. */
class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.Material;
  private readonly n: number;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly data: Float32Array; // pos3 vel3 size gravity drag grow spin rot stretch = 14
  private cursor = 0;
  private static readonly STRIDE = 14;

  constructor(spec: Spec) {
    this.n = spec.count;
    this.material = spec.material;
    this.mesh = new THREE.InstancedMesh(spec.geometry, spec.material, spec.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // bounds of instances are not tracked
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.age = new Float32Array(spec.count).fill(1);
    this.life = new Float32Array(spec.count).fill(1);
    this.data = new Float32Array(spec.count * ParticlePool.STRIDE);
    scratchM.makeScale(0, 0, 0);
    for (let i = 0; i < spec.count; i++) this.mesh.setMatrixAt(i, scratchM);
    this.mesh.setColorAt(0, scratchC.set('#ffffff'));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(o: SpawnOptions): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const d = this.data;
    const k = i * ParticlePool.STRIDE;
    d[k] = o.x;
    d[k + 1] = o.y;
    d[k + 2] = o.z;
    d[k + 3] = o.vx;
    d[k + 4] = o.vy;
    d[k + 5] = o.vz;
    d[k + 6] = o.size;
    d[k + 7] = o.gravity ?? 0;
    d[k + 8] = o.drag ?? 0;
    d[k + 9] = o.grow ?? 1;
    d[k + 10] = o.spin ?? 0;
    d[k + 11] = Math.random() * Math.PI * 2;
    d[k + 12] = o.stretch ?? 1;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.mesh.setColorAt(i, scratchC.set(o.color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const d = this.data;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= 1) continue;
      any = true;
      const k = i * ParticlePool.STRIDE;
      this.age[i] += dt / this.life[i];
      if (this.age[i] >= 1) {
        scratchM.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, scratchM);
        continue;
      }
      const t = this.age[i];
      const damp = Math.max(0, 1 - d[k + 8] * dt);
      d[k + 3] *= damp;
      d[k + 4] = d[k + 4] * damp - d[k + 7] * dt;
      d[k + 5] *= damp;
      d[k] += d[k + 3] * dt;
      d[k + 1] += d[k + 4] * dt;
      d[k + 2] += d[k + 5] * dt;
      d[k + 11] += d[k + 10] * dt;
      // Pop in quickly, swell by `grow`, then shrink to nothing.
      const pop = Math.min(1, t * 8);
      const fade = 1 - t * t;
      const swell = 1 + (d[k + 9] - 1) * Math.sqrt(t);
      const s = d[k + 6] * pop * fade * swell;
      scratchP.set(d[k], d[k + 1], d[k + 2]);
      scratchS.set(s * d[k + 12], s, s);
      scratchE.set(d[k + 11] * 0.7, d[k + 11], d[k + 11] * 0.4);
      if (d[k + 12] !== 1) scratchE.set(0, Math.atan2(-d[k + 5], d[k + 3]), 0);
      scratchQ.setFromEuler(scratchE);
      scratchM.compose(scratchP, scratchQ, scratchS);
      this.mesh.setMatrixAt(i, scratchM);
    }
    if (any || this.dirty) this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = any;
  }

  private dirty = false;

  clear(): void {
    scratchM.makeScale(0, 0, 0);
    for (let i = 0; i < this.n; i++) {
      this.age[i] = 1;
      this.mesh.setMatrixAt(i, scratchM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

export interface EffectsOptions {
  /** Test hook: override the media query lookup. */
  reducedMotion?: boolean;
}

export class DisasterEffects {
  /** Camera offset to add after controls update and remove after render. */
  readonly shakeOffset = new THREE.Vector3();

  private readonly dust: ParticlePool;
  private readonly leaves: ParticlePool;
  private readonly streaks: ParticlePool;
  private readonly splashes: ParticlePool;
  private readonly puffs: ParticlePool;
  private readonly pools: ParticlePool[];
  private readonly laserGeom = new THREE.CylinderGeometry(0.09, 0.09, 1, 8);
  private readonly laserMat = new THREE.MeshBasicMaterial({ color: '#ff4d6d' });
  private readonly beams: Array<{ mesh: THREE.Mesh; len: number; life: number }> = [];
  private beamCursor = 0;
  private readonly reduced: boolean;

  private disaster: DisasterType | null = null;
  private customFx: CustomDisasterFx | null = null;
  private target = 0;
  private level = 0;
  private sinceCall = 0;
  private time = 0;
  private carry = { dust: 0, leaf: 0, streak: 0, splash: 0 };
  private waterY = -2;

  constructor(
    parent: THREE.Object3D,
    private readonly skyColors: { background: THREE.Color; fog: THREE.Fog },
    opts: EffectsOptions = {},
  ) {
    this.reduced =
      opts.reducedMotion ??
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.dust = new ParticlePool({
      count: 90,
      geometry: new THREE.IcosahedronGeometry(1, 1),
      material: lambert('#ffffff'),
    });
    this.leaves = new ParticlePool({
      count: 36,
      geometry: new THREE.CircleGeometry(1, 5),
      material: new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }),
    });
    this.streaks = new ParticlePool({
      count: 40,
      geometry: new THREE.BoxGeometry(1, 0.06, 0.06),
      material: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    });
    this.splashes = new ParticlePool({
      count: 90,
      geometry: new THREE.IcosahedronGeometry(1, 0),
      material: lambert('#ffffff'),
    });
    this.puffs = new ParticlePool({
      count: 60,
      geometry: new THREE.IcosahedronGeometry(1, 1),
      material: lambert('#ffffff'),
    });
    this.pools = [this.dust, this.leaves, this.streaks, this.splashes, this.puffs];
    for (const p of this.pools) parent.add(p.mesh);
    for (let i = 0; i < LASER_POOL; i++) {
      const mesh = new THREE.Mesh(this.laserGeom, this.laserMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.beams.push({ mesh, len: 1, life: 0 });
    }
    this.baseBackground = skyColors.background.clone();
    this.baseFog = skyColors.fog.color.clone();
  }

  private readonly baseBackground: THREE.Color;
  private readonly baseFog: THREE.Color;

  /** Called by the physics every step; the intensity is 0..1. 0 (run ended or rewound) clears all. */
  setDisaster(disaster: DisasterType, intensity: number, customMeta?: CustomDisasterFx): void {
    if (intensity <= 0) {
      this.reset();
      return;
    }
    this.disaster = disaster;
    this.customFx = customMeta ?? null;
    this.target = Math.min(1, Math.max(0, intensity));
    this.sinceCall = 0;
  }

  setWaterLevel(y: number): void {
    this.waterY = y;
  }

  update(dt: number): void {
    this.time += dt;
    this.sinceCall += dt;
    if (this.sinceCall > STALE_SECONDS) this.target = 0;
    // Ease the level so the shake and tint do not pop on and off.
    this.level += (this.target - this.level) * Math.min(1, dt * (this.target > this.level ? 10 : 5));
    if (this.level < 0.001 && this.target === 0) this.level = 0;

    const k = this.reduced ? 0.5 : 1;
    const lv = this.level;
    if (this.disaster && lv > 0) {
      if (isBuiltinDisaster(this.disaster)) {
        switch (this.disaster) {
          case 'earthquake':
            this.spawnDust(dt, lv, k);
            break;
          case 'hurricane':
            this.spawnWind(dt, lv, k);
            break;
          case 'flood':
            this.spawnSplashes(dt, lv, k);
            break;
          case 'hail':
            // Puffs come from hailImpact, at the spots where stones actually land.
            break;
          case 'fire_tornado':
            this.spawnFireTornado(dt, lv, k);
            break;
          case 'snow_storm':
            this.spawnSnowStorm(dt, lv, k);
            break;
          case 'raid':
            this.spawnRaid(dt, lv, k);
            break;
          case 'meteor':
            this.spawnMeteor(dt, lv, k);
            break;
        }
      } else if (this.customFx) {
        if (this.customFx.quake) this.spawnDust(dt, lv, k);
        if (this.customFx.wind) this.spawnWind(dt, lv, k);
        this.spawnCustomMotes(dt, lv, k, this.customFx.color);
      }
    }
    for (const p of this.pools) p.update(dt);
    this.updateBeams(dt);
    this.updateShake(lv);
    this.updateSky(lv);
  }

  /** Stop spawning and clear everything (called when a run is rewound). */
  reset(): void {
    this.target = 0;
    this.level = 0;
    this.disaster = null;
    this.customFx = null;
    this.shakeOffset.set(0, 0, 0);
    for (const p of this.pools) p.clear();
    for (const b of this.beams) {
      b.life = 0;
      b.mesh.visible = false;
    }
    this.updateSky(0);
  }

  /** A hail stone landed at this world point: pop a small icy puff with a few bouncing bits. */
  hailImpact(x: number, y: number, z: number): void {
    if (this.disaster !== 'hail') return;
    this.projectileImpact('hail', x, y, z);
  }

  /** A disaster projectile hit the ground or a building: pop a themed puff and bouncing bits. */
  projectileImpact(kind: ProjectileKind, x: number, y: number, z: number): void {
    if (!this.disaster || this.level <= 0) return;
    const [mainColor, bitColor] =
      kind === 'custom' && this.customFx ? [intToHex(this.customFx.color), '#ffffff'] : IMPACT_COLORS[kind];
    this.puffs.spawn({
      x,
      y: y + 0.1,
      z,
      vx: 0,
      vy: 0.6,
      vz: 0,
      size: 0.3 + Math.random() * 0.2,
      life: 0.45,
      grow: 2.4,
      color: mainColor,
    });
    const bits = this.reduced ? 1 : 3;
    for (let j = 0; j < bits; j++) {
      const a = Math.random() * Math.PI * 2;
      this.puffs.spawn({
        x,
        y: y + 0.15,
        z,
        vx: Math.cos(a) * 2.4,
        vy: 2.5 + Math.random() * 1.5,
        vz: Math.sin(a) * 2.4,
        size: 0.1,
        gravity: 12,
        life: 0.5,
        color: bitColor,
      });
    }
  }

  /** Flashes a glowing laser beam from `from` to `to` and pops sparks at the target. */
  laserBeam(from: Vec3, to: Vec3): void {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-4) return;
    const beam = this.beams[this.beamCursor];
    this.beamCursor = (this.beamCursor + 1) % this.beams.length;
    if (beam) {
      beam.mesh.position.copy(a).add(b).multiplyScalar(0.5);
      beam.mesh.quaternion.setFromUnitVectors(UP_AXIS, dir.normalize());
      beam.mesh.scale.set(1, len, 1);
      beam.mesh.visible = true;
      beam.len = len;
      beam.life = LASER_LIFE;
    }
    const sparks = this.reduced ? 1 : 3;
    for (let j = 0; j < sparks; j++) {
      const ang = Math.random() * Math.PI * 2;
      this.puffs.spawn({
        x: to[0],
        y: to[1],
        z: to[2],
        vx: Math.cos(ang) * 3,
        vy: (Math.random() - 0.2) * 3,
        vz: Math.sin(ang) * 3,
        size: 0.14,
        life: 0.25,
        grow: 1.5,
        color: j === 0 ? '#ffe066' : '#ff4d6d',
      });
    }
  }

  dispose(): void {
    for (const p of this.pools) p.dispose();
    for (const b of this.beams) b.mesh.removeFromParent();
    this.laserGeom.dispose();
    this.laserMat.dispose();
    this.updateSky(0);
  }

  // ------------------------------------------------------------ helpers

  private emit(key: keyof typeof this.carry, ratePerSecond: number, dt: number): number {
    this.carry[key] += ratePerSecond * dt;
    const n = Math.floor(this.carry[key]);
    this.carry[key] -= n;
    return n;
  }

  private spawnDust(dt: number, lv: number, k: number): void {
    const tones = ['#e8cf9a', '#d9b87a', '#f1e0b8'];
    for (let n = this.emit('dust', 40 * lv * k, dt); n > 0; n--) {
      // Mostly around the rim and the build area: that is where the ground rattles.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (getIslandSize() / 2 + 1);
      this.dust.spawn({
        x: Math.cos(a) * r,
        y: 0.1,
        z: Math.sin(a) * r,
        vx: (Math.random() - 0.5) * 1.2,
        vy: 1.2 + Math.random() * 1.6,
        vz: (Math.random() - 0.5) * 1.2,
        size: 0.12 + Math.random() * 0.16,
        life: 0.9 + Math.random() * 0.7,
        drag: 0.8,
        grow: 1.9,
        color: tones[(Math.random() * tones.length) | 0],
      });
    }
  }

  private spawnWind(dt: number, lv: number, k: number): void {
    const swirl = Math.sin(this.time * 0.9) * 0.25;
    for (let n = this.emit('streak', 26 * lv * k, dt); n > 0; n--) {
      const speed = 26 + Math.random() * 10;
      this.streaks.spawn({
        x: -(getIslandSize() / 2) - 10 + Math.random() * 4,
        y: 0.6 + Math.random() * 11,
        z: (Math.random() - 0.5) * (getIslandSize() + 8),
        vx: speed,
        vy: 0,
        vz: speed * swirl,
        size: 1.2 + Math.random() * 1.4,
        stretch: 2.6,
        life: 0.9 + Math.random() * 0.35,
        color: '#ffffff',
      });
    }
    const leafTones = ['#8ed35a', '#f2a93b', '#e86a4a', '#b6e06a'];
    for (let n = this.emit('leaf', 9 * lv * k, dt); n > 0; n--) {
      this.leaves.spawn({
        x: -(getIslandSize() / 2) - 6 + Math.random() * 3,
        y: 0.5 + Math.random() * 6,
        z: (Math.random() - 0.5) * getIslandSize(),
        vx: 11 + Math.random() * 7,
        vy: 1.5 + Math.random() * 2.5,
        vz: (Math.random() - 0.5) * 5,
        size: 0.18 + Math.random() * 0.14,
        gravity: 0.8,
        spin: 7 + Math.random() * 7,
        life: 1.8 + Math.random() * 0.8,
        grow: 1,
        color: leafTones[(Math.random() * leafTones.length) | 0],
      });
    }
  }

  private spawnSplashes(dt: number, lv: number, k: number): void {
    if (this.waterY < -1) return;
    const tones = ['#bfe6ff', '#ffffff', '#8fd0ff'];
    for (let n = this.emit('splash', 42 * lv * k, dt); n > 0; n--) {
      let x = (Math.random() - 0.5) * (getIslandSize() + 6);
      let z = (Math.random() - 0.5) * (getIslandSize() + 6);
      // While the water is below the island top, splashes inside the rock slab would be hidden:
      // push them out to the shoreline instead.
      if (this.waterY < 0 && Math.abs(x) < slabHalf() && Math.abs(z) < slabHalf()) {
        const edge = slabHalf() + Math.random() * 1.5;
        if (Math.abs(x) > Math.abs(z)) x = Math.sign(x) * edge;
        else z = Math.sign(z || 1) * edge;
      }
      this.splashes.spawn({
        x,
        y: this.waterY + 0.1,
        z,
        vx: (Math.random() - 0.5) * 2.4,
        vy: 3 + Math.random() * 3,
        vz: (Math.random() - 0.5) * 2.4,
        size: 0.13 + Math.random() * 0.14,
        gravity: 14,
        life: 0.7 + Math.random() * 0.35,
        color: tones[(Math.random() * tones.length) | 0],
      });
    }
  }

  private spawnFireTornado(dt: number, lv: number, k: number): void {
    const tones = ['#ff6a00', '#ff3d00', '#ffd54f'];
    for (let n = this.emit('dust', 46 * lv * k, dt); n > 0; n--) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * (getIslandSize() / 2 + 3);
      const speed = 7 + Math.random() * 5;
      this.dust.spawn({
        x: Math.cos(a) * r,
        y: 0.2 + Math.random() * 6,
        z: Math.sin(a) * r,
        vx: -Math.sin(a) * speed,
        vy: 2.5 + Math.random() * 3,
        vz: Math.cos(a) * speed,
        size: 0.15 + Math.random() * 0.18,
        life: 0.75 + Math.random() * 0.45,
        grow: 1.4,
        color: tones[(Math.random() * tones.length) | 0],
      });
    }
    for (let n = this.emit('streak', 18 * lv * k, dt); n > 0; n--) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 6;
      const speed = 18 + Math.random() * 8;
      this.streaks.spawn({
        x: Math.cos(a) * r,
        y: 1 + Math.random() * 10,
        z: Math.sin(a) * r,
        vx: -Math.sin(a) * speed,
        vy: 1,
        vz: Math.cos(a) * speed,
        size: 1.0 + Math.random() * 1.1,
        stretch: 2.2,
        life: 0.65 + Math.random() * 0.25,
        color: '#ffb74d',
      });
    }
  }

  private spawnSnowStorm(dt: number, lv: number, k: number): void {
    for (let n = this.emit('dust', 42 * lv * k, dt); n > 0; n--) {
      this.dust.spawn({
        x: -(getIslandSize() / 2) - 4 + Math.random() * (getIslandSize() + 8),
        y: 8 + Math.random() * 7,
        z: (Math.random() - 0.5) * (getIslandSize() + 8),
        vx: 4 + Math.random() * 4,
        vy: -(5 + Math.random() * 3),
        vz: (Math.random() - 0.5) * 3,
        size: 0.1 + Math.random() * 0.12,
        life: 1.2 + Math.random() * 0.5,
        grow: 1,
        color: '#ffffff',
      });
    }
    for (let n = this.emit('streak', 18 * lv * k, dt); n > 0; n--) {
      const speed = 22 + Math.random() * 8;
      this.streaks.spawn({
        x: -(getIslandSize() / 2) - 8 + Math.random() * 4,
        y: 1 + Math.random() * 10,
        z: (Math.random() - 0.5) * (getIslandSize() + 8),
        vx: speed,
        vy: -1,
        vz: (Math.random() - 0.5) * 4,
        size: 1.0 + Math.random() * 1.0,
        stretch: 2.2,
        life: 0.8 + Math.random() * 0.3,
        color: '#e0f2fe',
      });
    }
  }

  private spawnRaid(dt: number, lv: number, k: number): void {
    for (let n = this.emit('dust', 16 * lv * k, dt); n > 0; n--) {
      const a = Math.random() * Math.PI * 2;
      const r = getIslandSize() / 2 + 4 + Math.random() * 3;
      this.dust.spawn({
        x: Math.cos(a) * r,
        y: 1.5 + Math.random() * 4,
        z: Math.sin(a) * r,
        vx: (Math.random() - 0.5) * 2,
        vy: 1 + Math.random() * 2,
        vz: (Math.random() - 0.5) * 2,
        size: 0.16 + Math.random() * 0.16,
        life: 0.7 + Math.random() * 0.4,
        grow: 1.8,
        color: '#94a3b8',
      });
    }
  }

  private spawnMeteor(dt: number, lv: number, k: number): void {
    for (let n = this.emit('streak', 14 * lv * k, dt); n > 0; n--) {
      this.streaks.spawn({
        x: (Math.random() - 0.5) * (getIslandSize() + 6),
        y: 14 + Math.random() * 6,
        z: (Math.random() - 0.5) * (getIslandSize() + 6),
        vx: (Math.random() - 0.5) * 4,
        vy: -(18 + Math.random() * 8),
        vz: (Math.random() - 0.5) * 4,
        size: 1.3 + Math.random() * 1.2,
        stretch: 2.5,
        life: 0.55 + Math.random() * 0.25,
        color: '#ff9800',
      });
    }
  }

  private spawnCustomMotes(dt: number, lv: number, k: number, color: number): void {
    const hex = intToHex(color);
    for (let n = this.emit('streak', 16 * lv * k, dt); n > 0; n--) {
      this.streaks.spawn({
        x: (Math.random() - 0.5) * (getIslandSize() + 8),
        y: 2 + Math.random() * 11,
        z: (Math.random() - 0.5) * (getIslandSize() + 8),
        vx: (Math.random() - 0.5) * 14,
        vy: -6 - Math.random() * 6,
        vz: (Math.random() - 0.5) * 14,
        size: 1.0 + Math.random() * 0.9,
        stretch: 2.0,
        life: 0.6 + Math.random() * 0.3,
        color: hex,
      });
    }
  }

  private updateBeams(dt: number): void {
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.life = 0;
        b.mesh.visible = false;
      } else {
        const w = b.life / LASER_LIFE;
        b.mesh.scale.set(w, b.len, w);
      }
    }
  }

  private updateShake(level: number): void {
    if (this.reduced || (this.disaster !== 'earthquake' && !this.customFx?.quake) || level <= 0) {
      this.shakeOffset.set(0, 0, 0);
      return;
    }
    const a = level * SHAKE_MAX;
    const t = this.time * SHAKE_FREQ;
    this.shakeOffset.set(
      (Math.sin(t) + Math.sin(t * 1.7 + 1)) * 0.5 * a,
      (Math.sin(t * 1.3 + 2) + Math.sin(t * 2.3)) * 0.5 * a * 0.6,
      (Math.sin(t * 0.9 + 4) + Math.sin(t * 1.9)) * 0.5 * a * 0.4,
    );
  }

  /** Gently darken the sky for storms; kept subtle so the island still looks sunny. */
  private updateSky(level: number): void {
    const tint =
      this.disaster && isBuiltinDisaster(this.disaster)
        ? (SKY_TINTS[this.disaster] ?? null)
        : this.customFx
          ? intToHex(this.customFx.color)
          : null;
    const amount = tint ? level * 0.55 : 0;
    this.skyColors.background.copy(this.baseBackground);
    this.skyColors.fog.color.copy(this.baseFog);
    if (tint && amount > 0) {
      scratchC.set(tint);
      this.skyColors.background.lerp(scratchC, amount);
      this.skyColors.fog.color.lerp(scratchC, amount);
    }
  }
}
