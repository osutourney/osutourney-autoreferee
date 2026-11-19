export { createBanchoIrcClient } from './irc/client.js';
export type { BanchoIrcClient, BanchoIrcClientOptions, LobbyReadyPlayer, LobbyReadyInspect } from './irc/types.js';
export { FakeBanchoIrcClient } from './irc/fake-client.js';
export { parseMpSettingsReady } from './irc/parse-settings.js';

export { createMatchReferee } from './referee/match-referee.js';
export type { MatchReferee } from './referee/match-referee.js';
export {
  createLobbyCapacityGate,
  waitForCapacity,
  type LobbyCapacityGate,
} from './referee/capacity.js';
export { parseRefereeChat } from './referee/chat.js';
export {
  matchRulesSchema,
  createMatchRefereeOptionsSchema,
  type CreateMatchRefereeOptions,
  type MatchRules,
  type RefereeDispatch,
  type RefereePhase,
  type RefereeStateSnapshot,
  type PlayerRef,
  type TeamRef,
} from './referee/types.js';

export { classicDraftPreset, resolveDraftScript } from './draft/presets.js';
export { filterAvailableSlots, formatSlotList } from './draft/slots.js';
export type { DraftScriptPhase, MappoolSlot, DraftSide, DraftRuntime } from './draft/types.js';

export type { RefereeEventMap, LobbyCreatedEvent } from './events.js';

export {
  applyModMultipliers,
  scoreWithMods,
  validateFmRules,
  DEFAULT_MOD_MULTIPLIERS,
  fmRulesSchema,
  modMultipliersSchema,
  normalizeModList,
  type FmRules,
  type ModMultipliers,
} from './score/mod-score.js';
export { parseSlotMods } from './irc/parse-settings.js';
export {
  teamModeCode,
  winConditionCode,
  isAccuracyWinCondition,
  rankingMetricFromWinCondition,
  rankingValueFromPlayerLine,
  type RankingMetric,
} from './irc/mp-modes.js';
export { parseBanchoRoll } from './referee/chat.js';
