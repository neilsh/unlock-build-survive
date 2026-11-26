import { DEFAULT_STRENGTH, DISASTER_SECONDS } from '../types/blueprint';
import { BASE_MATERIALS } from '../types/materials';
import { BASE_PRESETS } from '../types/presets';
import { BASE_GEAR, DEFAULT_WEAPON } from '../types/gear';
import { DEFAULT_AUDIO_SETTINGS } from './audioSettings';
import type { UIState } from '../types/ui';
import { createStore, useStoreSelector } from './createStore';

/** The only bridge between the engine (writes) and React (reads). */
export const uiStore = createStore<UIState>({
  playMode: 'creative',
  exploreMode: false,
  moonGravity: false,
  turboMode: false,
  megaStorm: false,
  multiplayerMode: 'solo',
  battleTurn: 1,
  battleRound: 1,
  battleP1Score: 0,
  battleP2Score: 0,
  battleP1Done: false,
  battleP2Done: false,
  menuOpen: true,
  hasStarted: false,
  hasSave: false,
  survivalWave: 1,
  survivalBestWave: 0,
  survivalOver: false,
  survivalFailReason: null,
  survivalLastReward: 0,
  tool: 'block',
  material: 'wood',
  mirrorX: false,
  disaster: 'earthquake',
  strength: DEFAULT_STRENGTH,
  mode: 'build',
  timeRemaining: DISASTER_SECONDS,
  standingRatio: 1,
  stars: 0,
  standingHistory: [],
  levelId: null,
  unlocked: [],
  points: 0,
  unlockedMaterials: [...BASE_MATERIALS],
  unlockedPresets: [...BASE_PRESETS],
  unlockedGear: [...BASE_GEAR],
  equippedArmor: null,
  equippedWeapon: DEFAULT_WEAPON,
  firstBrokenId: null,
  muted: false,
  musicVolume: DEFAULT_AUDIO_SETTINGS.musicVolume,
  canUndo: false,
  azimuth: 0,
  firstPerson: true,
  gamepadConnected: false,
  gamepadLabel: null,
  gamepadStandard: true,
  playerHp: 100,
  playerMaxHp: 100,
  damageFlash: 0,
  p2Hp: 100,
  p2MaxHp: 100,
  p2DamageFlash: 0,
  p2Tool: 'block',
  p2Material: 'stone',
});

const selectAll = (state: UIState): UIState => state;

/** Subscribe to a slice of UI state; re-renders only when the selection changes shallowly. */
export function useUIState(): UIState;
export function useUIState<S>(selector: (state: UIState) => S): S;
export function useUIState(selector: (state: UIState) => unknown = selectAll): unknown {
  return useStoreSelector(uiStore, selector);
}
