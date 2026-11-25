import type { RigidBody } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CELL_SIZE } from '../../types/blueprint';
import { getMaterialDef } from '../../types/materials';
import type { SimContext } from './context';
import { PHYSICS_TUNING, tint } from './tuning';
import type { BlockRec, Link, StrutRec } from './types';

/** Strain measurement, joint breaking, strut debris, standing score and mesh sync. */
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

function worldPoint(body: RigidBody, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const r = body.rotation();
  const t = body.translation();
  tmpWpQ.set(r.x, r.y, r.z, r.w);
  out.copy(local).applyQuaternion(tmpWpQ);
  out.x += t.x;
  out.y += t.y;
  out.z += t.z;
  return out;
}

function linkStretch(l: Link): number {
  const p1 = worldPoint(l.body1, l.local1, tmpP1);
  const p2 = worldPoint(l.body2, l.local2, tmpP2);
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

export function isProtectedByShield(
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

export function measureAndBreak(ctx: SimContext) {
  for (const b of ctx.blocks) b.strain = 0;
  for (const s of ctx.struts) s.strain = 0;
  const activeShieldPos: Array<{ x: number; y: number; z: number }> = [];
  for (const s of ctx.shieldBlocks) {
    if (!s.fallen) activeShieldPos.push(s.body.translation());
  }
  const r2 = T.shield.radius * T.shield.radius;
  for (const l of ctx.links) {
    if (l.broken) continue;
    const limit =
      activeShieldPos.length > 0 && isProtectedByShield(l, activeShieldPos, r2)
        ? l.limit * T.shield.stressMultiplier
        : l.limit;
    l.strain = linkStretch(l) / limit;
    if (l.strain > ctx.peakStrain) {
      ctx.peakStrain = l.strain;
      ctx.peakStrainId = l.id;
    }
    if (l.strain > 1) {
      breakLink(ctx, l);
      continue;
    }
    for (const b of l.blocks) b.strain = Math.max(b.strain, l.strain);
    if (l.strut) l.strut.strain = l.strain;
  }
}

export function breakLink(ctx: SimContext, l: Link) {
  l.broken = true;
  l.strain = 0;
  if (l.joint) ctx.world.removeImpulseJoint(l.joint, true);
  l.joint = null;
  ctx.brokenCount++;
  ctx.firstBrokenId ??= l.id;
  ctx.linksDirty = true;
  if (l.strut) makeDebris(ctx, l.strut);
  ctx.events().onJointBreak?.(l.id);
}

/** A broken strut becomes a free-falling stick. */
export function makeDebris(ctx: SimContext, s: StrutRec) {
  strutEndsInto(s, tmpV1, tmpV2);
  strutMeshPoseInto(s, tmpV1, tmpV2, tmpPos, tmpQuat);
  const mid = tmpV1.clone().add(tmpV2).multiplyScalar(0.5);
  const dir = tmpV2.clone().sub(tmpV1);
  const len = Math.max(0.4, dir.length());
  const rot = new THREE.Quaternion().setFromUnitVectors(UP_UNIT, dir.normalize());
  const body = ctx.world.createRigidBody(
    ctx.R.RigidBodyDesc.dynamic()
      .setTranslation(mid.x, mid.y, mid.z)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }),
  );
  ctx.world.createCollider(
    ctx.R.ColliderDesc.capsule(len / 2 - 0.15, 0.15).setDensity(
      getMaterialDef(s.data.material, ctx.customMaterials).density,
    ),
    body,
  );
  s.debris = body;
  // From now on the mesh pose is stored relative to the debris body.
  const inv = rot.clone().invert();
  s.meshPos = tmpPos.clone().sub(mid).applyQuaternion(inv);
  s.meshQuat = inv.multiply(tmpQuat);
}

export function strutEndsInto(s: StrutRec, outA: THREE.Vector3, outB: THREE.Vector3): void {
  if (s.endA) worldPoint(s.endA.body, s.endA.local, outA);
  else outA.copy(s.initA);
  if (s.endB) worldPoint(s.endB.body, s.endB.local, outB);
  else outB.copy(s.initB);
}

/** Mesh pose that maps the blueprint segment initA-initB onto the current segment a-b. */
function strutMeshPoseInto(
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

/** Marks pieces that came loose or drifted away as fallen and refreshes standingRatio. */
export function updateStanding(ctx: SimContext) {
  if (ctx.linksDirty) {
    ctx.linksDirty = false;
    const held = new Set<BlockRec>();
    for (const l of ctx.links) if (!l.broken) for (const b of l.blocks) held.add(b);
    for (const b of ctx.blocks) if (!held.has(b)) b.fallen = true;
  }
  const g = ctx.ground.translation();
  const tol2 = T.standing.tolerance ** 2;
  for (const b of ctx.blocks) {
    if (b.fallen) continue;
    const p = b.body.translation();
    const drift2 = (p.x - g.x - b.start.x) ** 2 + (p.y - g.y - b.start.y) ** 2 + (p.z - g.z - b.start.z) ** 2;
    if (drift2 > tol2) b.fallen = true;
  }
  for (const s of ctx.struts) {
    if (s.fallen) continue;
    if (s.debris || s.endA?.rec?.fallen || s.endB?.rec?.fallen) s.fallen = true;
  }
  const total = ctx.blocks.length + ctx.struts.length;
  let fallen = 0;
  for (const b of ctx.blocks) if (b.fallen) fallen++;
  for (const s of ctx.struts) if (s.fallen) fallen++;
  ctx.standingRatio = total === 0 ? 1 : (total - fallen) / total;
}

export function syncMeshes(ctx: SimContext) {
  for (const b of ctx.blocks) {
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
  for (const s of ctx.struts) {
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
      strutEndsInto(s, tmpV1, tmpV2);
      strutMeshPoseInto(s, tmpV1, tmpV2, s.mesh.position, s.mesh.quaternion);
    }
    tint(s.mesh, s.strain);
  }
  for (const p of ctx.projectiles) {
    const t = p.body.translation();
    const r = p.body.rotation();
    p.mesh.position.set(t.x, t.y, t.z);
    p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
  for (const d of ctx.shieldDomes) {
    d.mesh.visible = !d.rec.fallen;
    const t = d.rec.body.translation();
    d.mesh.position.set(t.x, t.y, t.z);
  }
}
