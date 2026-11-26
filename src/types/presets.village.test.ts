import { describe, expect, it } from 'vitest';
import { BASE_PRESETS, UNLOCKABLE_PRESETS, VILLAGE_PRESETS, villagePresetBlock } from './presets';

describe('village quick-builders', () => {
  it('are exactly the four starter quick-builders', () => {
    expect(VILLAGE_PRESETS).toHaveLength(4);
    expect([...VILLAGE_PRESETS]).toEqual([...BASE_PRESETS]);
  });

  it('are blocked unless Explore Mode is on', () => {
    for (const p of VILLAGE_PRESETS) expect(villagePresetBlock(p, false)).toBe('needs-explore');
  });

  it('allow the four starters in Explore Mode and refuse the rest', () => {
    for (const p of VILLAGE_PRESETS) expect(villagePresetBlock(p, true)).toBeNull();
    for (const p of UNLOCKABLE_PRESETS) expect(villagePresetBlock(p, true)).toBe('not-in-village');
  });
});
