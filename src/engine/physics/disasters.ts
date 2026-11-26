import type { ModDisasterDef } from '../../mods/mods';
import { CELL_SIZE } from '../../types/blueprint';
import { spawnProjectile, spawnTargetedProjectile, updateProjectiles } from './combat';
import type { SimContext } from './context';
import { beaverShelter } from './helpers';
import { PHYSICS_TUNING, clamp01, envelope, smooth } from './tuning';
import type { BlockRec } from './types';

/** Disaster forces and projectile spawners; driven once per fixed step. */
const T = PHYSICS_TUNING;

/** 0..1 strength for audio. */
export function disasterIntensity(ctx: SimContext): number {
  const env = envelope(ctx.time, ctx.duration);
  if (ctx.customDisaster) return env;
  if (ctx.disaster === 'hurricane') return env * clamp01(ctx.gust);
  if (ctx.disaster === 'fire_tornado') return env * clamp01(0.5 + 0.5 * ctx.gust);
  if (ctx.disaster === 'snow_storm') return env * clamp01(0.4 + 0.6 * ctx.gust);
  if (ctx.disaster === 'flood') return env * 0.7;
  return env;
}

/** Open area facing a flow along (dx, dz): the -x face meets a +x flow, and so on. */
function upstreamExposure(b: BlockRec, dx: number, dz: number) {
  const [px, nx, pz, nz] = b.exposure;
  return Math.max(0, -dx) * nx + Math.max(0, dx) * px + Math.max(0, -dz) * nz + Math.max(0, dz) * pz;
}

export function applyDisaster(ctx: SimContext) {
  if (ctx.customDisaster) return applyCustomDisaster(ctx, ctx.customDisaster);
  switch (ctx.disaster) {
    case 'earthquake':
      return applyQuake(ctx);
    case 'hurricane':
      return applyWind(ctx);
    case 'flood':
      return applyFlood(ctx);
    case 'hail':
      return applyHail(ctx);
    case 'fire_tornado':
      return applyFireTornado(ctx);
    case 'snow_storm':
      return applySnowStorm(ctx);
    case 'raid':
      return applyRaid(ctx);
    case 'meteor':
      return applyMeteor(ctx);
  }
}

export function applyQuake(ctx: SimContext, scale = 1) {
  const q = T.quake;
  const t = ctx.time;
  const env = envelope(t, ctx.duration);
  let dx = 0;
  let dz = 0;
  for (let i = 0; i < q.freqs.length; i++) {
    const w = 2 * Math.PI * q.freqs[i];
    dx += q.weights[i] * Math.sin(w * t + ctx.quakePhase[i]);
    dz += q.weights[i] * Math.sin(w * 1.13 * t + ctx.quakePhase[i + 3]);
  }
  const amp = q.amplitude * scale * ctx.power * env;
  ctx.ground.setNextKinematicTranslation({ x: amp * dx, y: 0, z: amp * q.zRatio * dz });
}

export function applyWindForce(
  ctx: SimContext,
  force: number,
  spinSpeed: number,
  reset = true,
): { wx: number; wz: number } {
  const w = T.wind;
  ctx.gustTimer -= T.step;
  if (ctx.gustTimer <= 0) {
    ctx.gustTimer = 0.4 + ctx.rng() * 0.8;
    ctx.gustTarget = w.gustMin + ctx.rng() * (1 - w.gustMin) * 1.3;
  }
  ctx.gust += (ctx.gustTarget - ctx.gust) * Math.min(1, T.step * 4);
  ctx.flowAngle += spinSpeed * T.step;
  const wx = Math.cos(ctx.flowAngle);
  const wz = Math.sin(ctx.flowAngle);
  const strength = force * ctx.power * envelope(ctx.time, ctx.duration) * ctx.gust;
  for (const b of ctx.blocks) {
    const height = 1 + w.heightGain * Math.max(0, b.body.translation().y);
    const f = strength * upstreamExposure(b, wx, wz) * height;
    if (reset) b.body.resetForces(false);
    b.body.addForce({ x: wx * f, y: 0, z: wz * f }, true);
  }
  return { wx, wz };
}

