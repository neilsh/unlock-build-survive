/**
 * Points, shop unlocks, gear and level/survival results. Owns the persisted progression and writes
 * the matching fields into the UI stores. Talks to the engine only through `ProgressionDeps`.
 */
import { levelStore } from '../../levels/levelStore';
import { LEVELS } from '../../levels/levels';
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
  type BestStars,
} from '../../levels/progress';
import { getSurvivalWave } from '../../levels/survival';
import { uiStore } from '../../state/store';
import type { MaterialType, PresetName, Telemetry } from '../../types/blueprint';
import {
  ARMORS,
  WEAPONS,
  isArmorId,
  isWeaponId,
  type ArmorDef,
  type ArmorId,
  type GearId,
  type WeaponDef,
  type WeaponId,
} from '../../types/gear';
import type { GameActions } from '../../types/ui';
import type { AudioSynth } from '../AudioSynth';
import { PHYSICS_TUNING } from '../physics/tuning';

export interface ProgressionDeps {
  audio: Pick<AudioSynth, 'resume' | 'playUnlock'>;
  isSimRunning(): boolean;
}

/** Overrides for the freshly computed unlock state when recomputing available points. */
interface PointsOverride {
  best?: BestStars;
  materials?: MaterialType[];
  gear?: GearId[];
  presets?: PresetName[];
}

export class ProgressionController {
  private survivalBonusPoints = 0;
  private rewardedSurvivalWave = 0;
  private lastMode: Telemetry['mode'] = 'build';

  constructor(private readonly d: ProgressionDeps) {}

  /** Loads saved progress into the stores (call once at startup). */
  hydrate(): void {
    const best = loadBest(LEVELS);
    const unlockedMaterials = loadUnlockedMaterials();
    const unlockedPresets = loadUnlockedPresets();
    const gear = loadGear();
    const survival = loadSurvival();
    this.survivalBonusPoints = survival.bonusPoints;
    const playerMaxHp = this.computeMaxHp(gear.armor);
    levelStore.setState({ best });
    uiStore.setState({
      survivalBestWave: survival.bestWave,
      unlocked: computeUnlocked(LEVELS, best),
      unlockedMaterials,
      unlockedPresets,
      unlockedGear: gear.unlocked,
      equippedArmor: gear.armor,
      equippedWeapon: gear.weapon,
      playerMaxHp,
      playerHp: playerMaxHp,
      points: this.recomputePoints({
        best,
        materials: unlockedMaterials,
        gear: gear.unlocked,
        presets: unlockedPresets,
      }),
    });
  }

  /** Available shop points from the current unlock state, with optional overrides. */
  recomputePoints(o: PointsOverride = {}): number {
    const s = uiStore.getState();
    return computeAvailablePoints(
      LEVELS,
      o.best ?? levelStore.getState().best,
      o.materials ?? s.unlockedMaterials,
      o.gear ?? s.unlockedGear,
      o.presets ?? s.unlockedPresets,
      this.survivalBonusPoints,
    );
  }

  setLastMode(mode: Telemetry['mode']): void {
    this.lastMode = mode;
  }

  resetSurvivalRewards(): void {
    this.rewardedSurvivalWave = 0;
  }

  getEquippedArmor(): ArmorDef | null {
    const id = uiStore.getState().equippedArmor;
    return id ? ARMORS[id] : null;
  }

  getEquippedWeapon(): WeaponDef | null {
    const id = uiStore.getState().equippedWeapon;
    return id ? WEAPONS[id] : null;
  }

  computeMaxHp(armorId: ArmorId | null): number {
    return PHYSICS_TUNING.player.maxHp + (armorId ? ARMORS[armorId].bonusHp : 0);
  }

  /** On the frame a level or survival wave finishes, records stars/wave rewards and updates points. */
  recordLevelResult(mode: Telemetry['mode'], stars: Telemetry['stars']): void {
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
        points: this.recomputePoints({ best: out.best }),
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
          points: this.recomputePoints(),
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

  unlockMaterial: GameActions['unlockMaterial'] = (m) => {
    const s0 = uiStore.getState();
    const res = tryUnlockMaterial(
      LEVELS,
      levelStore.getState().best,
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
      points: this.recomputePoints({ materials: res.unlocked }),
    });
    this.d.audio.resume();
    this.d.audio.playUnlock();
    return true;
  };

  unlockPreset: GameActions['unlockPreset'] = (p) => {
    const s0 = uiStore.getState();
    const res = tryUnlockPreset(
      LEVELS,
      levelStore.getState().best,
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
      points: this.recomputePoints({ presets: res.unlocked }),
    });
    this.d.audio.resume();
    this.d.audio.playUnlock();
    return true;
  };

  unlockGear: GameActions['unlockGear'] = (id) => {
    const s0 = uiStore.getState();
    const res = tryUnlockGear(
      LEVELS,
      levelStore.getState().best,
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
      points: this.recomputePoints({ gear: res.unlocked }),
    });
    this.d.audio.resume();
    this.d.audio.playUnlock();
    return true;
  };

  equipGear: GameActions['equipGear'] = (id, slot) => {
    const s0 = uiStore.getState();
    if (id !== null) {
      if (!this.isCreativeSandboxNow() && !s0.unlockedGear.includes(id)) return;
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
    const playerHp = !this.d.isSimRunning()
      ? playerMaxHp
      : Math.min(playerMaxHp, s0.playerHp + Math.max(0, playerMaxHp - prevMax));
    uiStore.setState({
      equippedArmor: nextArmor,
      equippedWeapon: nextWeapon,
      playerMaxHp,
      playerHp,
    });
  };

  private isCreativeSandboxNow(): boolean {
    const s = uiStore.getState();
    return s.playMode === 'creative' && s.levelId === null;
  }
}
