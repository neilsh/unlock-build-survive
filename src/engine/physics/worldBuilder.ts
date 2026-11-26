import type { RigidBody } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { BlueprintGraph, StrutData, Vec3 } from '../../types/blueprint';
import { CELL_SIZE, blocksAtCorner, cellToWorld, cornerToWorld, key } from '../../types/blueprint';
import { getMaterialDef } from '../../types/materials';
import type { MeshRegistry } from '../BuildController';
import type { SimContext } from './context';
import { configureAxisSpring, isLinear } from './rapier';
import { registerHelper } from './helpers';
import { PHYSICS_TUNING } from './tuning';
import type { BlockRec, StrutEnd, StrutRec } from './types';

/** World construction: block bodies, spring links, foundation anchors and struts. */
const T = PHYSICS_TUNING;
const tmpV1 = new THREE.Vector3();

export function addBlocks(ctx: SimContext, graph: BlueprintGraph, meshes: MeshRegistry) {
  const byCell = new Map<string, BlockRec>();
  const h = (CELL_SIZE / 2) * T.colliderScale;
  for (const b of graph.blocks) {
    const mat = getMaterialDef(b.material, ctx.customMaterials);
    const centre = new THREE.Vector3(...cellToWorld(b.cell));
    const body = ctx.world.createRigidBody(
      ctx.R.RigidBodyDesc.dynamic().setTranslation(centre.x, centre.y, centre.z).setCanSleep(false),
    );
    const colDesc = ctx.R.ColliderDesc.cuboid(h, CELL_SIZE / 2, h)
      .setDensity(mat.density)
      .setFriction(0.8);
    if (ctx.blockRestitution !== null) {
      colDesc
        .setRestitution(ctx.blockRestitution)
        .setRestitutionCombineRule(ctx.R.CoefficientCombineRule.Max);
    }
    const col = ctx.world.createCollider(colDesc, body);
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
    ctx.blocks.push(rec);
    byCell.set(key(b.cell), rec);
    if (mat.special === 'shield') {
      ctx.shieldBlocks.push(rec);
      if (ctx.effectsRoot) {
        const dome = new THREE.Mesh(ctx.shieldGeom, ctx.shieldMat);
        dome.position.copy(centre);
        ctx.effectsRoot.add(dome);
        ctx.shieldDomes.push({ rec, mesh: dome });
      }
    } else if (mat.special === 'laser') {
      ctx.lasers.push({ rec, cooldown: 0 });
    } else if (mat.special === 'beaver' || mat.special === 'owl' || mat.special === 'spider') {
      registerHelper(ctx, rec, mat.special);
    }
  }

  const at = (c: Vec3) => byCell.get(key(c));
  const shielded = (c: Vec3) => (at(c) ? 0.25 : 1);
  for (const rec of ctx.blocks) {
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
      if (other) addBlockLink(ctx, rec, other, d);
    }
    if (cy === 0) addAnchor(ctx, rec);
  }
  return byCell;
}

/** 6-DOF spring joint; joint axes line up with world axes because every body starts unrotated. */
export function createSpring(
  ctx: SimContext,
  b1: RigidBody,
  l1: THREE.Vector3,
  b2: RigidBody,
  l2: THREE.Vector3,
  stiffness: number,
  toGround: boolean,
) {
  // Locking LinX only to create the joint; the mask is cleared below so all six axes are springs.
  const data = ctx.R.JointData.generic(l1, l2, { x: 1, y: 0, z: 0 }, ctx.R.JointAxesMask.LinX);
  data.axesMask = ctx.R.JointAxesMask.LinX & ctx.R.JointAxesMask.LinY;
  const joint = ctx.world.createImpulseJoint(data, b1, b2, true);
  joint.setContactsEnabled(toGround);
  const A = ctx.R.JointAxis;
  const axes = [A.LinX, A.LinY, A.LinZ, A.AngX, A.AngY, A.AngZ];
  for (const axis of axes) {
    const k = (isLinear(ctx.R, axis) ? T.linkLinStiffness : T.linkAngStiffness) * stiffness;
    configureAxisSpring(
      ctx.R,
      ctx.world.impulseJoints,
      joint,
      axis,
      0,
      k,
      2 * T.linkDampingRatio * Math.sqrt(k),
    );
  }
  return joint;
}

