import { describe, expect, it } from 'vitest';
import {
  teamModeCode,
  winConditionCode,
  isAccuracyWinCondition,
  rankingMetricFromWinCondition,
  rankingValueFromPlayerLine,
} from '../src/irc/mp-modes.js';

describe('mp modes', () => {
  it('maps team and win condition codes', () => {
    expect(teamModeCode('HeadToHead')).toBe(0);
    expect(teamModeCode('TeamVS')).toBe(2);
    expect(winConditionCode('Score')).toBe(0);
    expect(winConditionCode('Accuracy')).toBe(1);
    expect(isAccuracyWinCondition('acc')).toBe(true);
  });

  it('ranking value is 0 when metric missing (any WC)', () => {
    expect(rankingMetricFromWinCondition('Combo')).toBe('combo');
    expect(rankingValueFromPlayerLine('score', {})).toBe(0);
    expect(rankingValueFromPlayerLine('accuracy', {})).toBe(0);
    expect(rankingValueFromPlayerLine('combo', {})).toBe(0);
    expect(rankingValueFromPlayerLine('accuracy', { accuracy: 0.98 })).toBe(980_000);
    expect(rankingValueFromPlayerLine('combo', { maxCombo: 412 })).toBe(412);
    expect(rankingValueFromPlayerLine('score', { score: 1_000_000 })).toBe(1_000_000);
  });
});
