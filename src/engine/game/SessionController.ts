/**
 * Mode/session transitions, save/continue, multiplayer modes, add-ons and mod lifecycle.
 * Talks to the engine only through `SessionDeps`.
 */
import { levelStore } from '../../levels/levelStore';
import { getLevel } from '../../levels/levels';
import { loadGameState, saveGameState } from '../../levels/saveGame';
import { getSurvivalWave } from '../../levels/survival';
import { modStore } from '../../mods/modStore';
import { parseImportedMod, saveMods, type GameMod } from '../../mods/mods';
import { uiStore } from '../../state/store';
import { DISASTER_ADDONS_OFF, pickDisasterAddons } from '../../types/addons';
import {
  DEFAULT_STRENGTH,
  GRID_CELLS,
  VILLAGE_GRID_CELLS,
  emptyGraph,
  getGridCells,
  isBuiltinDisaster,
  type BlueprintGraph,
  type Vec3,
} from '../../types/blueprint';
import { SANDBOX_POPULATION, VILLAGE_CONSTRAINTS, getVillageRound } from '../../levels/village';
import { isBuiltinMaterial } from '../../types/materials';
import {
  isTwoPlayerCoop,
  isVillagePlayMode,
  type AddonId,
  type GameActions,
  type MultiplayerMode,
  type PlayMode,
} from '../../types/ui';
import type { AudioSynth } from '../AudioSynth';
import type { BuildController } from '../BuildController';
import type { CompanionManager } from '../CompanionManager';
import type { FirstPersonController } from '../FirstPersonController';
import type { ProceduralAssets } from '../ProceduralAssets';
import type { ProgressionController } from './ProgressionController';

/** What the session needs from the Village Island controller (optional so headless fakes can omit it). */
export interface VillageHooks {
  enter(round?: number, population?: number, sandbox?: boolean): void;
  leave(): void;
}

export interface SessionDeps {
  village?: VillageHooks;
  /** Switches the build island size and re-fits the scene (Game implements it). */
  setIsland?(cells: number): void;
  audio: Pick<AudioSynth, 'resume' | 'playUnlock'>;
  assets: Pick<ProceduralAssets, 'setCustomMaterials'>;
  build: Pick<
    BuildController,
    'setConstraints' | 'loadGraph' | 'setMaterial' | 'getGraph' | 'clear' | 'refreshCustomMaterials'
  >;
  companion: Pick<CompanionManager, 'setMode'>;
  firstPerson: Pick<FirstPersonController, 'spawn' | 'setArrowKeysEnabled'>;
  progression: Pick<ProgressionController, 'computeMaxHp' | 'resetSurvivalRewards'>;
  currentBlockCenters(): Vec3[];
  ensureBuildMode(): void;
  rewind(): void;
  syncBuildEnabled(): void;
  syncInputPaused(): void;
}

export class SessionController {
  constructor(private readonly d: SessionDeps) {}

  private applyMods(next: GameMod[]): void {
    saveMods(next);
    modStore.setMods(next);
    const { active } = modStore.getState();
    this.d.assets.setCustomMaterials(active.blockMap);
    this.d.build.refreshCustomMaterials();
    const { material, disaster } = uiStore.getState();
    if (!isBuiltinMaterial(material) && !active.blockMap.has(material)) {
      this.d.build.setMaterial('wood');
      uiStore.setState({ material: 'wood' });
    }
    if (!isBuiltinDisaster(disaster) && !active.disasterMap.has(disaster)) {
      uiStore.setState({ disaster: 'earthquake' });
    }
  }

  toggleMod: GameActions['toggleMod'] = (id) => {
    this.d.ensureBuildMode();
    const next: GameMod[] = [];
    for (const m of modStore.getState().mods) {
      next.push(m.id === id ? Object.assign({}, m, { enabled: !m.enabled }) : m);
    }
    this.applyMods(next);
  };

  saveMod: GameActions['saveMod'] = (mod) => {
    this.d.ensureBuildMode();
    const mods = modStore.getState().mods;
    const exists = mods.some((m) => m.id === mod.id);
    const clean: GameMod = { ...mod, builtIn: false };
    const next = exists ? mods.map((m) => (m.id === mod.id ? clean : m)) : [...mods, clean];
    this.applyMods(next);
  };

