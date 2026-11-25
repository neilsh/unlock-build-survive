/** Procedural score data for the background music. Pure data: no Web Audio, safe to run headless. */

export type ThemeName = 'menu' | 'game';
export type Voice = 'lead' | 'bell' | 'bass' | 'stab' | 'pluck' | 'pad' | 'kick' | 'hat';

export interface NoteEvent {
  /** Start, in beats from the start of the loop. */
  beat: number;
  /** Length in beats. */
  length: number;
  voice: Voice;
  /** MIDI note number (ignored by the drum voices). */
  midi: number;
}

export interface Theme {
  bpm: number;
  /** Loop length in beats. */
  beats: number;
  /** Sorted by `beat`. */
  events: NoteEvent[];
}

const BEATS_PER_BAR = 4;
const SLOTS_PER_BAR = 8;
const SLOT = BEATS_PER_BAR / SLOTS_PER_BAR;
const REST = 0;

/** C - Am - F - G, twice: simple, bright and instantly toy-like. */
const CHORDS = [
  { root: 36, triad: [60, 64, 67] }, // C
  { root: 33, triad: [57, 60, 64] }, // Am
  { root: 41, triad: [57, 60, 65] }, // F
  { root: 43, triad: [59, 62, 67] }, // G
];
const BARS = 8;

const chordAt = (bar: number) => CHORDS[bar % CHORDS.length];

/** Eight eighth-note slots per bar; 0 is a rest. */
const GAME_MELODY: number[][] = [
  [76, REST, 79, REST, 76, 79, 84, REST],
  [76, REST, 81, REST, 79, 76, 72, REST],
  [77, REST, 81, REST, 84, 81, 77, REST],
  [74, REST, 79, REST, 83, 79, 74, 79],
  [79, 76, 79, 84, 88, 84, 79, 76],
  [81, REST, 84, REST, 88, 84, 81, REST],
  [84, 81, 77, 81, 84, REST, 81, REST],
  [83, REST, 79, REST, 74, REST, 79, REST],
];

const MENU_MELODY: number[][] = [
  [76, REST, REST, REST, 79, REST, REST, REST],
  [81, REST, REST, REST, 79, REST, 76, REST],
  [77, REST, REST, REST, 81, REST, REST, REST],
  [79, REST, REST, REST, 74, REST, REST, REST],
  [76, REST, 79, REST, 84, REST, REST, REST],
  [81, REST, REST, REST, 76, REST, REST, REST],
  [77, REST, 81, REST, 84, REST, 81, REST],
  [83, REST, REST, REST, 79, REST, REST, REST],
];

function addMelody(events: NoteEvent[], rows: number[][], voice: Voice, length: number): void {
  rows.forEach((row, bar) => {
    row.forEach((midi, slot) => {
      if (midi === REST) return;
      events.push({ beat: bar * BEATS_PER_BAR + slot * SLOT, length, voice, midi });
    });
  });
}

function sorted(events: NoteEvent[]): NoteEvent[] {
  return events.toSorted((a, b) => a.beat - b.beat);
}

function buildGameTheme(): Theme {
  const events: NoteEvent[] = [];
  addMelody(events, GAME_MELODY, 'lead', 0.45);
  for (let bar = 0; bar < BARS; bar++) {
    const start = bar * BEATS_PER_BAR;
    const { root, triad } = chordAt(bar);
    // Bouncy oom-pah bass.
    const bass = [root, REST, root + 12, REST, root, REST, root + 7, REST];
    bass.forEach((midi, slot) => {
      if (midi !== REST) events.push({ beat: start + slot * SLOT, length: 0.4, voice: 'bass', midi });
    });
    // Chord stabs on beats 2 and 4.
    for (const beat of [1, 3]) {
      for (const midi of triad) events.push({ beat: start + beat, length: 0.25, voice: 'stab', midi });
    }
    // Light drums.
    for (const beat of [0, 2]) events.push({ beat: start + beat, length: 0.2, voice: 'kick', midi: 0 });
    for (let slot = 1; slot < SLOTS_PER_BAR; slot += 2) {
      events.push({ beat: start + slot * SLOT, length: 0.1, voice: 'hat', midi: 0 });
    }
  }
  return { bpm: 128, beats: BARS * BEATS_PER_BAR, events: sorted(events) };
}

function buildMenuTheme(): Theme {
  const events: NoteEvent[] = [];
  addMelody(events, MENU_MELODY, 'bell', 2);
  for (let bar = 0; bar < BARS; bar++) {
    const start = bar * BEATS_PER_BAR;
    const { triad } = chordAt(bar);
    for (const midi of triad) {
      events.push({ beat: start, length: BEATS_PER_BAR, voice: 'pad', midi: midi - 12 });
    }
    // Gentle up-and-down arpeggio.
    const order = [0, 1, 2, 1, 0, 1, 2, 1];
    order.forEach((idx, slot) => {
      events.push({ beat: start + slot * SLOT, length: 0.9, voice: 'pluck', midi: triad[idx] });
    });
  }
  return { bpm: 84, beats: BARS * BEATS_PER_BAR, events: sorted(events) };
}

export const THEMES: Record<ThemeName, Theme> = {
  menu: buildMenuTheme(),
  game: buildGameTheme(),
};

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
