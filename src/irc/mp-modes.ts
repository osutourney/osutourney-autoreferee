/** Bancho `!mp set <teammode> <scoremode>` codes. */

import {
  rankingMetricFromWinCondition as rankingMetricFromContracts,
  rankingValueFromPlayerLine as rankingValueFromContracts,
  type RankingMetric,
} from '../score/mod-score.js';

export type { RankingMetric };

export function teamModeCode(raw: string): number {
  const key = raw.replace(/\s+/g, '').toLowerCase();
  switch (key) {
    case '0':
    case 'headtohead':
    case 'h2h':
      return 0;
    case '1':
    case 'tagcoop':
      return 1;
    case '2':
    case 'teamvs':
    case 'team':
      return 2;
    case '3':
    case 'tagteamvs':
      return 3;
    default:
      return 2;
  }
}

export function winConditionCode(raw: string): number {
  const key = raw.replace(/\s+/g, '').toLowerCase();
  switch (key) {
    case '0':
    case 'score':
      return 0;
    case '1':
    case 'accuracy':
    case 'acc':
      return 1;
    case '2':
    case 'combo':
      return 2;
    case '3':
    case 'scorev2':
      return 3;
    default:
      return 0;
  }
}

export function isAccuracyWinCondition(raw: string): boolean {
  return winConditionCode(raw) === 1;
}

/** Re-export SoT ranking helpers (contracts → from-contracts). */
export const rankingMetricFromWinCondition = rankingMetricFromContracts;
export const rankingValueFromPlayerLine = rankingValueFromContracts;
