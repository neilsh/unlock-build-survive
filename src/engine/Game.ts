/**
 * OWNER: integration (step 0 + final pass). Wires SceneManager, BuildController, PhysicsSim,
 * assets/audio and the UI store, and implements `GameActions` for the HUD.
 *
 * Packages A-D should not edit this file; it already calls every contract method, so a package
 * works end to end as soon as its stub is filled in. Flow:
 *  - toggleDisaster: build mode -> startDisaster, otherwise -> rewind.
 *  - Each frame: physics.update(dt) while running, then telemetry is mirrored into the UI store.
 *  - Editing actions (preset, undo, clear) rewind first if a disaster is running or finished.
 */
import type {
  BlueprintGraph,
  DisasterType,
  GameDebugApi,
  MaterialType,
  PresetName,
  Strength,
  Telemetry,
  ToolType,
  Vec3,
} from '../types/blueprint';
import type { AddonId, GameActions, MultiplayerMode, PlayMode } from '../types/ui';
import {
  ARMORS,
  GEAR_ORDER,
  WEAPONS,
  isArmorId,
  isWeaponId,
  type ArmorDef,
  type ArmorId,
  type WeaponDef,
  type WeaponId,
} from '../types/gear';
import {
  DEFAULT_STRENGTH,
  DISASTER_ORDER,
  DISASTER_SECONDS,
  MATERIAL_ORDER,
  cellToWorld,
  emptyGraph,
  isBuiltinDisaster,
  isBuiltinMaterial,
} from '../types/blueprint';
import { uiStore } from '../state/store';
import { modStore } from '../mods/modStore';
import { loadMods, parseImportedMod, saveMods, type GameMod } from '../mods/mods';
import { buildHeight, isMaterialAllowed } from '../levels/constraints';
import { levelStore } from '../levels/levelStore';
import { LEVELS, getLevel } from '../levels/levels';
import {
  computeAvailablePoints,
  computeUnlocked,
  loadBest,
  loadGear,
  loadSurvival,
  loadUnlockedMaterials,
  loadUnlockedPresets,
  recordResult,
  saveBest,
  saveGear,
  saveSurvival,
  saveUnlockedMaterials,
  saveUnlockedPresets,
  tryUnlockGear,
  tryUnlockMaterial,
  tryUnlockPreset,
} from '../levels/progress';
import { getSurvivalWave } from '../levels/survival';
import { hasSavedGame, loadGameState, saveGameState } from '../levels/saveGame';
import { BuildController } from './BuildController';
import { COMPANION_WEAPON, CompanionManager, type CompanionInput } from './CompanionManager';
import { FirstPersonController } from './FirstPersonController';
import { GamepadManager } from './GamepadManager';
import { PHYSICS_TUNING, PhysicsSim, type SimOptions } from './PhysicsSim';
import { AudioSynth, ProceduralAssets } from './ProceduralAssets';
import { SceneManager } from './SceneManager';

/** Flood plane level when no flood is running (hidden below -1). */
const WATER_HIDDEN = -2;

/** Implements GameDebugApi too, so package F can expose `window.__GAME_DEBUG__ = game` directly. */
export class Game implements GameActions, GameDebugApi {
  readonly scene: SceneManager;
  readonly assets = new ProceduralAssets();
  readonly audio = new AudioSynth();
  readonly build: BuildController;
  readonly companion: CompanionManager;
  readonly firstPerson: FirstPersonController;
  readonly gamepad = new GamepadManager();
  readonly physics = new PhysicsSim();

  /** Incremented on every start/rewind so a slow async start cannot resurrect a cancelled run. */
  private runToken = 0;
  private currentRunDuration = DISASTER_SECONDS;
  private openModals = 0;
  private weaponCooldown = 0;
  private survivalBonusPoints = 0;
  private rewardedSurvivalWave = 0;
  private readonly p2Keys = new Set<string>();
  private p2Gamepad: CompanionInput = { moveX: 0, moveY: 0, jump: false, fire: false };
  private p2Touch: CompanionInput = { moveX: 0, moveY: 0, jump: false, fire: false };
  private cleanups: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    this.build = new BuildController(this.scene, this.assets, this.audio);
    this.companion = new CompanionManager(this.scene.scene);
    this.firstPerson = new FirstPersonController(this.scene.camera, this.scene.domElement);
    this.firstPerson.setFireHandler((source) => this.handlePrimaryAction(source));

    const mods = loadMods();
    modStore.setMods(mods);
    this.assets.setCustomMaterials(modStore.getState().active.blockMap);

    this.physics.setEffectsRoot(this.scene.scene);
    this.physics.setEvents({
      onJointBreak: (id) => {
        this.audio.playJointSnap();
        if (this.physics.getTelemetry().firstBrokenId === id) this.build.highlight(id);
      },
      onSurvived: () => this.audio.playVictory(),
      onIntensity: (disaster, intensity) => {
        const sNow = uiStore.getState();
        const customD =
          sNow.levelId === null && sNow.playMode !== 'survival'
            ? modStore.getState().active.disasterMap.get(disaster)
            : undefined;
        const customMeta = customD
          ? { color: customD.color, quake: Boolean(customD.quake), wind: Boolean(customD.wind) }
          : undefined;
        this.scene.setDisasterFx(disaster, intensity, customMeta);
        if (
          disaster === 'hurricane' ||
          disaster === 'fire_tornado' ||
          disaster === 'snow_storm' ||
          customD?.wind
        ) {
          this.audio.playWind(intensity);
        }
        if (disaster === 'earthquake' || disaster === 'meteor' || customD?.quake) {
          this.audio.playRumble(intensity);
        }
      },
      onWaterLevel: (y) => this.scene.setWaterLevel(y),
      onProjectileImpact: (kind, x, y, z) => this.scene.projectileImpact(kind, x, y, z),
      onLaserFire: (from, to) => {
        this.scene.laserBeam(from, to);
        this.audio.playLaserZap();
      },
    });

    const best = loadBest(LEVELS);
    const unlockedMaterials = loadUnlockedMaterials();
    const unlockedPresets = loadUnlockedPresets();
    const gear = loadGear();
    const survival = loadSurvival();
    this.survivalBonusPoints = survival.bonusPoints;
    const playerMaxHp = this.computeMaxHp(gear.armor);
    levelStore.setState({ best });
    uiStore.setState({
      playMode: 'creative',
      menuOpen: true,
      hasStarted: false,
      hasSave: hasSavedGame(),
      survivalWave: 1,
      survivalBestWave: survival.bestWave,
      survivalOver: false,
      survivalFailReason: null,
      survivalLastReward: 0,
      unlocked: computeUnlocked(LEVELS, best),
      unlockedMaterials,
      unlockedPresets,
      unlockedGear: gear.unlocked,
      equippedArmor: gear.armor,
      equippedWeapon: gear.weapon,
      firstPerson: true,
      gamepadConnected: this.gamepad.isConnected(),
      playerMaxHp,
      playerHp: playerMaxHp,
      points: computeAvailablePoints(
        LEVELS,
        best,
        unlockedMaterials,
        gear.unlocked,
        unlockedPresets,
        this.survivalBonusPoints,
      ),
    });

