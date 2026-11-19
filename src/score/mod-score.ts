/**
 * Public score helpers for `@osutourney/autoreferee`.
 * Implementation is generated from `@osutourney/contracts` — run `pnpm autoreferee:sync-helpers`.
 */
export {
  MOD_CODE_ALIASES,
  DEFAULT_MOD_MULTIPLIERS,
  normalizeModCode,
  normalizeModList,
  modMultipliersSchema,
  applyModMultipliers,
  scoreWithMods,
  rankingMetricFromWinCondition,
  rankingValueFromPlayerLine,
  fmRuleGroupSchema,
  fmRulesSchema,
  validateFmRules,
  type ModMultipliers,
  type RankingMetric,
  type FmRules,
  type FmRuleGroup,
  type FmPlayer,
  type FmValidationResult,
} from './from-contracts.js';