export function applyWind(ctx: SimContext) {
  applyWindForce(ctx, T.wind.force, ctx.flowSpin);
}

export function applyFlood(ctx: SimContext, reset = true) {
  const f = T.flood;
  const env = envelope(ctx.time, ctx.duration);
  ctx.waterLevel = f.start + (f.peak - f.start) * smooth(ctx.time / f.riseSeconds);
  ctx.events().onWaterLevel?.(ctx.waterLevel);
  const cx = Math.cos(ctx.flowAngle);
  const cz = Math.sin(ctx.flowAngle);
  for (const b of ctx.blocks) {
    if (reset) b.body.resetForces(false);
    const p = b.body.translation();
    const sub = clamp01((ctx.waterLevel - (p.y - CELL_SIZE / 2)) / CELL_SIZE);
    if (sub <= 0) continue;
    const v = b.body.linvel();
    const drag = f.drag * sub * b.mass;
    // The current pushes upstream faces regardless of material, so heavy blocks resist it better.
    const push =
      f.current * ctx.power * env * sub * upstreamExposure(b, cx, cz) * beaverShelter(ctx, p.x, p.z);
    b.body.addForce(
      {
        x: cx * push - v.x * drag,
        y: sub * b.mass * ctx.gravity * b.buoyancy - v.y * drag,
        z: cz * push - v.z * drag,
      },
      true,
    );
  }
}

export function applyHail(ctx: SimContext) {
  const h = T.hail;
  ctx.spawnAccumulator += h.perSecond * ctx.power * envelope(ctx.time, ctx.duration) * T.step;
  while (ctx.spawnAccumulator >= 1) {
    ctx.spawnAccumulator -= 1;
    spawnHail(ctx);
  }
  updateProjectiles(ctx);
}

export function applyFireTornado(ctx: SimContext) {
  const ft = T.fire_tornado;
  applyWindForce(ctx, ft.windForce, ft.swirlSpeed);
  ctx.spawnAccumulator += ft.perSecond * ctx.power * envelope(ctx.time, ctx.duration) * T.step;
  while (ctx.spawnAccumulator >= 1) {
    ctx.spawnAccumulator -= 1;
    const angle = ctx.flowAngle + (ctx.rng() - 0.5) * 2.2;
    const dist = 12 + ctx.rng() * 3;
    const sx = Math.cos(angle) * dist;
    const sz = Math.sin(angle) * dist;
    const sy = 2.5 + ctx.rng() * Math.max(6, ctx.spawnBox.top + 3);
    const r = ft.radiusMin + ctx.rng() * (ft.radiusMax - ft.radiusMin);
    spawnTargetedProjectile(ctx, 'fireball', sx, sy, sz, r, ft.density, ft.speed * Math.sqrt(ctx.power));
  }
  updateProjectiles(ctx);
}

export function applySnowStorm(ctx: SimContext) {
  const sn = T.snow_storm;
  const { wx, wz } = applyWindForce(ctx, sn.windForce, ctx.flowSpin);
  ctx.spawnAccumulator += sn.perSecond * ctx.power * envelope(ctx.time, ctx.duration) * T.step;
  while (ctx.spawnAccumulator >= 1) {
    ctx.spawnAccumulator -= 1;
    const b = ctx.spawnBox;
    const r = sn.radiusMin + ctx.rng() * (sn.radiusMax - sn.radiusMin);
    const x = b.minX + ctx.rng() * (b.maxX - b.minX) - wx * 2;
    const z = b.minZ + ctx.rng() * (b.maxZ - b.minZ) - wz * 2;
    const y = b.top + sn.height * (0.6 + 0.4 * ctx.rng());
    const speed = sn.speed * Math.sqrt(ctx.power);
    spawnProjectile(ctx, 'snowball', x, y, z, wx * 3.5, -speed, wz * 3.5, r, sn.density, speed, 0);
  }
  updateProjectiles(ctx);
}

