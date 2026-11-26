/**
 * 3D avatar and movement/firing controller for Player 2 (Co-op) and the AI Robo-Buddy.
 * Pure Three.js & headless-safe: no React or DOM imports.
 */
import * as THREE from 'three';
import type { Vec3 } from '../types/blueprint';
import { getIslandSize } from '../types/blueprint';
import type { WeaponDef } from '../types/gear';
import type { MultiplayerMode } from '../types/ui';
import { RoboAvatar, type RoboPalette } from './RoboAvatar';

export interface CompanionInput {
  moveX: number;
  moveY: number;
  jump: boolean;
  fire: boolean;
}

export const COMPANION_WEAPON: WeaponDef = {
  id: 'pebble_popper',
  slot: 'weapon',
  label: 'Robo Zapper',
  color: 0x38bdf8,
  cost: 0,
  damage: 1,
  range: 24,
  cooldown: 0.85,
  splashRadius: 0.8,
  description: 'Friendly companion zapper that blasts incoming hazards out of the sky!',
};

const P2_PALETTE: RoboPalette = { body: 0x0284c7, accent: 0x38bdf8, visorGlow: 0x38bdf8 };
const BOT_PALETTE: RoboPalette = { body: 0x10b981, accent: 0xfacc15, visorGlow: 0x34d399 };

const MOVE_SPEED = 7.5;
const JUMP_SPEED = 8.2;
const GRAVITY = 9.81 * 2.2;

const MAX_STEP_DT = 0.05;
const BOT_PATROL_RADIUS = 6.4;
const BOT_COOLDOWN = 1.05;
const COOP_COOLDOWN = 0.55;
const START_POS: Vec3 = [4.5, 0, 5.5];
const CHASE_BACK = 7.5;
const CHASE_UP = 3.6;
const CHASE_AHEAD = 4;
const CAM_TURN_SPEED = 2.4;

export class CompanionManager {
  readonly pos = new THREE.Vector3(...START_POS);
  vy = 0;
  yaw = Math.PI;
  /** Heading of Player 2's chase camera in split-screen; movement is relative to it. */
  camYaw = Math.atan2(START_POS[0], START_POS[2]);
  grounded = true;

  private fireCooldown = 0;
  private patrolAngle = 0.6;
  private animTime = 0;
  private mode: MultiplayerMode = 'solo';

  private readonly avatar = new RoboAvatar(P2_PALETTE);
  readonly group = this.avatar.group;

  constructor(private readonly scene: THREE.Scene) {
    this.syncTransform();
    this.scene.add(this.group);
  }

  setMode(mode: MultiplayerMode): void {
    const wasVisible = this.isVisibleMode(this.mode);
    const nextVisible = this.isVisibleMode(mode);
    this.mode = mode;
    this.group.visible = nextVisible;
    this.avatar.setPalette(mode === 'bot' ? BOT_PALETTE : P2_PALETTE);
    if (!wasVisible && nextVisible) {
      this.resetPosition();
    }
  }

  private isVisibleMode(mode: MultiplayerMode): boolean {
    return mode === 'coop' || mode === 'split' || mode === 'bot';
  }

  /**
   * Third-person chase camera for Player 2's split-screen viewport: behind and above the avatar,
   * looking slightly ahead of it along the camera heading `camYaw`.
   */
  getChaseCamera(): { eye: Vec3; target: Vec3 } {
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    return {
      eye: [this.pos.x - fx * CHASE_BACK, Math.max(0.6, this.pos.y + CHASE_UP), this.pos.z - fz * CHASE_BACK],
      target: [this.pos.x + fx * CHASE_AHEAD, this.pos.y + 1.2, this.pos.z + fz * CHASE_AHEAD],
    };
  }

  resetPosition(): void {
    this.pos.set(...START_POS);
    this.vy = 0;
    this.grounded = true;
    this.yaw = Math.PI;
    // Face the island centre so the chase camera starts looking at the village.
    this.camYaw = Math.atan2(START_POS[0], START_POS[2]);
    this.fireCooldown = 0;
    this.syncTransform();
  }

