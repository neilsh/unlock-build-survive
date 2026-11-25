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
import { emptyGraph, isBuiltinDisaster, type Vec3 } from '../../types/blueprint';
import { isBuiltinMaterial } from '../../types/materials';
import type { AddonId, GameActions, MultiplayerMode, PlayMode } from '../../types/ui';
import type { AudioSynth } from '../AudioSynth';
import type { BuildController } from '../BuildController';
import type { CompanionManager } from '../CompanionManager';
import type { FirstPersonController } from '../FirstPersonController';
import type { ProceduralAssets } from '../ProceduralAssets';
import type { ProgressionController } from './ProgressionController';

export interface SessionDeps {
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

  /** Starts a challenge level (fresh island, its limits, disaster and strength) or free build with null. */
  selectLevel: GameActions['selectLevel'] = (id) => {
    this.d.ensureBuildMode();
    const level = id ? getLevel(id) : undefined;
    if (level && !uiStore.getState().unlocked.includes(level.id)) return;
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
    this.d.audio.resume();
    this.d.audio.playUnlock();
  };

  continueGame: GameActions['continueGame'] = () => {
    const saved = loadGameState();
    if (!saved) {
      levelStore.setState({ notice: 'No saved game found yet!' });
      return;
    }
    this.d.ensureBuildMode();
    this.d.build.setConstraints(null);
    this.d.build.loadGraph(saved.graph);
    this.d.companion.setMode(saved.multiplayerMode);
    this.d.firstPerson.setArrowKeysEnabled(saved.multiplayerMode !== 'coop');
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
    this.d.firstPerson.setArrowKeysEnabled(mode !== 'coop');
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
