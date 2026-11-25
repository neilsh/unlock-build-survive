/**
 * Player 2's own health and builder in 2P split-screen: separate HP/KO, and a separate tool + material
 * that place or erase blocks through P2's camera crosshair. Player 1's state is never touched here.
 */
import type { PerspectiveCamera } from 'three';
import { levelStore } from '../../levels/levelStore';
import { uiStore } from '../../state/store';
import type { MaterialType, ToolType } from '../../types/blueprint';
import type { AudioSynth } from '../AudioSynth';
import type { BuildController } from '../BuildController';
import type { CompanionManager } from '../CompanionManager';
import type { PhysicsSim } from '../PhysicsSim';
import { PHYSICS_TUNING } from '../physics/tuning';
import type { P2Action } from './InputRouter';
import { buildMaterialPool, isCreativeSandbox } from './modeRules';

export const P2_TOOLS: readonly ToolType[] = ['block', 'brace', 'paint', 'erase'];

export interface P2Deps {
  audio: Pick<AudioSynth, 'playKO' | 'playHit'>;
  build: Pick<
    BuildController,
    'runAsPlayer2' | 'applyToolAtCrosshair' | 'eraseAtCrosshair' | 'getConstraints'
  >;
  companion: Pick<CompanionManager, 'pos' | 'resetPosition'>;
  physics: Pick<PhysicsSim, 'isRunning' | 'checkPlayerDamage'>;
  getCamera(): PerspectiveCamera;
}

export class P2Controller {
  constructor(private readonly d: P2Deps) {}

  /** Player 2's own damage/KO. A KO sends only P2 back to their start with full HP; P1 is unaffected. */
  updateHealth(dt: number): void {
    const s = uiStore.getState();
    if (s.multiplayerMode !== 'split') return;
    const invincible = isCreativeSandbox();
    if (!this.d.physics.isRunning() || invincible) {
      if (s.p2Hp !== s.p2MaxHp) uiStore.setState({ p2Hp: s.p2MaxHp });
      return;
    }
    const f = this.d.companion.pos;
    const feet: [number, number, number] = [f.x, f.y, f.z];
    const hit = this.d.physics.checkPlayerDamage(feet, dt, undefined, 2);
    if (hit.damage <= 0) return;
    const nextHp = feet[1] < PHYSICS_TUNING.player.fallY ? 0 : Math.max(0, s.p2Hp - hit.damage);
    if (nextHp <= 0) {
      this.d.audio.playKO();
      levelStore.setState({ notice: `Player 2: ${hit.cause ?? 'Knocked out!'} Back to start!` });
      this.d.companion.resetPosition();
      uiStore.setState({ p2Hp: s.p2MaxHp, p2DamageFlash: s.p2DamageFlash + 1 });
      return;
    }
    uiStore.setState({
      p2Hp: nextHp,
      ...(hit.impact ? { p2DamageFlash: s.p2DamageFlash + 1 } : {}),
    });
    if (hit.impact) this.d.audio.playHit();
  }

  setTool(t: ToolType): void {
    uiStore.setState({ p2Tool: t });
  }

  setMaterial(m: MaterialType): void {
    uiStore.setState({ p2Material: m });
  }

  /** Handles queued P2 build presses; only active in split-screen build mode. */
  handleActions(actions: readonly P2Action[]): void {
    const s = uiStore.getState();
    if (s.multiplayerMode !== 'split' || s.mode !== 'build' || s.exploreMode) return;
    for (const a of actions) {
      if (a === 'nextTool') {
        const idx = P2_TOOLS.indexOf(uiStore.getState().p2Tool);
        this.setTool(P2_TOOLS[(idx + 1) % P2_TOOLS.length] ?? 'block');
      } else if (a === 'nextMaterial') {
        const pool = buildMaterialPool(this.d.build.getConstraints());
        if (pool.length === 0) continue;
        const idx = pool.indexOf(uiStore.getState().p2Material);
        this.setMaterial(pool[(Math.max(0, idx) + 1) % pool.length] ?? 'wood');
      } else {
        const p2 = { tool: uiStore.getState().p2Tool, material: uiStore.getState().p2Material };
        const cam = this.d.getCamera();
        this.d.build.runAsPlayer2(cam, p2, () =>
          a === 'place' ? this.d.build.applyToolAtCrosshair() : this.d.build.eraseAtCrosshair(),
        );
      }
    }
  }
}
