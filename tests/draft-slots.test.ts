import { describe, expect, it } from 'vitest';
import { classicDraftPreset } from '../src/draft/presets.js';
import { filterAvailableSlots } from '../src/draft/slots.js';
import type { DraftRuntime, MappoolSlot } from '../src/draft/types.js';

const pool: MappoolSlot[] = [
  { slot: 'NM1', beatmapId: '1', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
  { slot: 'NM2', beatmapId: '2', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
  { slot: 'TB', beatmapId: '9', mods: [], unbannable: true, unprotectable: true, tiebreaker: true },
];

describe('draft slots + classic preset', () => {
  it('builds classic script', () => {
    const preset = classicDraftPreset({ protectsPerTeam: 1, bansPerTeam: 1, firstTo: 2 });
    expect(preset.draftScript?.[0]?.type).toBe('protect');
    expect(preset.draftScript?.at(-1)?.type).toBe('pick_play');
  });

  it('hides banned and tb from picks', () => {
    const draft: DraftRuntime = {
      script: [],
      scriptIndex: 0,
      actionsDoneInPhase: 0,
      protects: [],
      bans: [{ side: 'red', slot: 'NM1', beatmapId: '1', kind: 'ban' }],
      picks: [],
      score: { red: 0, blue: 0 },
      mapsPlayed: 0,
    };
    const picks = filterAvailableSlots(pool, draft, 'pick');
    expect(picks.map((row) => row.slot)).toEqual(['NM2']);
    expect(filterAvailableSlots(pool, draft, 'tb').map((row) => row.slot)).toEqual(['TB']);
  });
});
