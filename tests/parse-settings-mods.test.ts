import { describe, expect, it } from 'vitest';
import { parseMpSettingsReady, parseSlotMods } from '../src/irc/parse-settings.js';

describe('parseSlotMods', () => {
  it('parses bracket lists', () => {
    expect(parseSlotMods('Slot 1 Ready https://osu.ppy.sh/u/1 A [Hidden, HardRock]'))
      .toEqual(['Hidden', 'HardRock']);
    expect(parseSlotMods('Slot 1 Ready https://osu.ppy.sh/u/1 A')).toEqual([]);
  });
});

describe('parseMpSettingsReady mods', () => {
  it('attaches mods to players', () => {
    const players = parseMpSettingsReady([
      'Slot 1  Ready https://osu.ppy.sh/u/10 PlayerOne [Hidden]',
      'Slot 9  Ready https://osu.ppy.sh/u/20 PlayerTwo [HardRock]',
    ].join('\n'));
    expect(players[0]?.mods).toEqual(['Hidden']);
    expect(players[1]?.mods).toEqual(['HardRock']);
  });
});