  update(
    dt: number,
    mode: MultiplayerMode,
    simulating: boolean,
    projectiles: readonly Vec3[],
    p2Input: CompanionInput,
    onFire: (muzzle: Vec3, dir: Vec3) => void,
    lookX = 0,
  ): void {
    if (mode !== this.mode) this.setMode(mode);
    if (!this.isVisibleMode(mode)) return;

    const stepDt = Math.min(Math.max(dt, 0), MAX_STEP_DT);
    this.fireCooldown = Math.max(0, this.fireCooldown - stepDt);
    let moving = false;

    if (mode === 'bot') {
      if (stepDt > 0) {
        this.patrolAngle += stepDt * 0.55;
        const targetX = Math.cos(this.patrolAngle) * BOT_PATROL_RADIUS;
        const targetZ = Math.sin(this.patrolAngle) * BOT_PATROL_RADIUS;
        const dx = targetX - this.pos.x;
        const dz = targetZ - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.05) {
          const step = Math.min(dist, MOVE_SPEED * 0.65 * stepDt);
          this.pos.x += (dx / dist) * step;
          this.pos.z += (dz / dist) * step;
          this.yaw = Math.atan2(-dx, -dz);
          moving = true;
        }
        if (this.grounded && Math.sin(this.patrolAngle * 4) > 0.985) {
          this.vy = JUMP_SPEED * 0.65;
          this.grounded = false;
        }
      }
      if (simulating && this.fireCooldown <= 0) {
        const target = this.nearestProjectile(projectiles, COMPANION_WEAPON.range);
        if (target) {
          this.fireAt(target, onFire);
          this.fireCooldown = BOT_COOLDOWN;
        }
      }
    } else {
      let mx = p2Input.moveX;
      let mz = -p2Input.moveY;
      if (mode === 'split') {
        // Split-screen: "up" means away from the P2 camera, so turn the stick into world space.
        this.camYaw -= lookX * CAM_TURN_SPEED * stepDt;
        const sin = Math.sin(this.camYaw);
        const cos = Math.cos(this.camYaw);
        const wx = mx * cos + mz * sin;
        const wz = mz * cos - mx * sin;
        mx = wx;
        mz = wz;
      }
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      if (stepDt > 0 && len > 0.05) {
        this.pos.x += mx * MOVE_SPEED * stepDt;
        this.pos.z += mz * MOVE_SPEED * stepDt;
        this.yaw = Math.atan2(-mx, -mz);
        moving = true;
      }
      if (p2Input.jump && this.grounded) {
        this.vy = JUMP_SPEED;
        this.grounded = false;
      }
      if (p2Input.fire && this.fireCooldown <= 0) {
        const target = this.nearestProjectile(projectiles, COMPANION_WEAPON.range);
        if (target) {
          this.fireAt(target, onFire);
        } else {
          const muzzle: Vec3 = [this.pos.x, this.pos.y + 1.35, this.pos.z];
          const dir: Vec3 = [-Math.sin(this.yaw), 0.18, -Math.cos(this.yaw)];
          const dLen = Math.hypot(dir[0], dir[1], dir[2]) || 1;
          onFire(muzzle, [dir[0] / dLen, dir[1] / dLen, dir[2] / dLen]);
        }
        this.fireCooldown = COOP_COOLDOWN;
      }
    }

    if (stepDt > 0) {
      this.pos.x = Math.max(-(getIslandSize() / 2 + 0.5), Math.min(getIslandSize() / 2 + 0.5, this.pos.x));
      this.pos.z = Math.max(-(getIslandSize() / 2 + 0.5), Math.min(getIslandSize() / 2 + 0.5, this.pos.z));
      if (!this.grounded || this.vy > 0) {
        this.vy -= GRAVITY * stepDt;
        this.pos.y += this.vy * stepDt;
        if (this.pos.y <= 0) {
          this.pos.y = 0;
          this.vy = 0;
          this.grounded = true;
        }
      }
      this.animTime += stepDt * (moving ? 9 : 2.5);
      const swing = moving ? Math.sin(this.animTime) * 0.45 : Math.sin(this.animTime) * 0.06;
      this.avatar.setSwing(swing);
    }

    this.syncTransform();
  }

  private nearestProjectile(projectiles: readonly Vec3[], maxRange: number): Vec3 | null {
    const mx = this.pos.x;
    const my = this.pos.y + 1.35;
    const mz = this.pos.z;
    let best: Vec3 | null = null;
    let bestDistSq = maxRange * maxRange;
    for (const p of projectiles) {
      const dx = p[0] - mx;
      const dy = p[1] - my;
      const dz = p[2] - mz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        best = p;
      }
    }
    return best;
  }

  private fireAt(target: Vec3, onFire: (muzzle: Vec3, dir: Vec3) => void): void {
    const muzzle: Vec3 = [this.pos.x, this.pos.y + 1.35, this.pos.z];
    const dx = target[0] - muzzle[0];
    const dy = target[1] - muzzle[1];
    const dz = target[2] - muzzle[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    this.yaw = Math.atan2(-dx, -dz);
    onFire(muzzle, [dx / len, dy / len, dz / len]);
  }

  private syncTransform(): void {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  dispose(): void {
    this.avatar.dispose();
  }
}