  deleteMod: GameActions['deleteMod'] = (id) => {
    this.d.ensureBuildMode();
    const next = modStore.getState().mods.filter((m) => m.builtIn || m.id !== id);
    this.applyMods(next);
  };

  importMod: GameActions['importMod'] = (json) => {
    this.d.ensureBuildMode();
    const mods = modStore.getState().mods;
    const parsed = parseImportedMod(json, new Set(mods.map((m) => m.id)));
    if (!parsed.ok) return parsed;
    this.applyMods([...mods, parsed.mod]);
    return { ok: true };
  };

  /** Back to the standard 8x8 island (clearing a bigger village build) when leaving Village Island. */
  private restoreDefaultIsland(): void {
    this.d.village?.leave();
    if (getGridCells() === GRID_CELLS) return;
    this.d.setIsland?.(GRID_CELLS);
    this.d.build.loadGraph(emptyGraph());
  }

  /** Switches to the big island with the village build limits and starts the villagers. */
  private enterVillage(
    graph: BlueprintGraph | null,
    round: number,
    population?: number,
    sandbox = false,
  ): void {
    this.d.setIsland?.(VILLAGE_GRID_CELLS);
    this.d.build.setConstraints(null);
    this.d.build.loadGraph(graph ?? emptyGraph());
    this.d.build.setConstraints(sandbox ? null : VILLAGE_CONSTRAINTS);
    uiStore.setState({ villageOver: false, villageFailReason: null, villageCleared: false });
    this.d.village?.enter(round, population, sandbox);
  }

  /** Starts a challenge level (fresh island, its limits, disaster and strength) or free build with null. */
  selectLevel: GameActions['selectLevel'] = (id) => {
    this.d.ensureBuildMode();
    const level = id ? getLevel(id) : undefined;
    if (level && !uiStore.getState().unlocked.includes(level.id)) return;
    this.restoreDefaultIsland();
    levelStore.setState({ notice: null, justUnlocked: null });
    const s0 = uiStore.getState();
    if (!level) {
      this.d.build.setConstraints(null);
      uiStore.setState({
        playMode: 'creative',
        menuOpen: false,
        hasStarted: true,
        survivalOver: false,
        survivalFailReason: null,
        survivalLastReward: 0,
        levelId: null,
      });
      this.d.syncBuildEnabled();
      this.d.syncInputPaused();
      return;
    }
    this.d.build.setConstraints(null);
    this.d.build.loadGraph(level.start?.() ?? emptyGraph());
    this.d.build.setConstraints(level.constraints ?? null);
    const allowed = level.constraints?.materials;
    const first = allowed?.[0];
    let nextMaterial = s0.material;
    if (first && !allowed.includes(s0.material)) {
      this.d.build.setMaterial(first);
      nextMaterial = first;
    } else if (!isBuiltinMaterial(s0.material)) {
      this.d.build.setMaterial('wood');
      nextMaterial = 'wood';
    } else if (!s0.unlockedMaterials.includes(s0.material)) {
      const fallback = allowed?.find((m) => s0.unlockedMaterials.includes(m)) ?? 'wood';
      this.d.build.setMaterial(fallback);
      nextMaterial = fallback;
    }
    const nextArmor =
      s0.equippedArmor && s0.unlockedGear.includes(s0.equippedArmor) ? s0.equippedArmor : null;
    const nextWeapon =
      s0.equippedWeapon && s0.unlockedGear.includes(s0.equippedWeapon) ? s0.equippedWeapon : null;
    const playerMaxHp = this.d.progression.computeMaxHp(nextArmor);
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
    this.d.syncBuildEnabled();
    this.d.syncInputPaused();
  };

  openMenu: GameActions['openMenu'] = () => {
    uiStore.setState({ menuOpen: true });
    this.d.syncInputPaused();
  };

  resumeGame: GameActions['resumeGame'] = () => {
    if (!uiStore.getState().hasStarted) {
      this.startPlayMode(uiStore.getState().playMode);
      return;
    }
    uiStore.setState({ menuOpen: false });
    this.d.syncInputPaused();
  };

