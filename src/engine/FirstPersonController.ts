/**
 * First-person player & camera controller for walking inside the village on the island.
 * Headless-safe: works without a DOM/window in Vitest unit tests.
 */
import * as THREE from 'three';
import type { Vec3 } from '../types/blueprint';
import { CELL_SIZE, getIslandSize } from '../types/blueprint';

export const PLAYER_RADIUS = 0.45;
export const PLAYER_HEIGHT = 1.75;
export const EYE_HEIGHT = 1.55;
const MOVE_SPEED = 7.5;
const JUMP_SPEED = 8.2;

const HALF_BLOCK = CELL_SIZE / 2;
const LOOK_SENSITIVITY = 0.004;
const MAX_PITCH = Math.PI / 2 - 0.08;
const MAX_STEP_DT = 0.05;
const CLIMB_SPEED = 4.5;

const cellKey = ([x, y, z]: Vec3): string => `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;

const SPAWN_CANDIDATES: readonly Vec3[] = [
  [0, 0, 6.2],
  [6.2, 0, 0],
  [-6.2, 0, 0],
  [0, 0, -6.2],
  [6.5, 0, 6.5],
  [-6.5, 0, 6.5],
  [0, 0, 8.2],
];

function isTextInput(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export class FirstPersonController {
  readonly pos = new THREE.Vector3(0, 0, 6.2);
  vy = 0;
  yaw = 0;
  pitch = -0.08;
  grounded = true;
  private lookSensitivity = 1;
  private invertLook = false;
  /** True while the player is inside a ladder block and holding on to it. */
  climbing = false;

  private enabled = false;
  private paused = false;
  private arrowKeysEnabled = true;
  private readonly keys = new Set<string>();
  private dragPointerId: number | null = null;
  private lastPointer = { x: 0, y: 0 };
  private dragStart = { x: 0, y: 0 };
  private dragMoved = 0;
  private gpStrafe = 0;
  private gpForward = 0;
  private gpJump = false;
  private fireHandler: ((source: 'click' | 'key') => void) | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement | null = null,
  ) {
    if (typeof window !== 'undefined') {
      const onKeyDown = (e: KeyboardEvent) => {
        if (!this.enabled || this.paused || isTextInput(e.target)) return;
        if (
          e.code === 'Space' ||
          e.code === 'ArrowUp' ||
          e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight'
        ) {
          e.preventDefault();
        }
        if ((e.code === 'KeyF' || e.code === 'KeyE') && !e.repeat) {
          this.fireHandler?.('key');
        }
        this.keys.add(e.code);
      };
      const onKeyUp = (e: KeyboardEvent) => {
        this.keys.delete(e.code);
      };
      const onBlur = () => {
        this.clearInputState();
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      this.cleanups.push(
        () => window.removeEventListener('keydown', onKeyDown),
        () => window.removeEventListener('keyup', onKeyUp),
        () => window.removeEventListener('blur', onBlur),
      );
    }

    if (dom && typeof dom.addEventListener === 'function') {
      const onPointerDown = (e: PointerEvent) => {
        // Ignore extra fingers while one is already dragging (the joystick is a separate DOM overlay, so
        // the look finger is not the "primary" pointer on touch screens).
        if (!this.enabled || this.paused || this.dragPointerId !== null || e.button !== 0) return;
        this.dragPointerId = e.pointerId;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.dragMoved = 0;
        dom.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!this.enabled || this.paused || this.dragPointerId !== e.pointerId) return;
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.dragMoved = Math.max(
          this.dragMoved,
          Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y),
        );
        this.lookDelta(dx, dy);
      };
      const endDrag = (e: PointerEvent) => {
        if (this.dragPointerId !== e.pointerId) return;
        const quickClick = e.type === 'pointerup' && this.enabled && !this.paused && this.dragMoved < 6;
        this.releaseDragCapture();
        if (quickClick) this.fireHandler?.('click');
      };
      dom.addEventListener('pointerdown', onPointerDown);
      dom.addEventListener('pointermove', onPointerMove);
      dom.addEventListener('pointerup', endDrag);
      dom.addEventListener('pointercancel', endDrag);
      this.cleanups.push(
        () => dom.removeEventListener('pointerdown', onPointerDown),
        () => dom.removeEventListener('pointermove', onPointerMove),
        () => dom.removeEventListener('pointerup', endDrag),
        () => dom.removeEventListener('pointercancel', endDrag),
      );
    }
  }

  private releaseDragCapture(): void {
    const id = this.dragPointerId;
    this.dragPointerId = null;
    if (this.dom && id !== null && this.dom.hasPointerCapture?.(id)) {
      this.dom.releasePointerCapture(id);
    }
  }

  private clearInputState(): void {
    this.keys.clear();
    this.gpStrafe = 0;
    this.gpForward = 0;
    this.gpJump = false;
    this.releaseDragCapture();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.clearInputState();
    } else {
      this.syncCamera();
    }
  }

  /** Player look preferences: speed multiplier (1 = default) and up/down inversion. */
  setLookOptions(sensitivity: number, invert: boolean): void {
    this.lookSensitivity = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1;
    this.invertLook = invert;
  }

  /** Pauses keyboard and pointer drag input (e.g. while an overlay modal is open). */
  setInputPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.clearInputState();
  }

  /** Enables or disables Arrow key movement (disabled in 2P Co-op so Player 2 can use Arrows). */
  setArrowKeysEnabled(on: boolean): void {
    this.arrowKeysEnabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Programmatic key helper (useful for headless tests). */
  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  lookDelta(dx: number, dy: number): void {
    this.lookAngles(dx * LOOK_SENSITIVITY, dy * LOOK_SENSITIVITY);
  }

  /** Updates view yaw and pitch by radian deltas, clamping pitch and syncing camera if enabled. */
  lookAngles(dYaw: number, dPitch: number): void {
    this.yaw -= dYaw * this.lookSensitivity;
    const pitchDelta = dPitch * this.lookSensitivity * (this.invertLook ? -1 : 1);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - pitchDelta));
    if (this.enabled) this.syncCamera();
  }

  /** Supplies continuous analog gamepad movement (-1..1) and jump state for the next update tick. */
  setGamepadInput(strafe: number, forward: number, jump: boolean): void {
    this.gpStrafe = strafe;
    this.gpForward = forward;
    this.gpJump = jump;
  }

  /** Places the player at a clear spot on the island facing the village center. */
  spawn(blocks: readonly Vec3[]): void {
    let chosen: Vec3 = SPAWN_CANDIDATES[SPAWN_CANDIDATES.length - 1] ?? [0, 0, 8.2];
    for (const c of SPAWN_CANDIDATES) {
      const blocked = blocks.some(
        ([bx, by, bz]) =>
          by - HALF_BLOCK < PLAYER_HEIGHT &&
          by + HALF_BLOCK > 0 &&
          Math.abs(c[0] - bx) < HALF_BLOCK + PLAYER_RADIUS &&
          Math.abs(c[2] - bz) < HALF_BLOCK + PLAYER_RADIUS,
      );
      if (!blocked) {
        chosen = c;
        break;
      }
    }
    this.pos.set(chosen[0], chosen[1], chosen[2]);
    this.vy = 0;
    this.grounded = true;
    this.yaw = Math.atan2(this.pos.x, this.pos.z);
    this.pitch = -0.08;
    this.syncCamera();
  }

  setFireHandler(handler: ((source: 'click' | 'key') => void) | null): void {
    this.fireHandler = handler;
  }

  getFeetPosition(): Vec3 {
    return [this.pos.x, this.pos.y, this.pos.z];
  }

  getEyePosition(): Vec3 {
    return [this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z];
  }

  getLookDirection(): Vec3 {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  update(
    dt: number,
    blockCenters: readonly Vec3[],
    gravity = 9.81,
    jumpMultiplier = 1,
    speedMultiplier = 1,
    ladderCenters: readonly Vec3[] = [],
  ): void {
    if (!this.enabled) return;
    const stepDt = Math.min(Math.max(dt, 0), MAX_STEP_DT);
    if (stepDt <= 0) {
      this.syncCamera();
      return;
    }

    const kFwd =
      (this.keys.has('KeyW') || (this.arrowKeysEnabled && this.keys.has('ArrowUp')) ? 1 : 0) -
      (this.keys.has('KeyS') || (this.arrowKeysEnabled && this.keys.has('ArrowDown')) ? 1 : 0);
    const kStrafe =
      (this.keys.has('KeyD') || (this.arrowKeysEnabled && this.keys.has('ArrowRight')) ? 1 : 0) -
      (this.keys.has('KeyA') || (this.arrowKeysEnabled && this.keys.has('ArrowLeft')) ? 1 : 0);
    const fwd = Math.max(-1, Math.min(1, kFwd + this.gpForward));
    const strafe = Math.max(-1, Math.min(1, kStrafe + this.gpStrafe));

    // On a ladder, W/S climb instead of walking, so forward input must not carry the player through it.
    const walkFwd = this.climbing ? 0 : fwd;
    if (walkFwd !== 0 || strafe !== 0) {
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      let mx = fx * walkFwd + rx * strafe;
      let mz = fz * walkFwd + rz * strafe;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      this.pos.x += mx * MOVE_SPEED * speedMultiplier * stepDt;
      this.pos.z += mz * MOVE_SPEED * speedMultiplier * stepDt;
    }

    // Ladders are walk-through: skip them in the horizontal push-out (they still act as floors below).
    const ladderKeys = new Set(ladderCenters.map(cellKey));

    // Horizontal AABB push-out against blocks overlapping the player's vertical span.
    for (const center of blockCenters) {
      if (ladderKeys.size > 0 && ladderKeys.has(cellKey(center))) continue;
      const [bx, by, bz] = center;
      if (this.pos.y + PLAYER_HEIGHT - 0.1 <= by - HALF_BLOCK || this.pos.y + 0.1 >= by + HALF_BLOCK) {
        continue;
      }
      const dx = this.pos.x - bx;
      const dz = this.pos.z - bz;
      const limit = HALF_BLOCK + PLAYER_RADIUS;
      const ox = limit - Math.abs(dx);
      const oz = limit - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) this.pos.x += (dx >= 0 ? 1 : -1) * ox;
        else this.pos.z += (dz >= 0 ? 1 : -1) * oz;
      }
    }

    if ((this.keys.has('Space') || this.gpJump) && this.grounded) {
      this.vy = JUMP_SPEED * jumpMultiplier;
      this.grounded = false;
    }

    // Climb while the player's body overlaps a ladder cell: W/Up climbs, S/Down descends, otherwise hold.
    const ladderReach = HALF_BLOCK + PLAYER_RADIUS * 0.5;
    const wasClimbing = this.climbing;
    this.climbing = ladderCenters.some(
      ([bx, by, bz]) =>
        Math.abs(this.pos.x - bx) < ladderReach &&
        Math.abs(this.pos.z - bz) < ladderReach &&
        this.pos.y + 0.05 < by + HALF_BLOCK &&
        this.pos.y + PLAYER_HEIGHT > by - HALF_BLOCK,
    );
    const jumping = this.keys.has('Space') || this.gpJump;
    if (this.climbing && wasClimbing && jumping) {
      // Hop off the ladder with a small kick.
      this.vy = JUMP_SPEED * 0.6 * jumpMultiplier;
      this.climbing = false;
    }

    const prevY = this.pos.y;
    if (this.climbing) {
      this.vy = fwd * CLIMB_SPEED * speedMultiplier;
    } else {
      this.vy -= gravity * stepDt;
    }
    this.pos.y += this.vy * stepDt;
    this.grounded = false;

    if (
      Math.abs(this.pos.x) <= getIslandSize() / 2 + 1.0 &&
      Math.abs(this.pos.z) <= getIslandSize() / 2 + 1.0 &&
      this.pos.y <= 0 &&
      prevY >= -0.35
    ) {
      this.pos.y = 0;
      this.vy = 0;
      this.grounded = true;
    }

    const footFootprint = HALF_BLOCK + PLAYER_RADIUS * 0.85;
    for (const [bx, by, bz] of blockCenters) {
      if (Math.abs(this.pos.x - bx) >= footFootprint || Math.abs(this.pos.z - bz) >= footFootprint) {
        continue;
      }
      const top = by + HALF_BLOCK;
      const bottom = by - HALF_BLOCK;
      if (this.vy <= 0 && prevY >= top - 0.35 && this.pos.y <= top) {
        this.pos.y = top;
        this.vy = 0;
        this.grounded = true;
      } else if (
        !ladderKeys.has(cellKey([bx, by, bz])) &&
        this.vy > 0 &&
        prevY + PLAYER_HEIGHT <= bottom + 0.35 &&
        this.pos.y + PLAYER_HEIGHT >= bottom
      ) {
        this.pos.y = bottom - PLAYER_HEIGHT;
        this.vy = 0;
      }
    }

    this.syncCamera();
  }

  syncCamera(): void {
    this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  dispose(): void {
    this.setEnabled(false);
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
  }
}
