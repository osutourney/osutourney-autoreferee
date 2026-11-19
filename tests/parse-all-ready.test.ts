import { describe, expect, it } from 'vitest';
import { isAllPlayersReadyMessage } from '../src/irc/parse-all-ready.js';

describe('isAllPlayersReadyMessage', () => {
  it('detects BanchoBot all ready', () => {
    expect(isAllPlayersReadyMessage('All players are ready')).toBe(true);
    expect(isAllPlayersReadyMessage('All players are ready!')).toBe(true);
    expect(isAllPlayersReadyMessage('lehenna changed to Ready')).toBe(false);
  });
});