  saveGame: GameActions['saveGame'] = () => {
    const s = uiStore.getState();
    const ok = saveGameState({
      version: 1,
      savedAt: Date.now(),
      graph: this.d.build.getGraph(),
      playMode: s.playMode,
      exploreMode: s.exploreMode,
      moonGravity: s.moonGravity,
      turboMode: s.turboMode,
      megaStorm: s.megaStorm,
      ...pickDisasterAddons(s),
      multiplayerMode: s.multiplayerMode,
      disaster: s.disaster,
      strength: s.strength,
      survivalWave: s.survivalWave,
      battleTurn: s.battleTurn,
      battleRound: s.battleRound,
      battleP1Score: s.battleP1Score,
      battleP2Score: s.battleP2Score,
      villageRound: s.villageRound,
      villagePopulation: s.villagePopulation,
    });
    if (!ok) {
      levelStore.setState({ notice: 'Could not save right now (browser storage blocked).' });
      return;
    }
    uiStore.setState({ hasSave: true });
    levelStore.setState({ notice: 'Game saved!' });
    this.d.audio.resume();
    this.d.audio.playUnlock();
  };

  /**
   * Abandons the current game and returns to the main menu with a clean slate. Never writes a save, so
   * the previously saved game (and `hasSave`) is left exactly as it was. Persistent progression
   * (stars, points, unlocks, mods, audio) is not session state and is kept.
   */
  exitToMenu: GameActions['exitToMenu'] = () => {
    this.d.ensureBuildMode(); // rewinds any running or finished disaster
    this.restoreDefaultIsland();
    this.d.build.setConstraints(null);
    this.d.build.loadGraph(emptyGraph());
    this.d.progression.resetSurvivalRewards();
    this.d.companion.setMode('solo');
    this.d.firstPerson.setArrowKeysEnabled(true);
    const s0 = uiStore.getState();
    uiStore.setState({
      playMode: 'creative',
      exploreMode: false,
      moonGravity: false,
      turboMode: false,
      megaStorm: false,
      ...DISASTER_ADDONS_OFF,
      multiplayerMode: 'solo',
      battleTurn: 1,
      battleRound: 1,
      battleP1Score: 0,
      battleP2Score: 0,
      battleP1Done: false,
      battleP2Done: false,
      survivalWave: 1,
      survivalOver: false,
      survivalFailReason: null,
      villageOver: false,
      villageCleared: false,
      villageFailReason: null,
      survivalLastReward: 0,
      levelId: null,
      disaster: 'earthquake',
      strength: DEFAULT_STRENGTH,
      playerHp: s0.playerMaxHp,
      p2Hp: s0.p2MaxHp,
      p2Tool: 'block',
      p2Material: 'stone',
      menuOpen: true,
      hasStarted: false,
    });
    levelStore.setState({ notice: null, justUnlocked: null });
    this.d.firstPerson.spawn(this.d.currentBlockCenters());
    this.d.syncBuildEnabled();
    this.d.syncInputPaused();
  };

