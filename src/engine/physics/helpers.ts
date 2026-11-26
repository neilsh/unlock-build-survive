import type { Vec3 } from '../../types/blueprint';
import { CELL_SIZE } from '../../types/blueprint';
import type { HelperKind } from '../../types/materials';
import { compactProjectiles, damageProjectile } from './combat';
import type { SimContext } from './context';
import type { Projectile } from './projectiles';
import { PHYSICS_TUNING } from './tuning';
import type { BlockRec, HelperPose } from './types';

/**
 * Animal-helper blocks (beaver, owl, spider). All behaviour is deterministic: no RNG, only fixed-step
 * cooldowns, so builds without helper blocks simulate bit-for-bit as before.
 *  - Beaver: dams the flood, shrinking the current's push on nearby blocks (see `beaverShelter`).
 *  - Owl: swats the closest airborne hazard in range, like a short-range, slower laser.
 *  - Spider: webs nearby joints so they tolerate more stretch (applied in strain.ts).
 */
const T = PHYSICS_TUNING;

export function registerHelper(ctx: SimContext, rec: BlockRec, kind: HelperKind) {
  let same = 0;
  for (const h of ctx.helpers) if (h.kind === kind) same++;
  if (same >= T.helpers.maxPerKind) return;
  ctx.helpers.push({ kind, rec, cooldown: 0 });
}

/** Positions of the helpers of `kind` whose block is still standing. */
export function helperPositions(
  ctx: SimContext,
  kind: HelperKind,
): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (const h of ctx.helpers) if (h.kind === kind && !h.rec.fallen) out.push(h.rec.body.translation());
  return out;
}

/** Multiplier (<= 1) on the flood current pushing a block at (x, z): beavers shelter blocks near them. */
export function beaverShelter(ctx: SimContext, x: number, z: number): number {
  if (ctx.helpers.length === 0) return 1;
  const b = T.helpers.beaver;
  const r2 = b.radius * b.radius;
  for (const h of ctx.helpers) {
    if (h.kind !== 'beaver' || h.rec.fallen) continue;
    const p = h.rec.body.translation();
    if ((p.x - x) ** 2 + (p.z - z) ** 2 <= r2) return b.currentMultiplier;
  }
  return 1;
}

export function helperPoses(ctx: SimContext): HelperPose[] {
  return ctx.helpers.map((h) => {
    const p = h.rec.body.translation();
    return { id: h.rec.data.id, kind: h.kind, pos: [p.x, p.y, p.z] as Vec3, fallen: h.rec.fallen };
  });
}

export function updateHelpers(ctx: SimContext) {
  if (ctx.helpers.length === 0) return;
  const ev = ctx.events();
  let destroyedAny = false;
  for (const h of ctx.helpers) {
    h.cooldown = Math.max(0, h.cooldown - T.step);
    if (h.rec.fallen || h.cooldown > 0) continue;
    const p = h.rec.body.translation();
    const at: Vec3 = [p.x, p.y, p.z];
    if (h.kind === 'owl') {
      const range2 = T.helpers.owl.range ** 2;
      let best: Projectile | null = null;
      let bestD2 = range2;
      for (const proj of ctx.projectiles) {
        if (proj.destroyed || proj.landed) continue;
        const pp = proj.body.translation();
        const d2 = (pp.x - p.x) ** 2 + (pp.y - p.y) ** 2 + (pp.z - p.z) ** 2;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = proj;
        }
      }
      if (!best) continue;
      const tp = best.body.translation();
      const target: Vec3 = [tp.x, tp.y, tp.z];
      if (damageProjectile(ctx, best, 1)) {
        destroyedAny = true;
        ev.onProjectileImpact?.(best.kind, target[0], target[1], target[2]);
      }
      h.cooldown = T.helpers.owl.cooldown;
      ev.onHelperAction?.(h.rec.data.id, 'owl', at, target);
    } else if (h.kind === 'beaver') {
      // The beaver only gets busy once the water reaches its lodge.
      if (ctx.waterLevel <= p.y - CELL_SIZE / 2) continue;
      h.cooldown = T.helpers.beaver.splashEvery;
      ev.onHelperAction?.(h.rec.data.id, 'beaver', at, null);
    } else {
      const r2 = T.helpers.spider.radius ** 2;
      const stressed = ctx.blocks.some((b) => {
        if (b.strain <= T.helpers.spider.pulseStrain) return false;
        const bp = b.body.translation();
        return (bp.x - p.x) ** 2 + (bp.y - p.y) ** 2 + (bp.z - p.z) ** 2 <= r2;
      });
      if (!stressed) continue;
      h.cooldown = T.helpers.spider.pulseEvery;
      ev.onHelperAction?.(h.rec.data.id, 'spider', at, null);
    }
  }
  if (destroyedAny) compactProjectiles(ctx);
}
