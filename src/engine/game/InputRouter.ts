/**
 * Gamepad polling, P2 co-op keyboard/touch/gamepad aggregation, primary-action dispatch, and
 * tool/material/disaster/gear cycling.
 */
import { modStore } from '../../mods/modStore';
import { uiStore } from '../../state/store';
import { isTwoPlayerCoop } from '../../types/ui';
import { DISASTER_ORDER, type DisasterType, type MaterialType, type ToolType } from '../../types/blueprint';
import { GEAR_ORDER, isArmorId, isWeaponId, type GearId, type GearSlot } from '../../types/gear';
import type { AudioSynth } from '../AudioSynth';
import type { BuildController } from '../BuildController';
import type { CompanionInput } from '../CompanionManager';
import type { FirstPersonController } from '../FirstPersonController';
import type { GamepadManager, GamepadSnapshot } from '../GamepadManager';
import type { MenuNavigator } from '../MenuNavigator';
import { buildMaterialPool, isCreativeSandbox, isSurvivalMode, lockedBySurvivalEnd } from './modeRules';

export interface InputDeps {
  audio: Pick<AudioSynth, 'resume'>;
  build: Pick<
    BuildController,
    | 'getConstraints'
    | 'hasActiveBrace'
    | 'cancelBrace'
    | 'toggleDoorAtCrosshair'
    | 'applyToolAtCrosshair'
    | 'eraseAtCrosshair'
  >;
  firstPerson: Pick<FirstPersonController, 'setGamepadInput' | 'lookAngles'>;
  gamepad: Pick<GamepadManager, 'poll' | 'pollPair'>;
  menuNav: Pick<MenuNavigator, 'move' | 'confirm' | 'cancel'>;
  openMenu(): void;
  resumeGame(): void;
  isModalOpen(): boolean;
  setTool(t: ToolType): void;
  setMaterial(m: MaterialType): void;
  setDisaster(d: DisasterType): void;
  equipGear(id: GearId | null, slot: GearSlot): void;
  fireWeapon(): void;
  toggleDisaster(): void;
  rewind(): void;
  undo(): void;
}

/** Player 2 build-mode presses (split-screen): Enter places, ' erases, / cycles material, ; cycles tool. */
export type P2Action = 'place' | 'erase' | 'nextMaterial' | 'nextTool';
const P2_BUILD_KEYS: Record<string, P2Action | undefined> = {
  Enter: 'place',
  Quote: 'erase',
  Slash: 'nextMaterial',
  Semicolon: 'nextTool',
};

export class InputRouter {
  private readonly p2Keys = new Set<string>();
  private p2Gamepad: CompanionInput = { moveX: 0, moveY: 0, jump: false, fire: false };
  private p2Touch: CompanionInput = { moveX: 0, moveY: 0, jump: false, fire: false };
  /** On-screen joystick/jump button state for the local (P1) player, merged with gamepad input. */
  private touchMove = { x: 0, y: 0, jump: false };
  private p2LookPad = 0;
  /** Edge-triggered Player 2 build presses since the last `takeP2Actions()`. */
  private p2Actions: P2Action[] = [];

  constructor(private readonly d: InputDeps) {}

  /** Attaches P2 co-op keyboard/blur listeners to `window` and returns a cleanup callback. */
  attachWindowListeners(): () => void {
    if (typeof window === 'undefined') return () => {};
    const p2Codes = new Set([
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ShiftRight',
      'Enter',
      'Comma',
      'Period',
      'Slash',
      'Quote',
      'Semicolon',
    ]);
    const onP2KeyDown = (e: KeyboardEvent) => {
      if (!p2Codes.has(e.code)) return;
      const s = uiStore.getState();
      if (!isTwoPlayerCoop(s.multiplayerMode) || s.menuOpen || this.d.isModalOpen()) return;
      const target = e.target;
      if (
        typeof HTMLElement !== 'undefined' &&
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.code.startsWith('Arrow')) e.preventDefault();
      this.p2Keys.add(e.code);
      if (!e.repeat) {
        const action = P2_BUILD_KEYS[e.code];
        if (action) this.p2Actions.push(action);
      }
    };
    const onP2KeyUp = (e: KeyboardEvent) => {
      this.p2Keys.delete(e.code);
    };
    const onP2Blur = () => {
      this.p2Keys.clear();
      this.p2Actions = [];
      this.p2Touch = { moveX: 0, moveY: 0, jump: false, fire: false };
      this.touchMove = { x: 0, y: 0, jump: false };
    };
    window.addEventListener('keydown', onP2KeyDown);
    window.addEventListener('keyup', onP2KeyUp);
    window.addEventListener('blur', onP2Blur);
    return () => {
      window.removeEventListener('keydown', onP2KeyDown);
      window.removeEventListener('keyup', onP2KeyUp);
      window.removeEventListener('blur', onP2Blur);
    };
  }

  setP2Control(patch: Partial<CompanionInput>): void {
    this.p2Touch = { ...this.p2Touch, ...patch };
  }

