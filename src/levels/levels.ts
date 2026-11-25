/**
 * Challenge level data. A level is a disaster to survive, with optional build limits and a star
 * target. Game applies `constraints` via `BuildController.setConstraints`, runs the level's own
 * disaster and strength, and unlocks the next level when `goalStars` is reached (see progress.ts).
 * Levels unlock in array order.
 */
import type {
  BlueprintGraph,
  BuildConstraints,
  BuiltinDisasterType,
  Stars,
  Strength,
} from '../types/blueprint';
import { PRESETS } from '../types/presets';

export interface Level {
  id: string;
  title: string;
  /** One kid-friendly sentence shown in the level panel. */
  blurb: string;
  disaster: BuiltinDisasterType;
  strength: Strength;
  seed?: number;
  constraints?: BuildConstraints;
  /** The build must be at least this many layers tall to start the disaster. */
  minHeight?: number;
  /** Optional starting build; omitted means an empty island. */
  start?: () => BlueprintGraph;
  /** Stars needed to unlock the next level. */
  goalStars: Stars;
}

export const LEVELS: readonly Level[] = [
  {
    id: 'first-shake',
    title: 'First Shake',
    blurb: 'Build a little home for Mouse and see if it can handle a gentle wobble.',
    disaster: 'earthquake',
    strength: 'gentle',
    goalStars: 1,
  },
  {
    id: 'hail-hut',
    title: 'Hail Hut',
    blurb: 'Tiny ice balls are on the way! Give Hedgehog a snug roof to hide under.',
    disaster: 'hail',
    strength: 'gentle',
    constraints: { maxBlocks: 12 },
    goalStars: 1,
  },
  {
    id: 'bunny-burrow',
    title: "Bunny's Burrow",
    blurb: 'A bigger hailstorm is coming. Use at most 12 blocks to keep Bunny cozy.',
    disaster: 'hail',
    strength: 'medium',
    constraints: { maxBlocks: 12 },
    goalStars: 2,
  },
  {
    id: 'squirrel-lookout',
    title: 'Squirrel Lookout',
    blurb: 'Squirrel wants a tall lookout, at least 4 blocks high. Brace it so it does not wobble!',
    disaster: 'earthquake',
    strength: 'medium',
    constraints: { maxBlocks: 14 },
    minHeight: 4,
    goalStars: 1,
  },
  {
    id: 'windy-meadow',
    title: 'Windy Meadow',
    blurb: 'A breezy day! Help Duckling build something that stays put.',
    disaster: 'hurricane',
    strength: 'gentle',
    constraints: { maxBlocks: 14 },
    goalStars: 2,
  },
  {
    id: 'bamboo-bungalow',
    title: 'Bamboo Bungalow',
    blurb: 'Panda only has bamboo and foam. Build light, build smart, and hold on in the wind.',
    disaster: 'hurricane',
    strength: 'medium',
    constraints: { maxBlocks: 16, materials: ['bamboo', 'foam'] },
    goalStars: 2,
  },
  {
    id: 'wobbly-tower',
    title: 'Wobbly Tower Rescue',
    blurb: 'Fox built this tall tower, but it wobbles. Add braces and blocks to save it!',
    disaster: 'earthquake',
    strength: 'medium',
    constraints: { maxBlocks: 12 },
    minHeight: 4,
    start: PRESETS.tower,
    goalStars: 2,
  },
  {
    id: 'duck-pond',
    title: 'Duck Pond Flood',
    blurb: 'The pond is rising! Keep Otter and friends high and dry.',
    disaster: 'flood',
    strength: 'medium',
    constraints: { maxBlocks: 16 },
    goalStars: 2,
  },
  {
    id: 'stone-castle',
    title: 'Stone Soup Castle',
    blurb: 'Badger loves stone and wood. Build a strong, tall castle for a big earthquake.',
    disaster: 'earthquake',
    strength: 'strong',
    constraints: { maxBlocks: 18, materials: ['stone', 'wood'] },
    minHeight: 3,
    goalStars: 1,
  },
  {
    id: 'critter-haven',
    title: 'Disaster Village',
    blurb: 'The big one! A mighty storm is coming. Build a village strong enough for anything.',
    disaster: 'hurricane',
    strength: 'strong',
    constraints: { maxBlocks: 20 },
    minHeight: 4,
    goalStars: 2,
  },
  {
    id: 'blizzard-barn',
    title: 'Blizzard Barn',
    blurb: 'A fierce snow storm is blowing in! Keep the village cozy against icy blasts.',
    disaster: 'snow_storm',
    strength: 'medium',
    constraints: { maxBlocks: 16 },
    goalStars: 1,
  },
  {
    id: 'flame-vortex',
    title: 'Flame Vortex',
    blurb: 'A spinning fire tornado hurls fireballs! Hold the line with smart bracing or gear.',
    disaster: 'fire_tornado',
    strength: 'medium',
    constraints: { maxBlocks: 18 },
    goalStars: 2,
  },
  {
    id: 'bandit-raid',
    title: 'Bandit Raid',
    blurb: 'Raiders are blasting the village from every side! Reinforce your walls or zap them.',
    disaster: 'raid',
    strength: 'medium',
    constraints: { maxBlocks: 18 },
    goalStars: 2,
  },
  {
    id: 'meteor-finale',
    title: 'Meteor Finale',
    blurb: 'Flaming meteors from the sky! Combine strong frames, shields, and lasers to survive.',
    disaster: 'meteor',
    strength: 'strong',
    constraints: { maxBlocks: 20 },
    minHeight: 3,
    goalStars: 2,
  },
];

export function getLevel(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}
