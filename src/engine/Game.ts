/**
 * OWNER: integration. Wires SceneManager, BuildController, PhysicsSim, assets/audio and the UI store,
 * and implements `GameActions` for the HUD. Feature logic lives in the controllers under `./game/`:
 *  - ProgressionController: points, shop unlocks, gear, level/survival results.
 *  - SessionController: mode/session transitions, save/continue, multiplayer, add-ons, mods.
 *  - InputRouter: gamepad polling, P2 co-op input, primary-action dispatch, cycling.
 *  - CombatController: weapon firing and player damage / KO.
 * Flow:
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
  Vec3,
} from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { DEFAULT_STRENGTH, DISASTER_SECONDS, cellToWorld } from '../types/blueprint';
import { isBuiltinMaterial } from '../types/materials';
import { uiStore } from '../state/store';
import { modStore } from '../mods/modStore';
import { loadMods } from '../mods/mods';
import { buildHeight, isMaterialAllowed } from '../levels/constraints';
import { levelStore } from '../levels/levelStore';
import { getLevel } from '../levels/levels';
import { getSurvivalWave } from '../levels/survival';
import { hasSavedGame } from '../levels/saveGame';
import { BuildController } from './BuildController';
import { COMPANION_WEAPON, CompanionManager } from './CompanionManager';
import { FirstPersonController } from './FirstPersonController';
import { GamepadManager } from './GamepadManager';
import { PHYSICS_TUNING, PhysicsSim, type SimOptions } from './PhysicsSim';
import { ProceduralAssets } from './ProceduralAssets';
import { AudioSynth } from './AudioSynth';
import { loadAudioSettings, saveAudioSettings } from '../state/audioSettings';
import { SceneManager } from './SceneManager';
import { CombatController } from './game/CombatController';
import { InputRouter } from './game/InputRouter';
import {
  isCreativeSandbox,
  isSurvivalMode,
  lockedByLevel,
  lockedBySurvival,
  lockedBySurvivalEnd,
} from './game/modeRules';
import { ProgressionController } from './game/ProgressionController';
import { SessionController } from './game/SessionController';

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

  private readonly progression: ProgressionController;
  private readonly session: SessionController;
  private readonly input: InputRouter;
  private readonly combat: CombatController;

  /** Incremented on every start/rewind so a slow async start cannot resurrect a cancelled run. */
  private runToken = 0;
  private currentRunDuration = DISASTER_SECONDS;
  private openModals = 0;
  private cleanups: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    this.build = new BuildController(this.scene, this.assets, this.audio);
    this.companion = new CompanionManager(this.scene.scene);
    this.firstPerson = new FirstPersonController(this.scene.camera, this.scene.domElement);

    this.progression = new ProgressionController({
      audio: this.audio,
      isSimRunning: () => this.physics.isRunning(),
    });
    this.session = new SessionController({
      audio: this.audio,
      assets: this.assets,
      build: this.build,
      companion: this.companion,
      firstPerson: this.firstPerson,
      progression: this.progression,
      currentBlockCenters: () => this.currentBlockCenters(),
      ensureBuildMode: () => this.ensureBuildMode(),
      rewind: () => this.rewind(),
      syncBuildEnabled: () => this.syncBuildEnabled(),
      syncInputPaused: () => this.syncInputPaused(),
    });
    this.combat = new CombatController({
      audio: this.audio,
      firstPerson: this.firstPerson,
      physics: this.physics,
      scene: this.scene,
      getEquippedWeapon: () => this.progression.getEquippedWeapon(),
      getEquippedArmor: () => this.progression.getEquippedArmor(),
      currentBlockCenters: () => this.currentBlockCenters(),
      onSurvivalKO: (cause) => this.endSurvivalByKO(cause),
      rewind: () => this.rewind(),
    });
    this.input = new InputRouter({
      audio: this.audio,
      build: this.build,
      firstPerson: this.firstPerson,
      gamepad: this.gamepad,
      isModalOpen: () => this.openModals > 0,
      setTool: (t) => this.setTool(t),
      setMaterial: (m) => this.setMaterial(m),
      setDisaster: (d) => this.setDisaster(d),
      equipGear: (id, slot) => this.equipGear(id, slot),
      fireWeapon: () => this.fireWeapon(),
      toggleDisaster: () => this.toggleDisaster(),
      rewind: () => this.rewind(),
      undo: () => this.undo(),
    });
    this.firstPerson.setFireHandler((source) => this.input.handlePrimaryAction(source));

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

    this.progression.hydrate();
    this.initAudio();
    uiStore.setState({
      playMode: 'creative',
      menuOpen: true,
      hasStarted: false,
      hasSave: hasSavedGame(),
      survivalWave: 1,
      survivalOver: false,
      survivalFailReason: null,
      survivalLastReward: 0,
      firstPerson: true,
      gamepadConnected: this.gamepad.isConnected(),
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
    this.cleanups.push(this.input.attachWindowListeners());
  }

  /** Restores saved sound settings, picks the music theme, and starts audio on the first user gesture. */
  private initAudio() {
    const saved = loadAudioSettings();
    this.audio.setMuted(saved.muted);
    this.audio.setMusicVolume(saved.musicVolume);
    uiStore.setState({ muted: saved.muted, musicVolume: saved.musicVolume });

    let menuOpen = uiStore.getState().menuOpen;
    this.audio.setMusicTheme(menuOpen ? 'menu' : 'game');
    const unsubscribe = uiStore.subscribe(() => {
      const next = uiStore.getState().menuOpen;
      if (next === menuOpen) return;
      menuOpen = next;
      this.audio.setMusicTheme(next ? 'menu' : 'game');
    });

    // Browsers block audio until a user gesture, so the music starts on the first one.
    const gestures = ['pointerdown', 'keydown', 'touchstart'] as const;
    const onGesture = () => {
      this.audio.resume();
      for (const type of gestures) window.removeEventListener(type, onGesture, true);
    };
    for (const type of gestures) window.addEventListener(type, onGesture, true);
    const onVisibility = () => this.audio.setSuspended(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);

    this.cleanups.push(unsubscribe, () => {
      for (const type of gestures) window.removeEventListener(type, onGesture, true);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  private saveAudio() {
    const { muted, musicVolume } = uiStore.getState();
    saveAudioSettings({ muted, musicVolume });
  }

  private syncBuildEnabled() {
    const s = uiStore.getState();
    this.build.setEnabled(s.mode === 'build' && !s.exploreMode);
  }

  private syncInputPaused() {
    const paused = this.openModals > 0 || uiStore.getState().menuOpen;
    this.firstPerson.setInputPaused(paused);
    this.gamepad.setPaused(paused);
  }

  /** Survival ends immediately when the player is knocked out: stop the run and show the fail screen. */
  private endSurvivalByKO(cause: string): void {
    const s0 = uiStore.getState();
    this.runToken++;
    this.physics.stop();
    this.build.setEnabled(false);
    this.scene.setWaterLevel(WATER_HIDDEN);
    this.audio.playWind(0);
    this.audio.playRumble(0);
    this.scene.setDisasterFx(s0.disaster, 0);
    this.progression.setLastMode('failed');
    uiStore.setState({
      mode: 'failed',
      playerHp: 0,
      survivalOver: true,
      survivalFailReason: cause,
      damageFlash: s0.damageFlash + 1,
    });
  }

  /** World centers of climbable ladder blocks (live physics positions while a disaster runs). */
  private currentLadderCenters(): Vec3[] {
    const blocks = this.build.getGraph().blocks;
    const ladders = blocks.filter((b) => b.material === 'ladder');
    if (ladders.length === 0) return [];
    if (uiStore.getState().mode !== 'build' && this.physics.isRunning()) {
      const notLadders = new Set(blocks.filter((b) => b.material !== 'ladder').map((b) => b.id));
      const live = this.physics.getBlockPositions(notLadders);
      if (live.length > 0) return live;
    }
    return ladders.map((b) => cellToWorld(b.cell));
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
    this.combat.tickCooldown(dt);
    this.scene.setSplitScreen(uiStore.getState().multiplayerMode === 'split');
    if (dt > 0) this.input.handleGamepad(dt);
    if (this.physics.isRunning()) this.physics.update(dt);
    if (uiStore.getState().firstPerson) {
      const sNow = uiStore.getState();
      const baseGravity =
        sNow.levelId === null && sNow.playMode !== 'survival'
          ? PHYSICS_TUNING.gravity * modStore.getState().active.gravityMultiplier
          : PHYSICS_TUNING.gravity;
      const gravity = baseGravity * (sNow.moonGravity ? 0.38 : 1);
      const armor = this.progression.getEquippedArmor();
      const centers = this.currentBlockCenters();
      const jumpMult = (armor?.jumpMultiplier ?? 1) * (sNow.turboMode ? 1.65 : 1);
      const speedMult = sNow.turboMode ? 1.55 : 1;
      this.firstPerson.update(dt, centers, gravity, jumpMult, speedMult, this.currentLadderCenters());
      if (this.combat.updatePlayerHealth(dt, centers)) return;
    }
    this.companion.update(
      dt,
      uiStore.getState().multiplayerMode,
      this.physics.isRunning(),
      this.physics.getProjectilePositions(),
      this.input.getP2Input(),
      (muzzle, dir) => {
        const res = this.physics.firePlayerWeapon(muzzle, dir, COMPANION_WEAPON);
        this.scene.laserBeam(muzzle, res.hitPoint);
        this.audio.resume();
        this.audio.playLaserZap();
      },
      this.input.getP2Look(),
    );
    if (this.scene.isSplitScreen()) {
      const { eye, target } = this.companion.getChaseCamera();
      this.scene.setSecondaryView(eye, target);
    }
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
    this.progression.recordLevelResult(t.mode, t.stars);
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
      if (!isCreativeSandbox() && !uiStore.getState().unlockedMaterials.includes(m)) {
        levelStore.setState({ notice: 'Unlock this in the Shop first!' });
        return;
      }
      if (!isMaterialAllowed(this.build.getConstraints(), m)) {
        levelStore.setState({ notice: 'This level does not have that material.' });
        return;
      }
    } else if (
      uiStore.getState().levelId !== null ||
      isSurvivalMode() ||
      !modStore.getState().active.blockMap.has(m)
    ) {
      levelStore.setState({ notice: 'Enable this mod in Free Build to use it.' });
      return;
    }
    levelStore.setState({ notice: null });
    this.build.setMaterial(m);
    uiStore.setState({ material: m });
  };

  // Session, mods, multiplayer and save/continue (SessionController)
  toggleMod: GameActions['toggleMod'] = (id) => this.session.toggleMod(id);
  saveMod: GameActions['saveMod'] = (mod) => this.session.saveMod(mod);
  deleteMod: GameActions['deleteMod'] = (id) => this.session.deleteMod(id);
  importMod: GameActions['importMod'] = (json) => this.session.importMod(json);
  selectLevel: GameActions['selectLevel'] = (id) => this.session.selectLevel(id);
  openMenu: GameActions['openMenu'] = () => this.session.openMenu();
  resumeGame: GameActions['resumeGame'] = () => this.session.resumeGame();
  saveGame: GameActions['saveGame'] = () => this.session.saveGame();
  continueGame: GameActions['continueGame'] = () => this.session.continueGame();
  setExploreMode: GameActions['setExploreMode'] = (on) => this.session.setExploreMode(on);
  setAddon: GameActions['setAddon'] = (addon, on) => this.session.setAddon(addon, on);
  setMultiplayerMode: GameActions['setMultiplayerMode'] = (mode) => this.session.setMultiplayerMode(mode);
  nextBattleTurn: GameActions['nextBattleTurn'] = () => this.session.nextBattleTurn();
  resetBattle: GameActions['resetBattle'] = () => this.session.resetBattle();
  startPlayMode: GameActions['startPlayMode'] = (mode) => this.session.startPlayMode(mode);
  nextSurvivalWave: GameActions['nextSurvivalWave'] = () => this.session.nextSurvivalWave();
  restartSurvival: GameActions['restartSurvival'] = () => this.session.restartSurvival();

  // Shop and gear (ProgressionController)
  unlockMaterial: GameActions['unlockMaterial'] = (m) => this.progression.unlockMaterial(m);
  unlockPreset: GameActions['unlockPreset'] = (p) => this.progression.unlockPreset(p);
  unlockGear: GameActions['unlockGear'] = (id) => this.progression.unlockGear(id);
  equipGear: GameActions['equipGear'] = (id, slot) => this.progression.equipGear(id, slot);

  // Combat and input (CombatController, InputRouter)
  fireWeapon: GameActions['fireWeapon'] = () => this.combat.fireWeapon();
  setP2Control: GameActions['setP2Control'] = (patch) => this.input.setP2Control(patch);
  setTouchMove: GameActions['setTouchMove'] = (x, y) => this.input.setTouchMove(x, y);
  setTouchJump: GameActions['setTouchJump'] = (on) => this.input.setTouchJump(on);

  setMirrorX: GameActions['setMirrorX'] = (on) => {
    this.build.setMirrorX(on);
    uiStore.setState({ mirrorX: on });
  };
  setDisaster: GameActions['setDisaster'] = (d) => {
    if (lockedByLevel() || lockedBySurvival()) return;
    uiStore.setState({ disaster: d });
  };
  setStrength: GameActions['setStrength'] = (s) => {
    if (lockedByLevel() || lockedBySurvival()) return;
    uiStore.setState({ strength: s });
  };
  loadPreset: GameActions['loadPreset'] = (p: PresetName) => {
    // Presets would bypass the level's block and material limits, so they are free-build only unless Explore Mode is on.
    if (uiStore.getState().levelId !== null && !uiStore.getState().exploreMode) {
      levelStore.setState({ notice: 'Starter builds are for free build. Leave the level to use them.' });
      return;
    }
    if (lockedBySurvivalEnd()) return;
    if (!isCreativeSandbox() && !uiStore.getState().unlockedPresets.includes(p)) {
      levelStore.setState({ notice: 'Unlock this quick-builder in the Shop first!' });
      return;
    }
    levelStore.setState({ notice: null });
    this.ensureBuildMode();
    this.build.loadPreset(p);
    this.firstPerson.spawn(this.currentBlockCenters());
  };
  undo = () => {
    if (uiStore.getState().exploreMode || lockedBySurvivalEnd()) return;
    this.ensureBuildMode();
    this.build.undo();
  };
  clearIsland = () => {
    if (lockedBySurvivalEnd()) return;
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
    this.saveAudio();
  };
  setMusicVolume: GameActions['setMusicVolume'] = (volume) => {
    const musicVolume = Math.min(1, Math.max(0, volume));
    this.audio.setMusicVolume(musicVolume);
    uiStore.setState({ musicVolume });
    this.saveAudio();
  };
  setModalOpen: GameActions['setModalOpen'] = (open) => {
    this.openModals = Math.max(0, this.openModals + (open ? 1 : -1));
    this.audio.setMusicDucked(this.openModals > 0);
    this.syncInputPaused();
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
