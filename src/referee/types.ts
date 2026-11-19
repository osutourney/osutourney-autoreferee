import { z } from 'zod';
import { draftScriptPhaseSchema, mappoolSlotSchema, type DraftSide } from '../draft/types.js';

export type { DraftSide };

export const lineupModeSchema = z.enum(['strict', 'flexible']);
export type LineupMode = z.infer<typeof lineupModeSchema>;

export const matchFormatSchema = z.enum(['team_match', 'qualifier', 'play_all']);
export type MatchFormat = z.infer<typeof matchFormatSchema>;

export const matchTimersSchema = z.object({
  joinSec: z.number().int().min(1).default(600),
  warmupVoteSec: z.number().int().min(1).default(180),
  warmupPickSec: z.number().int().min(1).default(120),
  downloadReadySec: z.number().int().min(1).default(120),
  downloadGraceSec: z.number().int().min(1).default(120),
  draftActionSec: z.number().int().min(1).default(120),
  rollChoiceSec: z.number().int().min(1).default(120),
  /** After map start (`!mp start`), leave within this window → bot may `!mp abort`. */
  abortGraceSec: z.number().int().min(0).default(30),
  /** Ready window after an abort (re-ready). */
  abortReadySec: z.number().int().min(1).default(90),
  /** After qualifier pool runs complete, delay before `!mp close`. */
  qualCloseSec: z.number().int().min(0).max(600).default(60),
});

export type MatchTimers = z.infer<typeof matchTimersSchema>;

export const matchRulesSchema = z.object({
  format: matchFormatSchema.default('team_match'),
  playersPerSide: z.number().int().min(1).max(8).default(1),
  lineupMode: lineupModeSchema.default('strict'),
  firstTo: z.number().int().min(1).default(3),
  bestOf: z.number().int().min(1).default(5),
  protectsPerTeam: z.number().int().min(0).default(1),
  bansPerTeam: z.number().int().min(0).default(2),
  /** Max `!mp abort` per map (bot + referee). Default 2. */
  maxAbortsPerMap: z.number().int().min(0).max(10).default(2),
  /** How many full non-TB pool passes in qualifier / play_all. */
  qualPoolRuns: z.number().int().min(1).max(20).default(1),
  /** Score multipliers for freemod / HD/HR etc. */
  modMultipliers: z.record(z.number().positive()).optional(),
  draftScript: z.array(draftScriptPhaseSchema).optional(),
  timers: matchTimersSchema.default({}),
  mp: z.object({
    extraSlots: z.number().int().min(0).max(8).default(2),
    teamMode: z.string().default('TeamVS'),
    winCondition: z.string().default('Score'),
  }).default({}),
  optionalTb: z.boolean().default(true),
});

export type MatchRules = z.infer<typeof matchRulesSchema>;

export const playerRefSchema = z.object({
  osuId: z.string().min(1),
  username: z.string().min(1).optional(),
  isCaptain: z.boolean().optional(),
});

export type PlayerRef = z.infer<typeof playerRefSchema>;

export const teamRefSchema = z.object({
  name: z.string().min(1),
  seed: z.number().int().optional(),
  players: z.array(playerRefSchema).default([]),
});

export type TeamRef = z.infer<typeof teamRefSchema>;

export type RefereePhase =
  | 'setup'
  | 'joining'
  | 'warmup_vote'
  | 'warmups'
  | 'roll_choice'
  | 'drafting'
  | 'playing'
  | 'playing_all'
  | 'qual_replay'
  | 'tb_optional'
  | 'tb_mandatory'
  | 'finished'
  | 'forfeit';

export type RefereeStateSnapshot = {
  phase: RefereePhase;
  channel?: string;
  mpId?: string;
  url?: string;
  score: { red: number; blue: number };
  bestOf: number;
  firstTo: number;
  detail?: string;
};

export const autorefSnapshotSchema = z.object({
  phase: z.string().optional(),
  score: z.object({ red: z.number(), blue: z.number() }).optional(),
  mapsPlayed: z.number().int().min(0).optional(),
  qualReplayQueue: z.array(z.record(z.unknown())).optional(),
  detail: z.string().optional(),
  awaitingScoreApply: z.boolean().optional(),
  awaitingScoreSince: z.string().optional(),
});
export type AutorefSnapshot = z.infer<typeof autorefSnapshotSchema>;

export const createMatchRefereeOptionsSchema = z.object({
  lobbyName: z.string().min(1),
  rules: matchRulesSchema.default({}),
  teams: z.object({
    red: teamRefSchema.optional(),
    blue: teamRefSchema.optional(),
  }).default({}),
  captains: z.object({
    redOsuId: z.string().optional(),
    blueOsuId: z.string().optional(),
  }).optional(),
  mappool: z.object({
    slots: z.array(mappoolSlotSchema).default([]),
  }).default({}),
  streamers: z.array(z.string()).default([]),
  invites: z.array(z.string()).optional(),
  /** Reattach to an existing Bancho MP after worker failover (no `!mp make`). */
  resume: z.object({
    mpId: z.string().min(1),
    channel: z.string().min(1),
    url: z.string().optional(),
    snapshot: autorefSnapshotSchema.optional(),
  }).optional(),
});

export type CreateMatchRefereeOptions = z.infer<typeof createMatchRefereeOptionsSchema>;

export type MapScoreLine = {
  osuId: string;
  score: number;
  team?: string;
  username?: string;
  mods?: string[];
};

export type RefereeDispatch =
  | { type: 'chat'; user: string; message: string; osuId?: string }
  | { type: 'draft.protect'; slot: string; side?: DraftSide }
  | { type: 'draft.ban'; slot: string; side?: DraftSide }
  | { type: 'draft.pick'; slot: string; side?: DraftSide }
  | { type: 'continue' }
  | { type: 'warmup.yes'; side?: DraftSide; osuId?: string }
  | { type: 'warmup.no'; side?: DraftSide; osuId?: string }
  | { type: 'warmup.done' }
  | { type: 'roll.choice'; choice: 'first_protect_ban' | 'first_ban' | 'first_pick' }
  | { type: 'roll'; value: number; side?: DraftSide; osuId?: string }
  | { type: 'score.apply'; scores: MapScoreLine[] }
  | { type: 'tb.yes' }
  | { type: 'tb.no' }
  | { type: 'replay.yes'; osuId?: string }
  | { type: 'replay.no'; osuId?: string }
  | { type: 'start' }
  | { type: 'referee_override_start' };
