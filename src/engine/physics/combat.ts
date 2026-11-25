import * as THREE from 'three';
import type { ProjectileKind, Vec3 } from '../../types/blueprint';
import { CELL_SIZE } from '../../types/blueprint';
import type { WeaponDef } from '../../types/gear';
import type { SimContext } from './context';
import type { Projectile } from './projectiles';
import { PHYSICS_TUNING, clamp01 } from './tuning';
import type { PlayerHitResult, PlayerProtection, WeaponFireResult } from './tuning';

/** Projectile lifecycle, laser turrets and first-person weapon / damage checks. */
const T = PHYSICS_TUNING;

export function checkPlayerDamage(
  ctx: SimContext,
  feet: Vec3,
  dt: number,
  protection?: PlayerProtection,
): PlayerHitResult {
  if (!ctx.running) return { damage: 0, cause: null, impact: false };
  const safeDt = Math.max(0, dt);
  ctx.playerInvuln = Math.max(0, ctx.playerInvuln - safeDt);
  const [px, py, pz] = feet;

  if (py < T.player.fallY) {
    return { damage: T.player.maxHp, cause: 'You fell off the island!', impact: true };
  }

  let damage = 0;
  let cause: string | null = null;
  let impact = false;

  if (!protection?.floodImmune && ctx.waterLevel > py + 1.45) {
    damage += T.player.drownDps * safeDt;
    cause = 'Swept by the flood!';
  }

  if (ctx.playerInvuln <= 0) {
    let destroyedProj = false;
    for (const proj of ctx.projectiles) {
      if (proj.destroyed) continue;
      const v = proj.body.linvel();
      if (proj.landed && Math.hypot(v.x, v.y, v.z) < 3) continue;
      const pp = proj.body.translation();
      const clampedY = Math.max(py + T.player.radius, Math.min(py + T.player.height - T.player.radius, pp.y));
      const d2 = (pp.x - px) ** 2 + (pp.y - clampedY) ** 2 + (pp.z - pz) ** 2;
      const hitDist = proj.radius + T.player.radius;
      if (d2 <= hitDist * hitDist) {
        proj.destroyed = true;
        destroyedProj = true;
        ctx.effectsRoot?.remove(proj.mesh);
        ctx.world.removeRigidBody(proj.body);
        damage += T.projectileDamage[proj.kind];
        cause = 'Hit by a falling hazard!';
        impact = true;
        ctx.playerInvuln = T.player.invulnSeconds;
        break;
      }
    }
    if (destroyedProj) compactProjectiles(ctx);

    if (!impact) {
      const half = CELL_SIZE / 2;
      for (const b of ctx.blocks) {
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
          ctx.playerInvuln = T.player.invulnSeconds;
          break;
        }
      }
    }
  }

  const mult = 1 - clamp01(protection?.damageReduction ?? 0);
  return { damage: damage * mult, cause, impact };
}

export function firePlayerWeapon(
  ctx: SimContext,
  origin: Vec3,
  dir: Vec3,
  weapon: WeaponDef,
): WeaponFireResult {
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
  if (!ctx.running) return { hit: false, hitPoint: defaultPoint, destroyedCount: 0 };

  let best: Projectile | null = null;
  let bestAlong = weapon.range;
  let bestPos: { x: number; y: number; z: number } | null = null;

  for (const proj of ctx.projectiles) {
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
    for (const proj of ctx.projectiles) {
      if (proj === best || proj.destroyed) continue;
      const pp = proj.body.translation();
      const d2 = (pp.x - bestPos.x) ** 2 + (pp.y - bestPos.y) ** 2 + (pp.z - bestPos.z) ** 2;
      if (d2 <= r2) targets.push(proj);
    }
  }

  const ev = ctx.events();
  let destroyedCount = 0;
  for (const target of targets) {
    const tp = target.body.translation();
    if (damageProjectile(ctx, target, weapon.damage)) {
      destroyedCount++;
      ev.onProjectileImpact?.(target.kind, tp.x, tp.y, tp.z);
    }
  }
  if (destroyedCount > 0) compactProjectiles(ctx);

  return { hit: true, hitPoint, destroyedCount };
}

/**
 * Applies `damage` to a projectile. Returns true when it was destroyed (mesh and body removed; the
 * caller compacts the list); otherwise the projectile shrinks and slows down.
 */
