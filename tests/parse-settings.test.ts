import { describe, expect, it } from 'vitest';
import { parseMpSettingsReady } from '../src/irc/parse-settings.js';

describe('parseMpSettingsReady', () => {
  it('parses slots and infers teams', () => {
    const players = parseMpSettingsReady([
      'Slot 1  Ready https://osu.ppy.sh/u/10 PlayerOne',
      'Slot 9  Not Ready https://osu.ppy.sh/u/20 PlayerTwo',
    ].join('\n'));
    expect(players).toEqual([
      { slot: 1, ready: true, osuId: '10', username: 'PlayerOne', team: 'red', mods: [] },
      { slot: 9, ready: false, osuId: '20', username: 'PlayerTwo', team: 'blue', mods: [] },
    ]);
  });
});