  /** On-screen joystick: strafe/forward in -1..1 (clamped to unit length). */
  setTouchMove(strafe: number, forward: number): void {
    const len = Math.hypot(strafe, forward);
    const k = len > 1 ? 1 / len : 1;
    this.touchMove.x = strafe * k;
    this.touchMove.y = forward * k;
  }

  setTouchJump(jump: boolean): void {
    this.touchMove.jump = jump;
  }

  /** Sends gamepad + touch movement to the first-person controller (same path for both). */
  private applyMove(gpX: number, gpY: number, gpJump: boolean): void {
    const t = this.touchMove;
    this.d.firstPerson.setGamepadInput(
      Math.max(-1, Math.min(1, gpX + t.x)),
      Math.max(-1, Math.min(1, gpY + t.y)),
      gpJump || t.jump,
    );
  }

  getP2Input(): CompanionInput {
    const p2KeyX = (this.p2Keys.has('ArrowRight') ? 1 : 0) - (this.p2Keys.has('ArrowLeft') ? 1 : 0);
    const p2KeyY = (this.p2Keys.has('ArrowUp') ? 1 : 0) - (this.p2Keys.has('ArrowDown') ? 1 : 0);
    return {
      moveX: Math.max(-1, Math.min(1, p2KeyX + this.p2Gamepad.moveX + this.p2Touch.moveX)),
      moveY: Math.max(-1, Math.min(1, p2KeyY + this.p2Gamepad.moveY + this.p2Touch.moveY)),
      jump: this.p2Keys.has('ShiftRight') || this.p2Gamepad.jump || this.p2Touch.jump,
      fire: this.p2Keys.has('Enter') || this.p2Gamepad.fire || this.p2Touch.fire,
    };
  }

  /** Returns and clears the queued Player 2 build presses. */
  takeP2Actions(): P2Action[] {
    const out = this.p2Actions;
    this.p2Actions = [];
    return out;
  }

  /** Player 2 camera turn (-1..1): right stick X, or `,` / `.` on the keyboard. Used in split-screen. */
  getP2Look(): number {
    const keys = (this.p2Keys.has('Period') ? 1 : 0) - (this.p2Keys.has('Comma') ? 1 : 0);
    return Math.max(-1, Math.min(1, keys + this.p2LookPad));
  }

  handlePrimaryAction(source: 'click' | 'key'): void {
    const s = uiStore.getState();
    if (source === 'key') {
      if (s.equippedWeapon) this.d.fireWeapon();
      else {
        this.d.audio.resume();
        this.d.build.toggleDoorAtCrosshair(6);
      }
      return;
    }
    if (s.mode === 'build') {
      this.d.audio.resume();
      if (s.exploreMode) this.d.build.toggleDoorAtCrosshair(6);
      else this.d.build.applyToolAtCrosshair();
    } else if (!s.equippedWeapon && this.d.build.toggleDoorAtCrosshair(6)) {
      this.d.audio.resume();
    } else {
      this.d.fireWeapon();
    }
  }

  /**
   * Polls the gamepad(s) once per frame. Menus/modals capture the pad for navigation; otherwise, in solo
   * the pad drives Player 1. In 2P a single pad drives Player 2, and with two pads connected pad 1 drives
   * Player 1 (full solo controls) and pad 2 drives Player 2.
   */
  handleGamepad(dt: number): void {
    const twoP = isTwoPlayerCoop(uiStore.getState().multiplayerMode);
    let p1: GamepadSnapshot | null;
    let p2: GamepadSnapshot | null = null;
    if (twoP) {
      const pair = this.d.gamepad.pollPair();
      if (pair.secondary.connected) {
        p1 = pair.primary;
        p2 = pair.secondary;
      } else {
        p1 = null;
        p2 = pair.primary;
      }
    } else {
      p1 = this.d.gamepad.poll();
    }
    const pads = [p1, p2].filter((g): g is GamepadSnapshot => g !== null && g.connected);

    if (this.d.isModalOpen() || uiStore.getState().menuOpen) {
      this.releaseAllGamepadInput();
      for (const gp of pads) this.handleMenuPad(gp);
      return;
    }
    if (pads.some((g) => g.menuPressed)) {
      this.releaseAllGamepadInput();
      this.d.openMenu();
      return;
    }
    if (!p1?.connected) this.applyMove(0, 0, false);
    else this.handlePlayerOnePad(p1, dt);
    this.handlePlayerTwoPad(p2?.connected ? p2 : null);
  }

  private releaseAllGamepadInput(): void {
    this.d.firstPerson.setGamepadInput(0, 0, false);
    this.p2Gamepad = { moveX: 0, moveY: 0, jump: false, fire: false };
    this.p2LookPad = 0;
  }

