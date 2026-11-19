import { describe, expect, it } from 'vitest';
import { isMatchFinishedMessage } from '../src/irc/parse-match-finished.js';

describe('isMatchFinishedMessage', () => {
  it('detects BanchoBot match finished', () => {
    expect(isMatchFinishedMessage('The match has finished!')).toBe(true);
    expect(isMatchFinishedMessage('the match has finished')).toBe(true);
    expect(isMatchFinishedMessage('Slot 1 Ready')).toBe(false);
  });
});