function damageProjectile(ctx: SimContext, proj: Projectile, damage: number): boolean {
  proj.hp -= damage;
  if (proj.hp <= 0) {
    proj.destroyed = true;
    ctx.effectsRoot?.remove(proj.mesh);
    ctx.world.removeRigidBody(proj.body);
    return true;
  }
  proj.mesh.scale.multiplyScalar(0.82);
  const v = proj.body.linvel();
  proj.body.setLinvel({ x: v.x * 0.7, y: v.y * 0.7, z: v.z * 0.7 }, true);
  return false;
}

export function spawnTargetedProjectile(
  ctx: SimContext,
  kind: ProjectileKind,
  sx: number,
  sy: number,
  sz: number,
  r: number,
  density: number,
  speed: number,
) {
  const b = ctx.spawnBox;
  let tx = (b.minX + b.maxX) * 0.5 + (ctx.rng() - 0.5) * 2;
  let ty = Math.max(1, b.top * 0.5);
  let tz = (b.minZ + b.maxZ) * 0.5 + (ctx.rng() - 0.5) * 2;
  if (ctx.blocks.length > 0) {
    const target = ctx.blocks[Math.floor(ctx.rng() * ctx.blocks.length)];
    if (target) {
      const tp = target.body.translation();
      tx = tp.x + (ctx.rng() - 0.5) * 1.2;
      ty = tp.y + (ctx.rng() - 0.5) * 0.8;
      tz = tp.z + (ctx.rng() - 0.5) * 1.2;
    }
  }
  const dx = tx - sx;
  const dy = ty - sy;
  const dz = tz - sz;
  const dist = Math.max(0.1, Math.hypot(dx, dy, dz));
  const flight = dist / speed;
  const vx = (dx / dist) * speed;
  const vz = (dz / dist) * speed;
  const vy = (dy / dist) * speed + 0.45 * ctx.gravity * flight;
  spawnProjectile(ctx, kind, sx, sy, sz, vx, vy, vz, r, density, speed, Math.hypot(vx, vz));
}

export function spawnProjectile(
  ctx: SimContext,
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
  const body = ctx.world.createRigidBody(
    ctx.R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(vx, vy, vz).setCcdEnabled(true),
  );
  ctx.world.createCollider(ctx.R.ColliderDesc.ball(r).setDensity(density).setRestitution(0.2), body);
  const mesh = new THREE.Mesh(ctx.projectileGeom, ctx.projectileMats[kind]);
  mesh.scale.setScalar(r);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  ctx.effectsRoot?.add(mesh);
  ctx.projectiles.push({
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

export function compactProjectiles(ctx: SimContext) {
  let write = 0;
  for (let i = 0; i < ctx.projectiles.length; i++) {
    const p = ctx.projectiles[i];
    if (p && !p.destroyed) ctx.projectiles[write++] = p;
  }
  ctx.projectiles.length = write;
}

export function updateProjectiles(ctx: SimContext) {
  // Report each projectile's first hit (its flight is suddenly slowed), and cull ones that fell off.
  const ev = ctx.events();
  let write = 0;
  for (let i = 0; i < ctx.projectiles.length; i++) {
    const s = ctx.projectiles[i];
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
      ctx.projectiles[write++] = s;
    } else {
      ctx.effectsRoot?.remove(s.mesh);
      ctx.world.removeRigidBody(s.body);
    }
  }
  ctx.projectiles.length = write;
}

export function updateLasers(ctx: SimContext) {
  if (ctx.lasers.length === 0) return;
  const range2 = T.laser.range * T.laser.range;
  const ev = ctx.events();
  let destroyedAny = false;
  for (const laser of ctx.lasers) {
    laser.cooldown = Math.max(0, laser.cooldown - T.step);
    if (laser.rec.fallen || laser.cooldown > 0) continue;
    const lp = laser.rec.body.translation();
    let best: Projectile | null = null;
    let bestDist2 = range2;
    let bestPos: { x: number; y: number; z: number } | null = null;
    for (const proj of ctx.projectiles) {
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
      if (damageProjectile(ctx, best, 1)) destroyedAny = true;
      laser.cooldown = T.laser.cooldown;
      ev.onLaserFire?.([lp.x, lp.y, lp.z], [bestPos.x, bestPos.y, bestPos.z]);
    }
  }
  if (destroyedAny) compactProjectiles(ctx);
}
