/**
 * First-person weapon firing, cooldowns, and player damage / KO handling during disaster runs.
 */
import { levelStore } from '../../levels/levelStore';
import { uiStore } from '../../state/store';
import type { Vec3 } from '../../types/blueprint';
import type { ArmorDef, WeaponDef } from '../../types/gear';
import type { AudioSynth } from '../AudioSynth';
import type { FirstPersonController } from '../FirstPersonController';
import type { PhysicsSim } from '../PhysicsSim';
import { PHYSICS_TUNING } from '../physics/tuning';
import type { SceneManager } from '../SceneManager';
import { isCreativeSandbox } from './modeRules';

export interface CombatDeps {
  audio: Pick<AudioSynth, 'resume' | 'playLaserZap' | 'playKO' | 'playHit'>;
  firstPerson: Pick<
    FirstPersonController,
    'getEyePosition' | 'getLookDirection' | 'getFeetPosition' | 'spawn' | 'yaw'
  >;
  physics: Pick<PhysicsSim, 'isRunning' | 'firePlayerWeapon' | 'checkPlayerDamage'>;
  scene: Pick<SceneManager, 'laserBeam'>;
  getEquippedWeapon(): WeaponDef | null;
  getEquippedArmor(): ArmorDef | null;
  currentBlockCenters(): Vec3[];
  onSurvivalKO(cause: string): void;
  rewind(): void;
}

export class CombatController {
  private weaponCooldown = 0;

  constructor(private readonly d: CombatDeps) {}

  tickCooldown(dt: number): void {
    this.weaponCooldown = Math.max(0, this.weaponCooldown - Math.max(0, dt));
  }

  fireWeapon(): void {
    const s0 = uiStore.getState();
    if (!s0.firstPerson || this.weaponCooldown > 0) return;
    const weapon = this.d.getEquippedWeapon();
    if (!weapon) return;
    this.weaponCooldown = weapon.cooldown;
    const eye = this.d.firstPerson.getEyePosition();
    const dir = this.d.firstPerson.getLookDirection();
    const result = this.d.physics.firePlayerWeapon(eye, dir, weapon);
    const rx = Math.cos(this.d.firstPerson.yaw);
    const rz = -Math.sin(this.d.firstPerson.yaw);
    const muzzle: Vec3 = [
      eye[0] + rx * 0.35 + dir[0] * 0.4,
      eye[1] - 0.25 + dir[1] * 0.4,
      eye[2] + rz * 0.35 + dir[2] * 0.4,
    ];
    this.d.scene.laserBeam(muzzle, result.hitPoint);
    this.d.audio.resume();
    this.d.audio.playLaserZap();
  }

  /** Evaluates player fall/hazard damage; returns true if the player was knocked out (frame should abort). */
  updatePlayerHealth(dt: number, centers: Vec3[]): boolean {
    if (!this.d.physics.isRunning()) {
      if (this.d.firstPerson.getFeetPosition()[1] < PHYSICS_TUNING.player.fallY) {
        this.d.firstPerson.spawn(centers);
      }
      return false;
    }
    if (isCreativeSandbox()) {
      if (this.d.firstPerson.getFeetPosition()[1] < PHYSICS_TUNING.player.fallY) {
        this.d.firstPerson.spawn(centers);
      }
      return false;
    }
    const armor = this.d.getEquippedArmor();
    const feet = this.d.firstPerson.getFeetPosition();
    const hit = this.d.physics.checkPlayerDamage(
      feet,
      dt,
      armor ? { damageReduction: armor.damageReduction, floodImmune: armor.floodImmune } : undefined,
    );
    if (hit.damage <= 0) return false;

    const s0 = uiStore.getState();
    const fellOff = feet[1] < PHYSICS_TUNING.player.fallY;
    const nextHp = fellOff ? 0 : Math.max(0, s0.playerHp - hit.damage);
    if (nextHp <= 0) {
      this.d.audio.playKO();
      if (s0.playMode === 'survival' && s0.levelId === null) {
        this.d.onSurvivalKO(hit.cause ?? 'Knocked out!');
        return true;
      }
      levelStore.setState({ notice: `${hit.cause ?? 'Knocked out!'} Restarting...` });
      uiStore.setState({ playerHp: s0.playerMaxHp, damageFlash: s0.damageFlash + 1 });
      this.d.rewind();
      this.d.firstPerson.spawn(this.d.currentBlockCenters());
      return true;
    }
    uiStore.setState({
      playerHp: nextHp,
      ...(hit.impact ? { damageFlash: s0.damageFlash + 1 } : {}),
    });
    if (hit.impact) this.d.audio.playHit();
    return false;
  }
}