export function startsNearShield(ctx: SimContext, blocks: BlockRec[]): boolean {
  if (ctx.shieldBlocks.length === 0) return false;
  const r2 = T.shield.radius * T.shield.radius;
  for (const s of ctx.shieldBlocks) {
    for (const b of blocks) {
      if (s.start.distanceToSquared(b.start) <= r2) return true;
    }
  }
  return false;
}

export function addBlockLink(ctx: SimContext, a: BlockRec, b: BlockRec, dir: Vec3) {
  const hc = CELL_SIZE / 2;
  const l1 = new THREE.Vector3(dir[0] * hc, dir[1] * hc, dir[2] * hc);
  const l2 = l1.clone().negate();
  const ma = getMaterialDef(a.data.material, ctx.customMaterials);
  const mb = getMaterialDef(b.data.material, ctx.customMaterials);
  const boost = startsNearShield(ctx, [a, b]) ? T.shield.stiffnessMultiplier : 1;
  const joint = createSpring(
    ctx,
    a.body,
    l1,
    b.body,
    l2,
    Math.min(ma.stiffness, mb.stiffness) * boost,
    false,
  );
  ctx.links.push({
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

export function addAnchor(ctx: SimContext, rec: BlockRec) {
  const p = rec.body.translation();
  const l1 = new THREE.Vector3(p.x, p.y - CELL_SIZE / 2, p.z); // the island body sits at the origin
  const l2 = new THREE.Vector3(0, -CELL_SIZE / 2, 0);
  const mat = getMaterialDef(rec.data.material, ctx.customMaterials);
  const boost = startsNearShield(ctx, [rec]) ? T.shield.stiffnessMultiplier : 1;
  const joint = createSpring(ctx, ctx.ground, l1, rec.body, l2, mat.stiffness * boost, true);
  ctx.links.push({
    id: rec.data.id,
    kind: 'anchor',
    joint,
    body1: ctx.ground,
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

export function strutEnd(
  ctx: SimContext,
  graph: BlueprintGraph,
  k: Vec3,
  byCell: Map<string, BlockRec>,
): StrutEnd | null {
  const w = new THREE.Vector3(...cornerToWorld(k));
  const owner = blocksAtCorner(graph, k)[0];
  const rec = owner ? byCell.get(key(owner.cell)) : undefined;
  if (rec) {
    const t = rec.body.translation();
    return { body: rec.body, local: w.sub(tmpV1.set(t.x, t.y, t.z)), rec };
  }
  if (k[1] === 0) return { body: ctx.ground, local: w, rec: null };
  return null;
}

export function addStrut(
  ctx: SimContext,
  graph: BlueprintGraph,
  s: StrutData,
  meshes: MeshRegistry,
  byCell: Map<string, BlockRec>,
) {
  const mesh = meshes.struts.get(s.id);
  const initA = new THREE.Vector3(...cornerToWorld(s.a));
  const initB = new THREE.Vector3(...cornerToWorld(s.b));
  const endA = strutEnd(ctx, graph, s.a, byCell);
  const endB = strutEnd(ctx, graph, s.b, byCell);
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
  ctx.struts.push(rec);
  // Both ends on one body (or an invalid end): the strut just rides along, it carries no load.
  if (!endA || !endB || endA.body === endB.body) return;

  const rest = initA.distanceTo(initB);
  const mat = getMaterialDef(s.material, ctx.customMaterials);
  const attached = [endA.rec, endB.rec].filter((r) => r !== null);
  const boost = startsNearShield(ctx, attached) ? T.shield.stiffnessMultiplier : 1;
  const k = T.strutStiffness * mat.stiffness * boost;
  const damping = 2 * T.strutDampingRatio * Math.sqrt(k);
  const joint = ctx.world.createImpulseJoint(
    ctx.R.JointData.spring(rest, k, damping, endA.local, endB.local),
    endA.body,
    endB.body,
    true,
  );
  joint.setContactsEnabled(false);
  // Same spring, but acceleration-based like the block links (mass-independent, stable).
  configureAxisSpring(ctx.R, ctx.world.impulseJoints, joint, ctx.R.JointAxis.LinX, rest, k, damping);
  ctx.links.push({
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