    this.scene.setOrbitMode(false);
    this.firstPerson.spawn(this.currentBlockCenters());
    this.firstPerson.setEnabled(true);
    this.build.setCrosshairMode(true);
    this.syncBuildEnabled();
    this.syncInputPaused();

    const GAMEPAD_LOST_NOTICE =
      'Gamepad disconnected — click the game and press any controller button to reconnect.';
    let wasGamepadConnected = this.gamepad.isConnected();

    this.cleanups.push(
      this.scene.onFrame((dt) => this.tick(dt)),
      this.gamepad.onConnectionChange((connected) => {
        uiStore.setState({ gamepadConnected: connected });
        if (wasGamepadConnected && !connected) {
          levelStore.setState({ notice: GAMEPAD_LOST_NOTICE });
        } else if (
          !wasGamepadConnected &&
          connected &&
          levelStore.getState().notice === GAMEPAD_LOST_NOTICE
        ) {
          levelStore.setState({ notice: null });
        }
        wasGamepadConnected = connected;
      }),
      this.build.subscribe(() => {
        const g = this.build.getGraph();
        uiStore.setState({ canUndo: this.build.canUndo() });
        levelStore.setState({ blocksUsed: g.blocks.length, height: buildHeight(g) });
      }),
    );

    if (typeof window !== 'undefined') {
      const p2Codes = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftRight', 'Enter']);
      const onP2KeyDown = (e: KeyboardEvent) => {
        if (!p2Codes.has(e.code)) return;
        const s = uiStore.getState();
        if (s.multiplayerMode !== 'coop' || s.menuOpen || this.openModals > 0) return;
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
      };
      const onP2KeyUp = (e: KeyboardEvent) => {
        this.p2Keys.delete(e.code);
      };
      const onP2Blur = () => {
        this.p2Keys.clear();
        this.p2Touch = { moveX: 0, moveY: 0, jump: false, fire: false };
      };
      window.addEventListener('keydown', onP2KeyDown);
      window.addEventListener('keyup', onP2KeyUp);
      window.addEventListener('blur', onP2Blur);
      this.cleanups.push(
        () => window.removeEventListener('keydown', onP2KeyDown),
        () => window.removeEventListener('keyup', onP2KeyUp),
        () => window.removeEventListener('blur', onP2Blur),
      );
    }
  }

  private lastMode: Telemetry['mode'] = 'build';

  private syncBuildEnabled() {
    const s = uiStore.getState();
    this.build.setEnabled(s.mode === 'build' && !s.exploreMode);
  }

  private syncInputPaused() {
    const paused = this.openModals > 0 || uiStore.getState().menuOpen;
    this.firstPerson.setInputPaused(paused);
    this.gamepad.setPaused(paused);
  }

  private isCreativeSandbox(): boolean {
    const s = uiStore.getState();
    return s.playMode === 'creative' && s.levelId === null;
  }

  private isSurvivalMode(): boolean {
    const s = uiStore.getState();
    return s.playMode === 'survival' && s.levelId === null;
  }

  private lockedBySurvival(): boolean {
    if (!this.isSurvivalMode()) return false;
    levelStore.setState({ notice: 'Survival waves pick the next disaster automatically.' });
    return true;
  }

  private lockedBySurvivalEnd(): boolean {
    const s = uiStore.getState();
    return s.playMode === 'survival' && s.levelId === null && (s.survivalOver || s.mode === 'survived');
  }

  /** On the frame a level or survival wave finishes, records stars/wave rewards and updates points. */
  private recordLevelResult(mode: Telemetry['mode'], stars: Telemetry['stars']) {
    const finished = mode === 'survived' || mode === 'failed';
    const justFinished = finished && this.lastMode === 'simulating';
    this.lastMode = mode;
    const s0 = uiStore.getState();
    if (!justFinished) return;
    if (s0.levelId) {
      const out = recordResult(LEVELS, levelStore.getState().best, s0.levelId, stars);
      saveBest(out.best);
      levelStore.setState({ best: out.best, justUnlocked: out.newlyUnlocked });
      uiStore.setState({
        unlocked: computeUnlocked(LEVELS, out.best),
        points: computeAvailablePoints(
          LEVELS,
          out.best,
          s0.unlockedMaterials,
          s0.unlockedGear,
          s0.unlockedPresets,
          this.survivalBonusPoints,
        ),
      });
      return;
    }
    if (s0.playMode === 'survival' && !s0.survivalOver) {
      if (mode === 'survived') {
        const waveDef = getSurvivalWave(s0.survivalWave);
        const alreadyRewarded = s0.survivalWave <= this.rewardedSurvivalWave;
        if (!alreadyRewarded) {
          this.rewardedSurvivalWave = s0.survivalWave;
          this.survivalBonusPoints += waveDef.rewardPoints;
        }
        const bestWave = Math.max(s0.survivalBestWave, s0.survivalWave);
        saveSurvival({ bestWave, bonusPoints: this.survivalBonusPoints });
        uiStore.setState({
          survivalBestWave: bestWave,
          survivalLastReward: alreadyRewarded ? s0.survivalLastReward : waveDef.rewardPoints,
          points: computeAvailablePoints(
            LEVELS,
            levelStore.getState().best,
            s0.unlockedMaterials,
            s0.unlockedGear,
            s0.unlockedPresets,
            this.survivalBonusPoints,
          ),
        });
      } else {
        uiStore.setState({
          survivalOver: true,
          survivalFailReason: 'Your building collapsed!',
        });
      }
      return;
    }
    if (s0.multiplayerMode === 'battle') {
      if (s0.battleTurn === 1 && !s0.battleP1Done) {
        uiStore.setState({ battleP1Score: s0.battleP1Score + stars, battleP1Done: true });
      } else if (s0.battleTurn === 2 && !s0.battleP2Done) {
        uiStore.setState({ battleP2Score: s0.battleP2Score + stars, battleP2Done: true });
      }
    }
  }

  private getEquippedArmor(): ArmorDef | null {
    const id = uiStore.getState().equippedArmor;
    return id ? ARMORS[id] : null;
  }

  private getEquippedWeapon(): WeaponDef | null {
    const id = uiStore.getState().equippedWeapon;
    return id ? WEAPONS[id] : null;
  }

  private computeMaxHp(armorId: ArmorId | null): number {
    return PHYSICS_TUNING.player.maxHp + (armorId ? ARMORS[armorId].bonusHp : 0);
  }

  private handlePrimaryAction(source: 'click' | 'key'): void {
    const s = uiStore.getState();
    if (source === 'key') {
      if (s.equippedWeapon) this.fireWeapon();
      else {
        this.audio.resume();
        this.build.toggleDoorAtCrosshair(6);
      }
      return;
    }
    if (s.mode === 'build') {
      this.audio.resume();
      if (s.exploreMode) this.build.toggleDoorAtCrosshair(6);
      else this.build.applyToolAtCrosshair();
    } else if (!s.equippedWeapon && this.build.toggleDoorAtCrosshair(6)) {
      this.audio.resume();
    } else {
      this.fireWeapon();
    }
  }

  private cycleTool(): void {
    const TOOLS: readonly ToolType[] = ['block', 'brace', 'paint', 'erase'];
    const idx = TOOLS.indexOf(uiStore.getState().tool);
    const next = TOOLS[(idx + 1) % TOOLS.length];
    if (next) this.setTool(next);
  }

  private cycleMaterial(step: number): void {
    const s0 = uiStore.getState();
    const constraints = this.build.getConstraints();
    const customIds =
      s0.levelId === null && s0.playMode !== 'survival'
        ? modStore.getState().active.blocks.map((b) => b.id)
        : [];
    const baseMaterials = this.isCreativeSandbox() ? MATERIAL_ORDER : s0.unlockedMaterials;
    const pool = [...baseMaterials, ...customIds].filter((m) => isMaterialAllowed(constraints, m));
    if (pool.length === 0) return;
    const idx = pool.indexOf(s0.material);
    const base = idx >= 0 ? idx : 0;
    const next = pool[(base + step + pool.length) % pool.length];
    if (next) this.setMaterial(next);
  }

  private cycleDisaster(): void {
    if (uiStore.getState().levelId !== null || this.isSurvivalMode()) return;
    const customIds = modStore.getState().active.disasters.map((d) => d.id);
    const pool: readonly DisasterType[] = [...DISASTER_ORDER, ...customIds];
    if (pool.length === 0) return;
    const idx = pool.indexOf(uiStore.getState().disaster);
    const next = pool[(idx + 1) % pool.length];
    if (next) this.setDisaster(next);
  }

  private cycleGear(slot: 'armor' | 'weapon'): void {
    const s0 = uiStore.getState();
    const pool = this.isCreativeSandbox() ? GEAR_ORDER : s0.unlockedGear;
    const owned = pool.filter(slot === 'armor' ? isArmorId : isWeaponId);
    if (owned.length === 0) return;
    const current = slot === 'armor' ? s0.equippedArmor : s0.equippedWeapon;
    const idx = current ? owned.indexOf(current) : -1;
    const next = owned[(idx + 1) % owned.length];
    if (next) this.equipGear(next, slot);
  }

  private handleGamepad(dt: number): void {
    const gp = this.gamepad.poll();
    if (!gp.connected || this.openModals > 0 || uiStore.getState().menuOpen) {
      this.firstPerson.setGamepadInput(0, 0, false);
      this.p2Gamepad = { moveX: 0, moveY: 0, jump: false, fire: false };
      return;
    }
    if (uiStore.getState().multiplayerMode === 'coop') {
      this.firstPerson.setGamepadInput(0, 0, false);
      this.p2Gamepad = {
        moveX: gp.moveX,
        moveY: gp.moveY,
        jump: gp.jumpHeld,
        fire: gp.fireHeld || gp.primaryPressed,
      };
      return;
    }
    this.p2Gamepad = { moveX: 0, moveY: 0, jump: false, fire: false };
    this.firstPerson.setGamepadInput(gp.moveX, gp.moveY, gp.jumpHeld);
    if (gp.lookX !== 0 || gp.lookY !== 0) {
      this.firstPerson.lookAngles(gp.lookX * 2.4 * dt, gp.lookY * 2.0 * dt);
    }
    if (gp.toggleDisaster) this.toggleDisaster();
    if (gp.backOrUndo) {
      if (this.build.hasActiveBrace()) this.build.cancelBrace();
      else if (this.lockedBySurvivalEnd()) {
        // Require explicit Next Wave / Retry / Main Menu instead of rewinding past a finished Survival wave.
      } else if (uiStore.getState().mode !== 'build') this.rewind();
      else this.undo();
    }
    if (uiStore.getState().mode === 'build') {
      if (uiStore.getState().exploreMode) {
        if (gp.primaryPressed) {
          this.audio.resume();
          this.build.toggleDoorAtCrosshair(6);
        }
        if (gp.toggleFirstPerson) this.cycleDisaster();
      } else {
        if (gp.primaryPressed) {
          this.audio.resume();
          this.build.applyToolAtCrosshair();
        }
        if (gp.secondaryPressed) {
          this.audio.resume();
          this.build.eraseAtCrosshair();
        }
        if (gp.actionXPressed) this.cycleTool();
        if (gp.prevShoulder) this.cycleMaterial(-1);
        if (gp.nextShoulder) this.cycleMaterial(1);
        if (gp.toggleFirstPerson) this.cycleDisaster();
      }
    } else {
      if (gp.fireHeld) this.fireWeapon();
      if (gp.prevShoulder) this.cycleGear('armor');
      if (gp.nextShoulder) this.cycleGear('weapon');
    }
  }

  private currentBlockCenters(): Vec3[] {
    const openDoors = this.build.getOpenDoorIds();
    if (uiStore.getState().mode !== 'build') {
      const live = this.physics.getBlockPositions(openDoors);
      if (live.length > 0 || this.build.getGraph().blocks.length === 0) return live;
    }
    return this.build
      .getGraph()
      .blocks.filter((b) => !this.build.isDoorOpen(b.id))
      .map((b) => cellToWorld(b.cell));
  }

  private tick(dt: number) {
    this.weaponCooldown = Math.max(0, this.weaponCooldown - Math.max(0, dt));
    if (dt > 0) this.handleGamepad(dt);
    if (this.physics.isRunning()) this.physics.update(dt);
    if (uiStore.getState().firstPerson) {
      const sNow = uiStore.getState();
      const baseGravity =
        sNow.levelId === null && sNow.playMode !== 'survival'
          ? PHYSICS_TUNING.gravity * modStore.getState().active.gravityMultiplier
          : PHYSICS_TUNING.gravity;
      const gravity = baseGravity * (sNow.moonGravity ? 0.38 : 1);
      const armor = this.getEquippedArmor();
      const centers = this.currentBlockCenters();
      const jumpMult = (armor?.jumpMultiplier ?? 1) * (sNow.turboMode ? 1.65 : 1);
      const speedMult = sNow.turboMode ? 1.55 : 1;
      this.firstPerson.update(dt, centers, gravity, jumpMult, speedMult);
      if (this.physics.isRunning()) {
        if (this.isCreativeSandbox()) {
          if (this.firstPerson.getFeetPosition()[1] < PHYSICS_TUNING.player.fallY) {
            this.firstPerson.spawn(centers);
          }
        } else {
          const feet = this.firstPerson.getFeetPosition();
          const hit = this.physics.checkPlayerDamage(
            feet,
            dt,
            armor ? { damageReduction: armor.damageReduction, floodImmune: armor.floodImmune } : undefined,
          );
          if (hit.damage > 0) {
            const s0 = uiStore.getState();
            const fellOff = feet[1] < PHYSICS_TUNING.player.fallY;
            const nextHp = fellOff ? 0 : Math.max(0, s0.playerHp - hit.damage);
            if (nextHp <= 0) {
              this.audio.playKO();
              if (s0.playMode === 'survival' && s0.levelId === null) {
                this.runToken++;
                this.physics.stop();
                this.build.setEnabled(false);
                this.scene.setWaterLevel(WATER_HIDDEN);
                this.audio.playWind(0);
                this.audio.playRumble(0);
                this.scene.setDisasterFx(s0.disaster, 0);
                this.lastMode = 'failed';
                uiStore.setState({
                  mode: 'failed',
                  playerHp: 0,
                  survivalOver: true,
                  survivalFailReason: hit.cause ?? 'Knocked out!',
                  damageFlash: s0.damageFlash + 1,
                });
                return;
              }
              levelStore.setState({ notice: `${hit.cause ?? 'Knocked out!'} Restarting...` });
              uiStore.setState({ playerHp: s0.playerMaxHp, damageFlash: s0.damageFlash + 1 });
              this.rewind();
              this.firstPerson.spawn(this.currentBlockCenters());
              return;
            }
            uiStore.setState({
              playerHp: nextHp,
              ...(hit.impact ? { damageFlash: s0.damageFlash + 1 } : {}),
            });
            if (hit.impact) this.audio.playHit();
          }
        }
      } else if (this.firstPerson.getFeetPosition()[1] < PHYSICS_TUNING.player.fallY) {
        this.firstPerson.spawn(centers);
      }
    }
    const mpMode = uiStore.getState().multiplayerMode;
    const p2KeyX = (this.p2Keys.has('ArrowRight') ? 1 : 0) - (this.p2Keys.has('ArrowLeft') ? 1 : 0);
    const p2KeyY = (this.p2Keys.has('ArrowUp') ? 1 : 0) - (this.p2Keys.has('ArrowDown') ? 1 : 0);
    const p2Input: CompanionInput = {
      moveX: Math.max(-1, Math.min(1, p2KeyX + this.p2Gamepad.moveX + this.p2Touch.moveX)),
      moveY: Math.max(-1, Math.min(1, p2KeyY + this.p2Gamepad.moveY + this.p2Touch.moveY)),
      jump: this.p2Keys.has('ShiftRight') || this.p2Gamepad.jump || this.p2Touch.jump,
      fire: this.p2Keys.has('Enter') || this.p2Gamepad.fire || this.p2Touch.fire,
    };
    this.companion.update(
      dt,
      mpMode,
      this.physics.isRunning(),
      this.physics.getProjectilePositions(),
      p2Input,
      (muzzle, dir) => {
        const res = this.physics.firePlayerWeapon(muzzle, dir, COMPANION_WEAPON);
        this.scene.laserBeam(muzzle, res.hitPoint);
        this.audio.resume();
        this.audio.playLaserZap();
      },
    );
    if (uiStore.getState().survivalOver) return;
    const t = this.physics.getTelemetry();
    const s = uiStore.getState();
    const uiTimeRemaining = t.mode === 'simulating' ? Math.ceil(t.timeRemaining) : t.timeRemaining;
    if (
      s.mode !== t.mode ||
      s.timeRemaining !== uiTimeRemaining ||
      s.firstBrokenId !== t.firstBrokenId ||
      s.standingRatio !== t.standingRatio ||
      s.stars !== t.stars
    ) {
      uiStore.setState({
        mode: t.mode,
        timeRemaining: uiTimeRemaining,
        firstBrokenId: t.firstBrokenId,
        standingRatio: t.standingRatio,
        stars: t.stars,
      });
    }
    this.sampleStanding(t.mode, t.timeRemaining, t.standingRatio);
    this.recordLevelResult(t.mode, t.stars);
  }

  /** Elapsed run seconds at the last `standingHistory` sample (null before the first sample of a run). */
  private lastSampleElapsed: number | null = null;
  private static readonly SAMPLE_EVERY = 0.25;

  /** Appends standingRatio to `standingHistory` every 0.25 s of a run, plus once when it ends. */
  private sampleStanding(mode: Telemetry['mode'], timeRemaining: number, standingRatio: number) {
    const history = uiStore.getState().standingHistory;
    if (mode === 'build') {
      if (history.length > 0) uiStore.setState({ standingHistory: [] });
      this.lastSampleElapsed = null;
      return;
    }
    const elapsed = this.currentRunDuration - timeRemaining;
    const due =
      this.lastSampleElapsed === null || elapsed - this.lastSampleElapsed >= Game.SAMPLE_EVERY - 1e-9;
    const finalSample = mode !== 'simulating' && this.lastSampleElapsed !== elapsed;
    if (due || finalSample) {
      this.lastSampleElapsed = elapsed;
      uiStore.setState({ standingHistory: [...history, standingRatio] });
    }
  }

  private ensureBuildMode() {
    if (uiStore.getState().mode !== 'build' || this.physics.isRunning()) this.rewind();
  }

  // ------------------------------------------------------------ GameActions (HUD)

  setTool: GameActions['setTool'] = (t) => {
    this.build.setTool(t);
    uiStore.setState({ tool: t });
  };
  setMaterial: GameActions['setMaterial'] = (m) => {
    if (isBuiltinMaterial(m)) {
      if (!this.isCreativeSandbox() && !uiStore.getState().unlockedMaterials.includes(m)) {
        levelStore.setState({ notice: 'Unlock this in the Shop first!' });
        return;
      }
      if (!isMaterialAllowed(this.build.getConstraints(), m)) {
        levelStore.setState({ notice: 'This level does not have that material.' });
        return;
      }
    } else if (
      uiStore.getState().levelId !== null ||
      this.isSurvivalMode() ||
      !modStore.getState().active.blockMap.has(m)
    ) {
      levelStore.setState({ notice: 'Enable this mod in Free Build to use it.' });
      return;
    }
    levelStore.setState({ notice: null });
    this.build.setMaterial(m);
    uiStore.setState({ material: m });
  };
  private applyMods(next: GameMod[]) {
    saveMods(next);
    modStore.setMods(next);
    const { active } = modStore.getState();
    this.assets.setCustomMaterials(active.blockMap);
    this.build.refreshCustomMaterials();
    const { material, disaster } = uiStore.getState();
    if (!isBuiltinMaterial(material) && !active.blockMap.has(material)) {
      this.build.setMaterial('wood');
      uiStore.setState({ material: 'wood' });
    }
    if (!isBuiltinDisaster(disaster) && !active.disasterMap.has(disaster)) {
      uiStore.setState({ disaster: 'earthquake' });
    }
  }
  toggleMod: GameActions['toggleMod'] = (id) => {
    this.ensureBuildMode();
    const next: GameMod[] = [];
    for (const m of modStore.getState().mods) {
      next.push(m.id === id ? Object.assign({}, m, { enabled: !m.enabled }) : m);
    }
    this.applyMods(next);
  };
  saveMod: GameActions['saveMod'] = (mod) => {
    this.ensureBuildMode();
    const mods = modStore.getState().mods;
    const exists = mods.some((m) => m.id === mod.id);
    const clean: GameMod = { ...mod, builtIn: false };
    const next = exists ? mods.map((m) => (m.id === mod.id ? clean : m)) : [...mods, clean];
    this.applyMods(next);
  };
  deleteMod: GameActions['deleteMod'] = (id) => {
    this.ensureBuildMode();
    const next = modStore.getState().mods.filter((m) => m.builtIn || m.id !== id);
    this.applyMods(next);
  };
  importMod: GameActions['importMod'] = (json) => {
    this.ensureBuildMode();
    const mods = modStore.getState().mods;
    const parsed = parseImportedMod(json, new Set(mods.map((m) => m.id)));
    if (!parsed.ok) return parsed;
    this.applyMods([...mods, parsed.mod]);
    return { ok: true };
  };
  unlockMaterial: GameActions['unlockMaterial'] = (m) => {
    const best = levelStore.getState().best;
    const s0 = uiStore.getState();
    const res = tryUnlockMaterial(
      LEVELS,
      best,
      s0.unlockedMaterials,
      m,
      s0.unlockedGear,
      s0.unlockedPresets,
      this.survivalBonusPoints,
    );
    if (!res.ok) return false;
    saveUnlockedMaterials(res.unlocked);
    uiStore.setState({
      unlockedMaterials: res.unlocked,
      points: computeAvailablePoints(
        LEVELS,
        best,
        res.unlocked,
        s0.unlockedGear,
        s0.unlockedPresets,
        this.survivalBonusPoints,
      ),
    });
    this.audio.resume();
    this.audio.playUnlock();
    return true;
  };
  unlockPreset: GameActions['unlockPreset'] = (p) => {
    const best = levelStore.getState().best;
    const s0 = uiStore.getState();
    const res = tryUnlockPreset(
      LEVELS,
      best,
      s0.unlockedMaterials,
      s0.unlockedGear,
      s0.unlockedPresets,
      p,
      this.survivalBonusPoints,
    );
    if (!res.ok) return false;
    saveUnlockedPresets(res.unlocked);
    uiStore.setState({
      unlockedPresets: res.unlocked,
      points: computeAvailablePoints(
        LEVELS,
        best,
        s0.unlockedMaterials,
        s0.unlockedGear,
        res.unlocked,
        this.survivalBonusPoints,
      ),
    });
    this.audio.resume();
    this.audio.playUnlock();
    return true;
  };
  unlockGear: GameActions['unlockGear'] = (id) => {
    const best = levelStore.getState().best;
    const s0 = uiStore.getState();
    const res = tryUnlockGear(
      LEVELS,
      best,
      s0.unlockedMaterials,
      s0.unlockedGear,
      id,
      s0.unlockedPresets,
      this.survivalBonusPoints,
    );
    if (!res.ok) return false;
    const nextArmor = isArmorId(id) ? id : s0.equippedArmor;
    const nextWeapon = isWeaponId(id) ? id : s0.equippedWeapon;
    const savedGear = loadGear();
    saveGear({
      unlocked: res.unlocked,
      armor: nextArmor && res.unlocked.includes(nextArmor) ? nextArmor : savedGear.armor,
      weapon: nextWeapon && res.unlocked.includes(nextWeapon) ? nextWeapon : savedGear.weapon,
    });
    const playerMaxHp = this.computeMaxHp(nextArmor);
    const playerHp = isArmorId(id) ? playerMaxHp : Math.min(s0.playerHp, playerMaxHp);
    uiStore.setState({
      unlockedGear: res.unlocked,
      equippedArmor: nextArmor,
      equippedWeapon: nextWeapon,
      playerMaxHp,
      playerHp,
      points: computeAvailablePoints(
        LEVELS,
        best,
        s0.unlockedMaterials,
        res.unlocked,
        s0.unlockedPresets,
        this.survivalBonusPoints,
      ),
    });
    this.audio.resume();
    this.audio.playUnlock();
    return true;
  };
  equipGear: GameActions['equipGear'] = (id, slot) => {
    const s0 = uiStore.getState();
    if (id !== null) {
      if (!this.isCreativeSandbox() && !s0.unlockedGear.includes(id)) return;
      if (slot === 'armor' && !isArmorId(id)) return;
      if (slot === 'weapon' && !isWeaponId(id)) return;
    }
    const nextArmor: ArmorId | null =
      slot === 'armor' ? (id !== null && isArmorId(id) ? id : null) : s0.equippedArmor;
    const nextWeapon: WeaponId | null =
      slot === 'weapon' ? (id !== null && isWeaponId(id) ? id : null) : s0.equippedWeapon;
    if (
      (nextArmor === null || s0.unlockedGear.includes(nextArmor)) &&
      (nextWeapon === null || s0.unlockedGear.includes(nextWeapon))
    ) {
      saveGear({ unlocked: s0.unlockedGear, armor: nextArmor, weapon: nextWeapon });
    }
    const prevMax = s0.playerMaxHp;
    const playerMaxHp = this.computeMaxHp(nextArmor);
    const playerHp = !this.physics.isRunning()
      ? playerMaxHp
      : Math.min(playerMaxHp, s0.playerHp + Math.max(0, playerMaxHp - prevMax));
    uiStore.setState({
      equippedArmor: nextArmor,
      equippedWeapon: nextWeapon,
      playerMaxHp,
      playerHp,
    });
  };
  fireWeapon: GameActions['fireWeapon'] = () => {
    const s0 = uiStore.getState();
    if (!s0.firstPerson || this.weaponCooldown > 0) return;
    const weapon = this.getEquippedWeapon();
    if (!weapon) return;
    this.weaponCooldown = weapon.cooldown;
    const eye = this.firstPerson.getEyePosition();
    const dir = this.firstPerson.getLookDirection();
    const result = this.physics.firePlayerWeapon(eye, dir, weapon);
    const rx = Math.cos(this.firstPerson.yaw);
    const rz = -Math.sin(this.firstPerson.yaw);
    const muzzle: Vec3 = [
      eye[0] + rx * 0.35 + dir[0] * 0.4,
      eye[1] - 0.25 + dir[1] * 0.4,
      eye[2] + rz * 0.35 + dir[2] * 0.4,
    ];
    this.scene.laserBeam(muzzle, result.hitPoint);
    this.audio.resume();
    this.audio.playLaserZap();
  };
  setMirrorX: GameActions['setMirrorX'] = (on) => {
    this.build.setMirrorX(on);
    uiStore.setState({ mirrorX: on });
  };
  setDisaster: GameActions['setDisaster'] = (d) => {
    if (this.lockedByLevel() || this.lockedBySurvival()) return;
    uiStore.setState({ disaster: d });
  };
  setStrength: GameActions['setStrength'] = (s) => {
    if (this.lockedByLevel() || this.lockedBySurvival()) return;
    uiStore.setState({ strength: s });
  };

  /** Disaster and strength are fixed while a challenge level is active. */
  private lockedByLevel(): boolean {
    if (uiStore.getState().levelId === null) return false;
    levelStore.setState({ notice: 'This level has its own disaster. Leave the level to pick another.' });
    return true;
  }

  /** Starts a challenge level (fresh island, its limits, disaster and strength) or free build with null. */
  selectLevel: GameActions['selectLevel'] = (id) => {
    this.ensureBuildMode();
    const level = id ? getLevel(id) : undefined;
    if (level && !uiStore.getState().unlocked.includes(level.id)) return;
    levelStore.setState({ notice: null, justUnlocked: null });
    const s0 = uiStore.getState();
    if (!level) {
      this.build.setConstraints(null);
      uiStore.setState({
        playMode: 'creative',
        menuOpen: false,
        hasStarted: true,
        survivalOver: false,
        survivalFailReason: null,
        survivalLastReward: 0,
        levelId: null,
      });
      this.syncBuildEnabled();
      this.syncInputPaused();
      return;
    }
    this.build.setConstraints(null);
    this.build.loadGraph(level.start?.() ?? emptyGraph());
    this.build.setConstraints(level.constraints ?? null);
    const allowed = level.constraints?.materials;
    const first = allowed?.[0];
    let nextMaterial = s0.material;
    if (first && !allowed.includes(s0.material)) {
      this.build.setMaterial(first);
      nextMaterial = first;
    } else if (!isBuiltinMaterial(s0.material)) {
      this.build.setMaterial('wood');
      nextMaterial = 'wood';
    } else if (!s0.unlockedMaterials.includes(s0.material)) {
      const fallback = allowed?.find((m) => s0.unlockedMaterials.includes(m)) ?? 'wood';
      this.build.setMaterial(fallback);
      nextMaterial = fallback;
    }
    const nextArmor =
      s0.equippedArmor && s0.unlockedGear.includes(s0.equippedArmor) ? s0.equippedArmor : null;
    const nextWeapon =
      s0.equippedWeapon && s0.unlockedGear.includes(s0.equippedWeapon) ? s0.equippedWeapon : null;
    const playerMaxHp = this.computeMaxHp(nextArmor);
    uiStore.setState({
      playMode: 'creative',
      menuOpen: false,
      hasStarted: true,
      survivalOver: false,
      survivalFailReason: null,
      survivalLastReward: 0,
      levelId: level.id,
      disaster: level.disaster,
      strength: level.strength,
      material: nextMaterial,
      equippedArmor: nextArmor,
      equippedWeapon: nextWeapon,
      playerMaxHp,
      playerHp: playerMaxHp,
    });
    this.syncBuildEnabled();
    this.syncInputPaused();
  };
  loadPreset: GameActions['loadPreset'] = (p: PresetName) => {
    // Presets would bypass the level's block and material limits, so they are free-build only unless Explore Mode is on.
    if (uiStore.getState().levelId !== null && !uiStore.getState().exploreMode) {
      levelStore.setState({ notice: 'Starter builds are for free build. Leave the level to use them.' });
      return;
    }
    if (this.lockedBySurvivalEnd()) return;
    if (!this.isCreativeSandbox() && !uiStore.getState().unlockedPresets.includes(p)) {
      levelStore.setState({ notice: 'Unlock this quick-builder in the Shop first!' });
      return;
    }
    levelStore.setState({ notice: null });
    this.ensureBuildMode();
    this.build.loadPreset(p);
    this.firstPerson.spawn(this.currentBlockCenters());
  };
  undo = () => {
    if (uiStore.getState().exploreMode || this.lockedBySurvivalEnd()) return;
    this.ensureBuildMode();
    this.build.undo();
  };
  clearIsland = () => {
    if (this.lockedBySurvivalEnd()) return;
    this.ensureBuildMode();
    this.build.clear();
  };
  toggleDisaster = () => {
    this.audio.resume();
    const { playMode, mode, disaster, strength, levelId, survivalOver, survivalWave } = uiStore.getState();
    if (playMode === 'survival' && levelId === null) {
      if (survivalOver) {
        this.restartSurvival();
        return;
      }
      if (mode === 'survived') {
        this.nextSurvivalWave();
        return;
      }
      if (mode !== 'build') {
        this.rewind();
        return;
      }
      const w = getSurvivalWave(survivalWave);
      levelStore.setState({ notice: null });
      void this.startDisaster(w.disaster, w.seed, w.strength);
      return;
    }
    if (mode !== 'build') {
      this.rewind();
      return;
    }
    const level = levelId ? getLevel(levelId) : undefined;
    if (level?.minHeight && buildHeight(this.build.getGraph()) < level.minHeight) {
      levelStore.setState({ notice: `Build at least ${level.minHeight} blocks tall first!` });
      return;
    }
    levelStore.setState({ notice: null });
    if (level) void this.startDisaster(level.disaster, level.seed ?? 1, level.strength);
    else void this.startDisaster(disaster, 1, strength);
  };
  setCameraAzimuth: GameActions['setCameraAzimuth'] = (deg) => {
    this.firstPerson.yaw = (deg * Math.PI) / 180;
    this.firstPerson.syncCamera();
    uiStore.setState({ azimuth: deg, firstPerson: true });
  };
  setFirstPerson: GameActions['setFirstPerson'] = () => {
    this.scene.setOrbitMode(false);
    if (!this.firstPerson.isEnabled()) {
      this.firstPerson.spawn(this.currentBlockCenters());
      this.firstPerson.setEnabled(true);
    }
    this.build.setCrosshairMode(true);
    this.syncBuildEnabled();
    uiStore.setState({ firstPerson: true });
  };
  setMuted: GameActions['setMuted'] = (muted) => {
    this.audio.setMuted(muted);
    uiStore.setState({ muted });
  };
  setModalOpen: GameActions['setModalOpen'] = (open) => {
    this.openModals = Math.max(0, this.openModals + (open ? 1 : -1));
    this.syncInputPaused();
  };
  openMenu: GameActions['openMenu'] = () => {
    uiStore.setState({ menuOpen: true });
    this.syncInputPaused();
  };
  resumeGame: GameActions['resumeGame'] = () => {
    if (!uiStore.getState().hasStarted) {
      this.startPlayMode(uiStore.getState().playMode);
      return;
    }
    uiStore.setState({ menuOpen: false });
    this.syncInputPaused();
  };
  saveGame: GameActions['saveGame'] = () => {
    const s = uiStore.getState();
    const ok = saveGameState({
      version: 1,
      savedAt: Date.now(),
      graph: this.build.getGraph(),
      playMode: s.playMode,
      exploreMode: s.exploreMode,
      moonGravity: s.moonGravity,
      turboMode: s.turboMode,
      megaStorm: s.megaStorm,
      multiplayerMode: s.multiplayerMode,
      disaster: s.disaster,
      strength: s.strength,
      survivalWave: s.survivalWave,
      battleTurn: s.battleTurn,
      battleRound: s.battleRound,
      battleP1Score: s.battleP1Score,
      battleP2Score: s.battleP2Score,
    });
    if (!ok) {
      levelStore.setState({ notice: 'Could not save right now (browser storage blocked).' });
      return;
    }
    uiStore.setState({ hasSave: true });
    levelStore.setState({ notice: 'Game saved!' });
    this.audio.resume();
    this.audio.playUnlock();
  };
  continueGame: GameActions['continueGame'] = () => {
    const saved = loadGameState();
    if (!saved) {
      levelStore.setState({ notice: 'No saved game found yet!' });
      return;
    }
    this.ensureBuildMode();
    this.build.setConstraints(null);
    this.build.loadGraph(saved.graph);
    this.companion.setMode(saved.multiplayerMode);
    this.firstPerson.setArrowKeysEnabled(saved.multiplayerMode !== 'coop');
    const s0 = uiStore.getState();
    uiStore.setState({
      playMode: saved.playMode,
      exploreMode: saved.exploreMode,
      moonGravity: Boolean(saved.moonGravity),
      turboMode: Boolean(saved.turboMode),
      megaStorm: Boolean(saved.megaStorm),
      multiplayerMode: saved.multiplayerMode,
      disaster: saved.disaster,
      strength: saved.strength,
      survivalWave: saved.survivalWave,
      battleTurn: saved.battleTurn,
      battleRound: saved.battleRound,
      battleP1Score: saved.battleP1Score,
      battleP2Score: saved.battleP2Score,
      battleP1Done: false,
      battleP2Done: false,
      levelId: null,
      menuOpen: false,
      hasStarted: true,
      hasSave: true,
      survivalOver: false,
      survivalFailReason: null,
      survivalLastReward: 0,
      playerHp: s0.playerMaxHp,
    });
    this.firstPerson.spawn(this.currentBlockCenters());
    this.syncBuildEnabled();
    this.syncInputPaused();
    levelStore.setState({ notice: 'Loaded your saved village!' });
  };
  setExploreMode: GameActions['setExploreMode'] = (on) => {
    uiStore.setState({ exploreMode: on });
    this.syncBuildEnabled();
  };
  setAddon: GameActions['setAddon'] = (addon: AddonId, on) => {
    uiStore.setState({ [addon]: on });
  };
  setMultiplayerMode: GameActions['setMultiplayerMode'] = (mode: MultiplayerMode) => {
    this.companion.setMode(mode);
    this.firstPerson.setArrowKeysEnabled(mode !== 'coop');
    if (mode === 'battle') {
      uiStore.setState({
        multiplayerMode: mode,
        battleTurn: 1,
        battleRound: 1,
        battleP1Score: 0,
        battleP2Score: 0,
        battleP1Done: false,
        battleP2Done: false,
      });
    } else {
      uiStore.setState({ multiplayerMode: mode });
    }
  };
  nextBattleTurn: GameActions['nextBattleTurn'] = () => {
    const s = uiStore.getState();
    if (s.multiplayerMode !== 'battle') return;
    this.rewind();
    this.build.clear();
    this.firstPerson.spawn(this.currentBlockCenters());
    if (s.battleTurn === 1) {
      uiStore.setState({ battleTurn: 2 });
    } else {
      uiStore.setState({
        battleTurn: 1,
        battleRound: s.battleRound + 1,
        battleP1Done: false,
        battleP2Done: false,
      });
    }
  };
  resetBattle: GameActions['resetBattle'] = () => {
    this.rewind();
    this.build.clear();
    this.firstPerson.spawn(this.currentBlockCenters());
    uiStore.setState({
      battleTurn: 1,
      battleRound: 1,
      battleP1Score: 0,
      battleP2Score: 0,
      battleP1Done: false,
      battleP2Done: false,
    });
  };
  setP2Control: GameActions['setP2Control'] = (patch) => {
    this.p2Touch = { ...this.p2Touch, ...patch };
  };
  startPlayMode: GameActions['startPlayMode'] = (mode: PlayMode) => {
    this.ensureBuildMode();
    this.build.setConstraints(null);
    levelStore.setState({ notice: null, justUnlocked: null });
    const s0 = uiStore.getState();
    if (mode === 'creative') {
      uiStore.setState({
        playMode: 'creative',
        levelId: null,
        menuOpen: false,
        hasStarted: true,
        survivalOver: false,
        survivalFailReason: null,
        survivalLastReward: 0,
        playerHp: s0.playerMaxHp,
      });
      this.syncBuildEnabled();
      this.syncInputPaused();
      return;
    }
    this.rewardedSurvivalWave = 0;
    let nextMaterial = s0.material;
    if (!isBuiltinMaterial(nextMaterial) || !s0.unlockedMaterials.includes(nextMaterial)) {
      nextMaterial = 'wood';
      this.build.setMaterial('wood');
    }
    const nextArmor =
      s0.equippedArmor && s0.unlockedGear.includes(s0.equippedArmor) ? s0.equippedArmor : null;
    const nextWeapon =
      s0.equippedWeapon && s0.unlockedGear.includes(s0.equippedWeapon) ? s0.equippedWeapon : null;
    const playerMaxHp = this.computeMaxHp(nextArmor);
    const wave1 = getSurvivalWave(1);
    uiStore.setState({
      playMode: 'survival',
      levelId: null,
      menuOpen: false,
      hasStarted: true,
      survivalWave: 1,
      survivalOver: false,
      survivalFailReason: null,
      survivalLastReward: 0,
      disaster: wave1.disaster,
      strength: wave1.strength,
      material: nextMaterial,
      equippedArmor: nextArmor,
      equippedWeapon: nextWeapon,
      playerMaxHp,
      playerHp: playerMaxHp,
    });
    this.firstPerson.spawn(this.currentBlockCenters());
    this.syncBuildEnabled();
    this.syncInputPaused();
  };
  nextSurvivalWave: GameActions['nextSurvivalWave'] = () => {
    const s = uiStore.getState();
    if (s.playMode !== 'survival' || s.survivalOver) return;
    const nextWaveNum = s.survivalWave + 1;
    const waveDef = getSurvivalWave(nextWaveNum);
    const healedHp = Math.min(s.playerMaxHp, Math.max(1, s.playerHp) + waveDef.healAmount);
    this.rewind();
    uiStore.setState({
      survivalWave: nextWaveNum,
      disaster: waveDef.disaster,
      strength: waveDef.strength,
      playerHp: healedHp,
      survivalLastReward: 0,
      survivalOver: false,
      survivalFailReason: null,
    });
  };
  restartSurvival: GameActions['restartSurvival'] = () => {
    this.startPlayMode('survival');
  };

  // ------------------------------------------------------------ disaster lifecycle (also debug API)

  async startDisaster(type: DisasterType, seed = 1, strength: Strength = DEFAULT_STRENGTH): Promise<void> {
    this.ensureBuildMode();
    const token = ++this.runToken;
    const s0 = uiStore.getState();
    uiStore.setState({
      disaster: type,
      strength,
      survivalOver: false,
      survivalFailReason: null,
      playerHp: s0.playMode === 'survival' && s0.levelId === null ? s0.playerHp : s0.playerMaxHp,
    });
    this.build.setEnabled(false);
    let options: SimOptions | undefined;
    if (s0.levelId === null && s0.playMode !== 'survival') {
      const active = modStore.getState().active;
      options = {
        customMaterials: active.blockMap,
        customDisaster: active.disasterMap.get(type),
        gravityMultiplier: active.gravityMultiplier * (s0.moonGravity ? 0.38 : 1),
        durationSeconds: s0.megaStorm ? Math.max(active.durationSeconds, 14) : active.durationSeconds,
      };
    } else if (s0.moonGravity || s0.megaStorm) {
      options = {
        gravityMultiplier: s0.moonGravity ? 0.38 : 1,
        durationSeconds: s0.megaStorm ? 14 : DISASTER_SECONDS,
      };
    }
    this.currentRunDuration = options?.durationSeconds ?? DISASTER_SECONDS;
    await this.physics.start(this.build.getGraph(), this.build.meshes, type, seed, strength, options);
    if (token !== this.runToken) this.physics.stop(); // rewound while Rapier was loading
  }

  rewind(): void {
    this.runToken++;
    this.physics.stop();
    this.build.resetMeshes();
    this.build.highlight(null);
    this.syncBuildEnabled();
    const s0 = uiStore.getState();
    uiStore.setState({
      playerHp: s0.playMode === 'survival' && s0.levelId === null ? s0.playerHp : s0.playerMaxHp,
      survivalOver: false,
      survivalFailReason: null,
    });
    if (this.firstPerson.getFeetPosition()[1] < -2) {
      this.firstPerson.spawn(this.currentBlockCenters());
    }
    this.scene.setWaterLevel(WATER_HIDDEN);
    this.audio.playWind(0);
    this.audio.playRumble(0);
    this.scene.setDisasterFx(uiStore.getState().disaster, 0);
    this.tick(0);
  }

  // ------------------------------------------------------------ debug-API helpers (package F wires these)

  placeBlock(x: number, y: number, z: number, material: MaterialType): boolean {
    this.ensureBuildMode();
    return this.build.placeBlock([x, y, z], material);
  }
  addStrut(a: Vec3, b: Vec3, material: MaterialType): boolean {
    this.ensureBuildMode();
    return this.build.addStrut(a, b, material);
  }
  getGraph(): BlueprintGraph {
    return this.build.getGraph();
  }
  advance(seconds: number): Telemetry {
    // Feed the sim in frame-sized slices through tick(), so standing samples and level results are
    // recorded exactly as during real frames. Fixed steps make the outcome independent of slicing.
    let left = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    while (left > 1e-9 && this.physics.isRunning()) {
      const dt = Math.min(left, PHYSICS_TUNING.maxFrameDt);
      this.tick(dt);
      left -= dt;
    }
    return this.getTelemetry();
  }
  getTelemetry(): Telemetry {
    const g = this.build.getGraph();
    return {
      ...this.physics.getTelemetry(),
      strength: uiStore.getState().strength,
      blockCount: g.blocks.length,
      strutCount: g.struts.length,
    };
  }

  dispose() {
    this.runToken++;
    this.physics.stop();
    this.cleanups.forEach((c) => c());
    this.gamepad.dispose();
    this.companion.dispose();
    this.firstPerson.dispose();
    this.build.dispose();
    this.scene.dispose();
    this.assets.dispose();
    this.audio.dispose();
  }
}