  continueGame: GameActions['continueGame'] = () => {
    const saved = loadGameState();
    if (!saved) {
      levelStore.setState({ notice: 'No saved game found yet!' });
      return;
    }
    this.d.ensureBuildMode();
    if (isVillagePlayMode(saved.playMode)) {
      this.enterVillage(
        saved.graph,
        saved.villageRound ?? 1,
        saved.villagePopulation,
        saved.playMode === 'villageCreative',
      );
    } else {
      this.restoreDefaultIsland();
      this.d.build.setConstraints(null);
      this.d.build.loadGraph(saved.graph);
    }
    this.d.companion.setMode(saved.multiplayerMode);
    this.d.firstPerson.setArrowKeysEnabled(!isTwoPlayerCoop(saved.multiplayerMode));
    const s0 = uiStore.getState();
    uiStore.setState({
      playMode: saved.playMode,
      exploreMode: saved.exploreMode,
      moonGravity: Boolean(saved.moonGravity),
      turboMode: Boolean(saved.turboMode),
      megaStorm: Boolean(saved.megaStorm),
      ...pickDisasterAddons(saved),
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
    this.d.firstPerson.spawn(this.d.currentBlockCenters());
    this.d.syncBuildEnabled();
    this.d.syncInputPaused();
    levelStore.setState({ notice: 'Loaded your saved village!' });
  };

  setExploreMode: GameActions['setExploreMode'] = (on) => {
    uiStore.setState({ exploreMode: on });
    this.d.syncBuildEnabled();
  };

  setAddon: GameActions['setAddon'] = (addon: AddonId, on) => {
    uiStore.setState({ [addon]: on });
  };

  setMultiplayerMode: GameActions['setMultiplayerMode'] = (mode: MultiplayerMode) => {
    this.d.companion.setMode(mode);
    this.d.firstPerson.setArrowKeysEnabled(!isTwoPlayerCoop(mode));
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
    this.d.rewind();
    this.d.build.clear();
    this.d.firstPerson.spawn(this.d.currentBlockCenters());
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
    this.d.rewind();
    this.d.build.clear();
    this.d.firstPerson.spawn(this.d.currentBlockCenters());
    uiStore.setState({
      battleTurn: 1,
      battleRound: 1,
      battleP1Score: 0,
      battleP2Score: 0,
      battleP1Done: false,
      battleP2Done: false,
    });
  };

  startPlayMode: GameActions['startPlayMode'] = (mode: PlayMode) => {
    this.d.ensureBuildMode();
    if (isVillagePlayMode(mode)) {
      this.startVillage(mode === 'villageCreative');
      return;
    }
    this.restoreDefaultIsland();
    this.d.build.setConstraints(null);
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
      this.d.syncBuildEnabled();
      this.d.syncInputPaused();
      return;
    }
    this.d.progression.resetSurvivalRewards();
    let nextMaterial = s0.material;
    if (!isBuiltinMaterial(nextMaterial) || !s0.unlockedMaterials.includes(nextMaterial)) {
      nextMaterial = 'wood';
      this.d.build.setMaterial('wood');
    }
    const nextArmor =
      s0.equippedArmor && s0.unlockedGear.includes(s0.equippedArmor) ? s0.equippedArmor : null;
    const nextWeapon =
      s0.equippedWeapon && s0.unlockedGear.includes(s0.equippedWeapon) ? s0.equippedWeapon : null;
    const playerMaxHp = this.d.progression.computeMaxHp(nextArmor);
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
    this.d.firstPerson.spawn(this.d.currentBlockCenters());
    this.d.syncBuildEnabled();
    this.d.syncInputPaused();
  };

  /** Village Island: a fresh, empty big island with the first round queued up. */
  private startVillage(sandbox: boolean): void {
    levelStore.setState({ notice: null, justUnlocked: null });
    const s0 = uiStore.getState();
    this.enterVillage(null, 1, sandbox ? SANDBOX_POPULATION : undefined, sandbox);
    let nextMaterial = s0.material;
    if (!isBuiltinMaterial(nextMaterial) || (!sandbox && !s0.unlockedMaterials.includes(nextMaterial))) {
      nextMaterial = 'wood';
    }
    this.d.build.setMaterial(nextMaterial);
    const nextArmor =
      s0.equippedArmor && s0.unlockedGear.includes(s0.equippedArmor) ? s0.equippedArmor : null;
    const nextWeapon =
      s0.equippedWeapon && s0.unlockedGear.includes(s0.equippedWeapon) ? s0.equippedWeapon : null;
    const playerMaxHp = this.d.progression.computeMaxHp(nextArmor);
    const round = getVillageRound(1);
    uiStore.setState({
      playMode: sandbox ? 'villageCreative' : 'village',
      levelId: null,
      menuOpen: false,
      hasStarted: true,
      survivalOver: false,
      survivalFailReason: null,
      survivalLastReward: 0,
      ...(sandbox ? {} : { disaster: round.disaster, strength: round.strength }),
      material: nextMaterial,
      equippedArmor: nextArmor,
      equippedWeapon: nextWeapon,
      playerMaxHp,
      playerHp: playerMaxHp,
    });
    this.d.firstPerson.spawn(this.d.currentBlockCenters());
    this.d.syncBuildEnabled();
    this.d.syncInputPaused();
  }

  nextSurvivalWave: GameActions['nextSurvivalWave'] = () => {
    const s = uiStore.getState();
    if (s.playMode !== 'survival' || s.survivalOver) return;
    const nextWaveNum = s.survivalWave + 1;
    const waveDef = getSurvivalWave(nextWaveNum);
    const healedHp = Math.min(s.playerMaxHp, Math.max(1, s.playerHp) + waveDef.healAmount);
    this.d.rewind();
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
}
