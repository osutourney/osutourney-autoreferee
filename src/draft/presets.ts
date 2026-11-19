import type { DraftScriptPhase } from './types.js';
import type { MatchRules } from '../referee/types.js';

/** Classic protect → ban (ABBA) → pick/play until firstTo. */
export function classicDraftPreset(partial?: {
  protectsPerTeam?: number;
  bansPerTeam?: number;
  firstTo?: number;
  bestOf?: number;
}): Pick<MatchRules, 'draftScript' | 'firstTo' | 'bestOf' | 'protectsPerTeam' | 'bansPerTeam'> {
  const protectsPerTeam = partial?.protectsPerTeam ?? 1;
  const bansPerTeam = partial?.bansPerTeam ?? 2;
  const firstTo = partial?.firstTo ?? 3;
  const bestOf = partial?.bestOf ?? firstTo * 2 - 1;

  const script: DraftScriptPhase[] = [];
  if (protectsPerTeam > 0) {
    script.push({
      id: 'protect',
      type: 'protect',
      countPerSide: protectsPerTeam,
      order: 'abba',
    });
  }
  if (bansPerTeam > 0) {
    script.push({
      id: 'ban',
      type: 'ban',
      countPerSide: bansPerTeam,
      order: 'abba',
    });
  }
  script.push({
    id: 'picks',
    type: 'pick_play',
    until: { kind: 'first_to', n: firstTo },
  });

  return {
    draftScript: script,
    firstTo,
    bestOf,
    protectsPerTeam,
    bansPerTeam,
  };
}

export function resolveDraftScript(rules: MatchRules): DraftScriptPhase[] {
  if (rules.draftScript?.length) return rules.draftScript;
  return classicDraftPreset({
    protectsPerTeam: rules.protectsPerTeam,
    bansPerTeam: rules.bansPerTeam,
    firstTo: rules.firstTo,
    bestOf: rules.bestOf,
  }).draftScript!;
}
