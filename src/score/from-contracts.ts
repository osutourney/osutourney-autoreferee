/**
 * GENERATED — do not edit by hand.
 * Source: packages/contracts/src/mod-score.ts
 * Regenerate: pnpm autoreferee:sync-helpers
 */

import { z } from 'zod';

/** Canonical short mod codes used in rules / multipliers. */
export const MOD_CODE_ALIASES: Record<string, string> = {
  HD: 'HD',
  HIDDEN: 'HD',
  HR: 'HR',
  HARDROCK: 'HR',
  EZ: 'EZ',
  EASY: 'EZ',
  DT: 'DT',
  DOUBLETIME: 'DT',
  HT: 'HT',
  HALFTIME: 'HT',
  FL: 'FL',
  FLASHLIGHT: 'FL',
  NF: 'NF',
  NOFAIL: 'NF',
  SD: 'SD',
  SUDDENDEATH: 'SD',
  SO: 'SO',
  SPUNOUT: 'SO',
  NC: 'NC',
  NIGHTCORE: 'NC',
  FI: 'FI',
  FADEIN: 'FI',
};

export const DEFAULT_MOD_MULTIPLIERS: Record<string, number> = {
  HD: 1.06,
  HR: 1.12,
  EZ: 1.0,
  DT: 1.0,
  HT: 1.0,
  FL: 1.12,
  NF: 1.0,
  SD: 1.0,
  NC: 1.0,
};

export function normalizeModCode(raw: string): string {
  const key = raw.replace(/^\+/, '').trim().toUpperCase();
  return MOD_CODE_ALIASES[key] ?? key;
}

export function normalizeModList(mods: string[]): string[] {
  const out: string[] = [];
  for (const mod of mods) {
    const code = normalizeModCode(mod);
    if (!code || code === 'NM' || code === 'NONE' || code === 'FREEMOD' || code === 'FM') continue;
    if (!out.includes(code)) out.push(code);
  }
  return out.sort();
}

export const modMultipliersSchema = z.record(z.number().positive());
export type ModMultipliers = z.infer<typeof modMultipliersSchema>;

/**
 * Apply configured multipliers to a raw score (product of per-mod factors).
 * Unknown mods use factor 1. Empty mods (NM) → raw unchanged.
 */
export function applyModMultipliers(
  rawScore: number,
  mods: string[],
  multipliers: ModMultipliers = DEFAULT_MOD_MULTIPLIERS,
): number {
  const normalized = normalizeModList(mods);
  let factor = 1;
  for (const mod of normalized) {
    factor *= multipliers[mod] ?? 1;
  }
  return Math.round(rawScore * factor);
}

/** Alias used by import / docs. */
export const scoreWithMods = applyModMultipliers;

export type RankingMetric = 'score' | 'accuracy' | 'combo' | 'scorev2';

export function rankingMetricFromWinCondition(raw: string): RankingMetric {
  const key = raw.replace(/\s+/g, '').toLowerCase();
  if (key === '1' || key === 'accuracy' || key === 'acc') return 'accuracy';
  if (key === '2' || key === 'combo') return 'combo';
  if (key === '3' || key === 'scorev2') return 'scorev2';
  return 'score';
}

/**
 * Lobby ranking value for Score / Acc / Combo / ScoreV2.
 * Missing or invalid metric → **0**.
 */
export function rankingValueFromPlayerLine(
  metric: RankingMetric,
  line: { score?: number; accuracy?: number; maxCombo?: number },
): number {
  if (metric === 'accuracy') {
    const accuracy = line.accuracy;
    if (typeof accuracy !== 'number' || !Number.isFinite(accuracy)) return 0;
    const fraction = accuracy <= 1 ? accuracy : accuracy / 100;
    return Math.round(fraction * 1_000_000);
  }
  if (metric === 'combo') {
    const combo = line.maxCombo;
    return typeof combo === 'number' && Number.isFinite(combo) ? Math.max(0, Math.round(combo)) : 0;
  }
  const score = line.score;
  return typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.round(score)) : 0;
}

/** One required/optional group of allowed mod-sets for FM composition. */
export const fmRuleGroupSchema = z.object({
  /** Each inner array is an allowed mod combination (sorted/compared as set). Empty = NM. */
  anyOf: z.array(z.array(z.string())).min(1),
  /** Minimum players that must match one of `anyOf`. */
  count: z.number().int().min(0).default(1),
  /** Optional upper bound (defaults to count). */
  max: z.number().int().min(0).optional(),
});

export const fmRulesSchema = z.object({
  requiredGroups: z.array(fmRuleGroupSchema).default([]),
  scope: z.enum(['lobby', 'per_team']).default('lobby'),
});
export type FmRules = z.infer<typeof fmRulesSchema>;
export type FmRuleGroup = z.infer<typeof fmRuleGroupSchema>;

function modsMatchSet(playerMods: string[], required: string[]): boolean {
  const a = normalizeModList(playerMods);
  const b = normalizeModList(required);
  if (a.length !== b.length) return false;
  return a.every((mod, i) => mod === b[i]);
}

function playerMatchesAnyOf(playerMods: string[], anyOf: string[][]): boolean {
  return anyOf.some((combo) => modsMatchSet(playerMods, combo));
}

export type FmPlayer = {
  mods: string[];
  team?: string;
};

export type FmValidationResult = {
  ok: boolean;
  detail?: string;
};

function validateGroups(
  players: FmPlayer[],
  groups: FmRuleGroup[],
): FmValidationResult {
  const used = new Set<number>();
  for (const group of groups) {
    const max = group.max ?? Math.max(group.count, group.count);
    const matches: number[] = [];
    players.forEach((player, index) => {
      if (used.has(index)) return;
      if (playerMatchesAnyOf(player.mods, group.anyOf)) matches.push(index);
    });
    if (matches.length < group.count) {
      return {
        ok: false,
        detail: `FM need ${group.count}× [${group.anyOf.map((c) => c.join('+') || 'NM').join('|')}], have ${matches.length}`,
      };
    }
    const take = matches.slice(0, max);
    for (const index of take.slice(0, group.count)) used.add(index);
    // Optional extras up to max also consume slots so they don't satisfy another group incorrectly
    for (const index of take) used.add(index);
  }
  return { ok: true };
}

/** Validate freemod composition against configured groups. */
export function validateFmRules(
  players: FmPlayer[],
  rules: FmRules,
): FmValidationResult {
  if (!rules.requiredGroups.length) return { ok: true };
  if (rules.scope === 'per_team') {
    const teams = new Map<string, FmPlayer[]>();
    for (const player of players) {
      const key = player.team ?? '_';
      const list = teams.get(key) ?? [];
      list.push(player);
      teams.set(key, list);
    }
    for (const [team, roster] of teams) {
      const result = validateGroups(roster, rules.requiredGroups);
      if (!result.ok) {
        return { ok: false, detail: `team ${team}: ${result.detail}` };
      }
    }
    return { ok: true };
  }
  return validateGroups(players, rules.requiredGroups);
}
