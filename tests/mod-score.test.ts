import { describe, expect, it } from 'vitest';
import {
  applyModMultipliers,
  validateFmRules,
} from '../src/score/mod-score.js';

describe('applyModMultipliers', () => {
  it('products HD×HR', () => {
    expect(applyModMultipliers(1_000_000, ['HD', 'HR'])).toBe(Math.round(1_000_000 * 1.06 * 1.12));
  });
});

describe('validateFmRules', () => {
  it('requires HD-family + HR-family for duos', () => {
    const rules = {
      scope: 'lobby' as const,
      requiredGroups: [
        { anyOf: [['HD'], ['EZ'], ['EZ', 'HD']], count: 1 },
        { anyOf: [['HR'], ['HR', 'HD']], count: 1 },
      ],
    };
    expect(validateFmRules(
      [{ mods: ['HD'] }, { mods: ['HR'] }],
      rules,
    ).ok).toBe(true);
    expect(validateFmRules(
      [{ mods: ['HD'] }, { mods: ['HD'] }],
      rules,
    ).ok).toBe(false);
  });
});
