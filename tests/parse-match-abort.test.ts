import { describe, expect, it } from 'vitest';
import { isMatchAbortedMessage, parsePlayerLeft } from '../src/irc/parse-match-abort.js';

describe('abort parsers', () => {
  it('detects aborted match', () => {
    expect(isMatchAbortedMessage('Aborted the match')).toBe(true);
    expect(isMatchAbortedMessage('The match has been aborted!')).toBe(true);
    expect(isMatchAbortedMessage('The match has finished!')).toBe(false);
  });

  it('parses player left', () => {
    expect(parsePlayerLeft('lehenna left the game.')).toBe('lehenna');
    expect(parsePlayerLeft('lehenna left the match')).toBe('lehenna');
    expect(parsePlayerLeft('lehenna joined in slot 1')).toBeUndefined();
  });
});
