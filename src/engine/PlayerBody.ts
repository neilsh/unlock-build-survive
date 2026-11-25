/**
 * Visible body for Player 1 in 2P split-screen. It lives on its own render layer so Player 1's
 * first-person camera never sees it, while Player 2's camera does.
 * Pure Three.js & headless-safe.
 */
import type { Scene } from 'three';
import type { Vec3 } from '../types/blueprint';
import { RoboAvatar } from './RoboAvatar';

/** Render layer that only Player 2's camera draws. */
export const P1_BODY_LAYER = 1;

const P1_PALETTE = { body: 0xe11d48, accent: 0xfb923c, visorGlow: 0xfb923c };

export class PlayerBody {
  private readonly avatar = new RoboAvatar(P1_PALETTE);
  readonly group = this.avatar.group;
  private animTime = 0;
  private last: Vec3 | null = null;

  constructor(private readonly scene: Scene) {
    this.avatar.setLayer(P1_BODY_LAYER);
    this.scene.add(this.group);
  }

  /** Syncs the body to Player 1's feet position and yaw; shown only while `visible`. */
  update(dt: number, visible: boolean, feet: Vec3, yaw: number): void {
    this.group.visible = visible;
    if (!visible) {
      this.last = null;
      return;
    }
    const moved = this.last ? Math.hypot(feet[0] - this.last[0], feet[2] - this.last[2]) : 0;
    this.last = feet;
    const speed = dt > 0 ? moved / dt : 0;
    const moving = speed > 0.5;
    this.animTime += dt * (moving ? 9 : 2.5);
    this.avatar.setSwing(Math.sin(this.animTime) * (moving ? 0.45 : 0.06));
    this.group.position.set(feet[0], feet[1], feet[2]);
    this.group.rotation.y = yaw;
  }

  dispose(): void {
    this.avatar.dispose();
  }
}