  /** Menu/modal navigation: D-pad or stick moves focus, A clicks, B backs out, Start resumes. */
  private handleMenuPad(gp: GamepadSnapshot): void {
    const nav = this.d.menuNav;
    if (gp.navUp) nav.move('up');
    if (gp.navDown) nav.move('down');
    if (gp.navLeft) nav.move('left');
    if (gp.navRight) nav.move('right');
    if (gp.confirmPressed) nav.confirm();
    if (gp.backOrUndo) nav.cancel();
    if (gp.menuPressed) {
      if (this.d.isModalOpen()) nav.cancel();
      else if (uiStore.getState().hasStarted) this.d.resumeGame();
    }
  }

  /** Player 2's pad: movement, look and (in split-screen build mode) place / erase / tool / material. */
  private handlePlayerTwoPad(gp: GamepadSnapshot | null): void {
    if (!gp) {
      this.p2Gamepad = { moveX: 0, moveY: 0, jump: false, fire: false };
      this.p2LookPad = 0;
      return;
    }
    this.p2Gamepad = {
      moveX: gp.moveX,
      moveY: gp.moveY,
      jump: gp.jumpHeld,
      fire: gp.fireHeld || gp.primaryPressed,
    };
    this.p2LookPad = gp.lookX;
    if (gp.primaryPressed) this.p2Actions.push('place');
    if (gp.secondaryPressed) this.p2Actions.push('erase');
    if (gp.actionXPressed) this.p2Actions.push('nextTool');
    if (gp.nextShoulder) this.p2Actions.push('nextMaterial');
  }

  /** Player 1 (solo, or pad 1 in 2P with two pads): movement, look, build/erase, cycling, test, undo. */
  private handlePlayerOnePad(gp: GamepadSnapshot, dt: number): void {
    this.applyMove(gp.moveX, gp.moveY, gp.jumpHeld);
    if (gp.lookX !== 0 || gp.lookY !== 0) {
      this.d.firstPerson.lookAngles(gp.lookX * 2.4 * dt, gp.lookY * 2.0 * dt);
    }
    if (gp.toggleDisaster) this.d.toggleDisaster();
    if (gp.backOrUndo) {
      if (this.d.build.hasActiveBrace()) this.d.build.cancelBrace();
      else if (lockedBySurvivalEnd()) {
        // Require explicit Next Wave / Retry / Main Menu instead of rewinding past a finished Survival wave.
      } else if (uiStore.getState().mode !== 'build') this.d.rewind();
      else this.d.undo();
    }
    if (uiStore.getState().mode === 'build') {
      if (uiStore.getState().exploreMode) {
        if (gp.primaryPressed) {
          this.d.audio.resume();
          this.d.build.toggleDoorAtCrosshair(6);
        }
        if (gp.toggleFirstPerson) this.cycleDisaster();
      } else {
        if (gp.primaryPressed) {
          this.d.audio.resume();
          this.d.build.applyToolAtCrosshair();
        }
        if (gp.secondaryPressed) {
          this.d.audio.resume();
          this.d.build.eraseAtCrosshair();
        }
        if (gp.actionXPressed) this.cycleTool();
        if (gp.prevShoulder) this.cycleMaterial(-1);
        if (gp.nextShoulder) this.cycleMaterial(1);
        if (gp.toggleFirstPerson) this.cycleDisaster();
      }
    } else {
      if (gp.fireHeld) this.d.fireWeapon();
      if (gp.prevShoulder) this.cycleGear('armor');
      if (gp.nextShoulder) this.cycleGear('weapon');
    }
  }

  private cycleTool(): void {
    const TOOLS: readonly ToolType[] = ['block', 'brace', 'paint', 'erase'];
    const idx = TOOLS.indexOf(uiStore.getState().tool);
    const next = TOOLS[(idx + 1) % TOOLS.length];
    if (next) this.d.setTool(next);
  }

  private cycleMaterial(step: number): void {
    const s0 = uiStore.getState();
    const pool = buildMaterialPool(this.d.build.getConstraints());
    if (pool.length === 0) return;
    const idx = pool.indexOf(s0.material);
    const base = idx >= 0 ? idx : 0;
    const next = pool[(base + step + pool.length) % pool.length];
    if (next) this.d.setMaterial(next);
  }

  private cycleDisaster(): void {
    if (uiStore.getState().levelId !== null || isSurvivalMode()) return;
    const customIds = modStore.getState().active.disasters.map((d) => d.id);
    const pool: readonly DisasterType[] = [...DISASTER_ORDER, ...customIds];
    if (pool.length === 0) return;
    const idx = pool.indexOf(uiStore.getState().disaster);
    const next = pool[(idx + 1) % pool.length];
    if (next) this.d.setDisaster(next);
  }

  private cycleGear(slot: GearSlot): void {
    const s0 = uiStore.getState();
    const pool = isCreativeSandbox() ? GEAR_ORDER : s0.unlockedGear;
    const owned = pool.filter(slot === 'armor' ? isArmorId : isWeaponId);
    if (owned.length === 0) return;
    const current = slot === 'armor' ? s0.equippedArmor : s0.equippedWeapon;
    const idx = current ? owned.indexOf(current) : -1;
    const next = owned[(idx + 1) % owned.length];
    if (next) this.d.equipGear(next, slot);
  }
}
