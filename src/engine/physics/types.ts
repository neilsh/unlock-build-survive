import type { ImpulseJoint, RigidBody } from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';
import type { BlockData, StrutData, Vec3 } from '../../types/blueprint';
import type { HelperKind } from '../../types/materials';
import type { PieceHandle } from '../InstancedPieces';

export interface BlockRec {
  data: BlockData;
  body: RigidBody;
  mesh: PieceHandle | undefined;
  /** Mesh pose relative to the body, captured at start (keeps us agnostic of mesh conventions). */
  meshOffsetPos: THREE.Vector3;
  meshOffsetQuat: THREE.Quaternion;
  mass: number;
  buoyancy: number;
  /** Open area per horizontal face +x, -x, +z, -z (1 = open, 0.25 = shielded by a neighbour). */
  exposure: [number, number, number, number];
  strain: number;
  /** Centre at start, for the standing check. */
  start: THREE.Vector3;
  /** Sticky: set once the block loses its last intact link or drifts too far. */
  fallen: boolean;
}

export interface StrutEnd {
  body: RigidBody;
  local: THREE.Vector3;
  rec: BlockRec | null;
}

export interface StrutRec {
  data: StrutData;
  mesh: PieceHandle | undefined;
  initA: THREE.Vector3;
  initB: THREE.Vector3;
  /** Mesh pose at start; after breaking, relative to the debris body instead. */
  meshPos: THREE.Vector3;
  meshQuat: THREE.Quaternion;
  endA: StrutEnd | null;
  endB: StrutEnd | null;
  debris: RigidBody | null;
  strain: number;
  /** Sticky: set once the strut breaks or either block it is attached to falls. */
  fallen: boolean;
}

export interface Link {
  /** Id reported on break. */
  id: string;
  kind: 'face' | 'anchor' | 'strut';
  joint: ImpulseJoint | null;
  body1: RigidBody;
  body2: RigidBody;
  local1: THREE.Vector3;
  local2: THREE.Vector3;
  /** Rest length (struts only). */
  rest: number;
  /** Stretch (world units) at which the link breaks. */
  limit: number;
  blocks: BlockRec[];
  strut: StrutRec | null;
  strain: number;
  broken: boolean;
}

export interface LaserEntry {
  rec: BlockRec;
  cooldown: number;
}

export interface HelperEntry {
  kind: HelperKind;
  rec: BlockRec;
  cooldown: number;
}

/** Live pose of an animal-helper block, for drawing its critter on top. */
export interface HelperPose {
  id: string;
  kind: HelperKind;
  pos: Vec3;
  fallen: boolean;
}

export interface ShieldDome {
  rec: BlockRec;
  mesh: THREE.Mesh;
}
