import type {
  Azimuth,
  DisasterType,
  GameMode,
  MaterialType,
  PresetName,
  Stars,
  Strength,
  ToolType,
} from './blueprint';
import type { ArmorId, GearId, GearSlot, WeaponId } from './gear';
import type { GameMod } from '../mods/mods';

export type PlayMode = 'creative' | 'survival' | 'village';
export type MultiplayerMode = 'solo' | 'coop' | 'split' | 'battle' | 'bot';

/** Modes where a second human drives the Player 2 avatar (shared screen `coop`, or own view `split`). */
export const isTwoPlayerCoop = (mode: MultiplayerMode): boolean => mode === 'coop' || mode === 'split';
export type AddonId = 'moonGravity' | 'turboMode' | 'megaStorm';

/** Everything the HUD renders. Written by the engine side, read by React. */
export interface UIState {
  playMode: PlayMode;
  exploreMode: boolean;
  moonGravity: boolean;
  turboMode: boolean;
  megaStorm: boolean;
  multiplayerMode: MultiplayerMode;
  battleTurn: 1 | 2;
  battleRound: number;
  battleP1Score: number;
  battleP2Score: number;
  battleP1Done: boolean;
  battleP2Done: boolean;
  menuOpen: boolean;
  hasStarted: boolean;
  hasSave: boolean;
  survivalWave: number;
  survivalBestWave: number;
  survivalOver: boolean;
  survivalFailReason: string | null;
  survivalLastReward: number;
  /** Village Island: current round, villagers living there / still standing, and spare shelter beds. */
  villageRound: number;
  villagePopulation: number;
  villageAlive: number;
  villageBeds: number;
  villageBestRound: number;
  /** True once a villager was knocked out (any death loses the village). */
  villageOver: boolean;
  villageFailReason: string | null;
  /** True when every villager got through the current round's disaster. */
  villageCleared: boolean;
  tool: ToolType;
  material: MaterialType;
  mirrorX: boolean;
  disaster: DisasterType;
  strength: Strength;
  mode: GameMode;
  /** Seconds left in the disaster countdown (DISASTER_SECONDS when idle). */
  timeRemaining: number;
  /** Fraction (0..1) of pieces still standing (see Telemetry.standingRatio); 1 while building. */
  standingRatio: number;
  /** Star rating of the current/finished run (0 while building). */
  stars: Stars;
  /** standingRatio sampled by `Game.tick` during a run (for the HUD stability graph); empty when idle. */
  standingHistory: number[];
  /** Id of the active challenge level, or null in free build. */
  levelId: string | null;
  /** Ids of unlocked levels. */
  unlocked: string[];
  /** Unspent shop points earned from challenge stars. */
  points: number;
  /** Materials/tech blocks currently unlocked for building. */
  unlockedMaterials: MaterialType[];
  /** Quick-builder presets currently unlocked. */
  unlockedPresets: PresetName[];
  /** First-person gear (armor & weapons) currently unlocked. */
  unlockedGear: GearId[];
  equippedArmor: ArmorId | null;
  equippedWeapon: WeaponId | null;
  /** Id of the first piece that broke in the current run, for the HUD and highlight. */
  firstBrokenId: string | null;
  muted: boolean;
  /** Background music volume, 0..1. */
  musicVolume: number;
  canUndo: boolean;
  azimuth: Azimuth;
  firstPerson: boolean;
  gamepadConnected: boolean;
  /** Id string of the pad driving the game (for the menu status line), or null when none is detected. */
  gamepadLabel: string | null;
  /** False when the browser reports a non-standard button layout for the active pad. */
  gamepadStandard: boolean;
  playerHp: number;
  playerMaxHp: number;
  /** Incremented whenever the player takes a sharp hit (triggers HUD flash). */
  damageFlash: number;
  /** Player 2's own health, tool and material in 2P split-screen. */
  p2Hp: number;
  p2MaxHp: number;
  p2DamageFlash: number;
  p2Tool: ToolType;
  p2Material: MaterialType;
}

/** Everything the HUD can ask the engine to do. Implemented by `Game`. */
export interface GameActions {
  setTool(t: ToolType): void;
  setMaterial(m: MaterialType): void;
  /** Player 2's own tool / material (2P split-screen). */
  setP2Tool(t: ToolType): void;
  setP2Material(m: MaterialType): void;
  setMirrorX(on: boolean): void;
  setDisaster(d: DisasterType): void;
  setStrength(s: Strength): void;
  /** Starts a challenge level, or free build with null. */
  selectLevel(id: string | null): void;
  /** Spends points to unlock a tech block; returns true when newly unlocked. */
  unlockMaterial(m: MaterialType): boolean;
  /** Spends points to unlock a quick-builder preset; returns true when newly unlocked. */
  unlockPreset(p: PresetName): boolean;
  /** Spends points to unlock first-person armor or weapon; returns true when newly unlocked. */
  unlockGear(id: GearId): boolean;
  /** Equips or unequips an owned armor or weapon in its slot. */
  equipGear(id: GearId | null, slot: GearSlot): void;
  /** Fires the equipped first-person weapon, if any and off cooldown. */
  fireWeapon(): void;
  toggleMod(id: string): void;
  saveMod(mod: GameMod): void;
  deleteMod(id: string): void;
  importMod(json: string): { ok: boolean; error?: string };
  loadPreset(p: PresetName): void;
  undo(): void;
  clearIsland(): void;
  /** Starts the selected disaster, or rewinds if one is running/finished. */
  toggleDisaster(): void;
  setCameraAzimuth(deg: Azimuth): void;
  setFirstPerson(on: boolean): void;
  setMuted(muted: boolean): void;
  setMusicVolume(volume: number): void;
  setModalOpen(open: boolean): void;
  openMenu(): void;
  resumeGame(): void;
  saveGame(): void;
  /** Leaves the current game for the main menu, discarding unsaved progress (the saved game is untouched). */
  exitToMenu(): void;
  continueGame(): void;
  startPlayMode(mode: PlayMode): void;
  setExploreMode(on: boolean): void;
  setAddon(addon: AddonId, on: boolean): void;
  setMultiplayerMode(mode: MultiplayerMode): void;
  nextBattleTurn(): void;
  resetBattle(): void;
  setP2Control(patch: Partial<{ moveX: number; moveY: number; jump: boolean; fire: boolean }>): void;
  /** On-screen joystick for the local player: strafe (right +) and forward (+), each -1..1. */
  setTouchMove(strafe: number, forward: number): void;
  setTouchJump(jump: boolean): void;
  nextSurvivalWave(): void;
  restartSurvival(): void;
}