export function applyRaid(ctx: SimContext) {
  const rd = T.raid;
  ctx.spawnAccumulator += rd.perSecond * ctx.power * envelope(ctx.time, ctx.duration) * T.step;
  while (ctx.spawnAccumulator >= 1) {
    ctx.spawnAccumulator -= 1;
    const angle = ctx.rng() * Math.PI * 2;
    const sx = Math.cos(angle) * rd.spawnRadius;
    const sz = Math.sin(angle) * rd.spawnRadius;
    const sy = 2 + ctx.rng() * Math.max(5, ctx.spawnBox.top + 2);
    const r = rd.radiusMin + ctx.rng() * (rd.radiusMax - rd.radiusMin);
    spawnTargetedProjectile(ctx, 'raider', sx, sy, sz, r, rd.density, rd.speed * Math.sqrt(ctx.power));
  }
  updateProjectiles(ctx);
}

export function applyMeteor(ctx: SimContext) {
  const mt = T.meteor;
  ctx.spawnAccumulator += mt.perSecond * ctx.power * envelope(ctx.time, ctx.duration) * T.step;
  while (ctx.spawnAccumulator >= 1) {
    ctx.spawnAccumulator -= 1;
    const b = ctx.spawnBox;
    const r = mt.radiusMin + ctx.rng() * (mt.radiusMax - mt.radiusMin);
    const x = b.minX + ctx.rng() * (b.maxX - b.minX);
    const z = b.minZ + ctx.rng() * (b.maxZ - b.minZ);
    const y = b.top + mt.height * (0.7 + 0.3 * ctx.rng());
    const speed = mt.speed * Math.sqrt(ctx.power);
    const vx = (ctx.rng() - 0.5) * 4;
    const vz = (ctx.rng() - 0.5) * 4;
    spawnProjectile(ctx, 'meteor', x, y, z, vx, -speed, vz, r, mt.density, speed, 0);
  }
  updateProjectiles(ctx);
}

export function applyCustomDisaster(ctx: SimContext, def: ModDisasterDef) {
  for (const b of ctx.blocks) b.body.resetForces(false);
  if (def.quake) applyQuake(ctx, def.quake);
  if (def.wind) applyWindForce(ctx, T.wind.force * def.wind, ctx.flowSpin, false);
  if (def.flood) applyFlood(ctx, false);
  if (def.projectiles) {
    const p = def.projectiles;
    const env = envelope(ctx.time, ctx.duration);
    ctx.spawnAccumulator += p.rate * ctx.power * env * T.step;
    while (ctx.spawnAccumulator >= 1) {
      ctx.spawnAccumulator -= 1;
      const speed = p.speed * Math.sqrt(ctx.power);
      if (p.mode === 'rain') {
        const b = ctx.spawnBox;
        const x = b.minX + ctx.rng() * (b.maxX - b.minX);
        const z = b.minZ + ctx.rng() * (b.maxZ - b.minZ);
        const y = b.top + 14 * (0.6 + 0.4 * ctx.rng());
        spawnProjectile(ctx, 'custom', x, y, z, 0, -speed, 0, p.radius, p.density, speed, 0);
      } else {
        const angle = ctx.rng() * Math.PI * 2;
        const sx = Math.cos(angle) * 14.5;
        const sz = Math.sin(angle) * 14.5;
        const sy = 2 + ctx.rng() * Math.max(5, ctx.spawnBox.top + 2);
        spawnTargetedProjectile(ctx, 'custom', sx, sy, sz, p.radius, p.density, speed);
      }
    }
    updateProjectiles(ctx);
  }
}

export function spawnHail(ctx: SimContext) {
  const h = T.hail;
  const b = ctx.spawnBox;
  const r = h.radiusMin + ctx.rng() * (h.radiusMax - h.radiusMin);
  const x = b.minX + ctx.rng() * (b.maxX - b.minX);
  const z = b.minZ + ctx.rng() * (b.maxZ - b.minZ);
  const y = b.top + h.height * (0.6 + 0.4 * ctx.rng());
  const speed = h.speed * Math.sqrt(ctx.power);
  spawnProjectile(ctx, 'hail', x, y, z, 0, -speed, 0, r, h.density, speed, 0);
}
