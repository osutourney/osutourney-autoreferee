import { randomUUID } from 'node:crypto';
import { RefereeEmitter } from '../events.js';
import { expandSideOrder } from '../draft/order.js';
import { resolveDraftScript } from '../draft/presets.js';
import { filterAvailableSlots, formatSlotList } from '../draft/slots.js';
import type { DraftEntry, DraftRuntime, DraftSide, MappoolSlot } from '../draft/types.js';
import { isAllPlayersReadyMessage } from '../irc/parse-all-ready.js';
import { teamModeCode, winConditionCode } from '../irc/mp-modes.js';
import type { BanchoIrcClient } from '../irc/types.js';
import {
  DEFAULT_MOD_MULTIPLIERS,
  applyModMultipliers,
  validateFmRules,
} from '../score/mod-score.js';
import {
  createLobbyCapacityGate,
  waitForCapacity,
  type LobbyCapacityGate,
} from './capacity.js';
import { parseRefereeChat } from './chat.js';
import {
  createMatchRefereeOptionsSchema,
  type CreateMatchRefereeOptions,
  type MapScoreLine,
  type MatchRules,
  type RefereeDispatch,
  type RefereePhase,
  type RefereeStateSnapshot,
} from './types.js';

export type QualReplayItem = {
  slot: string;
  beatmapId: string;
  freemod: boolean;
  mods: string[];
  fmRules?: MappoolSlot['fmRules'];
  forOsuId: string;
  team?: string;
  label: string;
};

export type MatchReferee = {
  readonly id: string;
  start(): Promise<void>;
  close(): Promise<void>;
  dispatch(action: RefereeDispatch): Promise<void>;
  on: RefereeEmitter['on'];
  getState(): RefereeStateSnapshot;
  /** Minimal FSM snapshot for host persistence / failover. */
  getSnapshot(): Record<string, unknown>;
};

type Internal = {
  irc: BanchoIrcClient;
  opts: CreateMatchRefereeOptions;
  rules: MatchRules;
  gate: LobbyCapacityGate;
  emitter: RefereeEmitter;
  id: string;
  phase: RefereePhase;
  channel?: string;
  mpId?: string;
  url?: string;
  timer?: ReturnType<typeof setTimeout>;
  readyPoll?: ReturnType<typeof setInterval>;
  /** Prevent double-advance while a map countdown/play is in flight. */
  mapInProgress: boolean;
  /** When `!mp start 5` was issued (abort grace measured from here). */
  mapStartedAt?: number;
  /** Aborts used on the current map (bot + referee). */
  abortsThisMap: number;
  /** Bot already sent `!mp abort` — wait for Bancho ack before counting again. */
  abortPending: boolean;
  draft: DraftRuntime;
  pool: MappoolSlot[];
  /** Slot currently set in the lobby (for FM gate + score events). */
  currentSlot?: MappoolSlot;
  /** Players who left after abort grace during the current map. */
  leftDuringMap: Set<string>;
  /** Waiting for host `score.apply` (osu API) before advancing. */
  awaitingScoreApply: boolean;
  /** When awaitingScoreApply became true (ISO). */
  awaitingScoreSince?: string;
  /** Captain rolls (Bancho `rolled N`). */
  rolls: { red?: number; blue?: number };
  /** Internal re-roll attempts after ties (not announced). */
  rollTieAttempts: number;
  qualReplayQueue: QualReplayItem[];
  currentReplay?: QualReplayItem;
  warmupVotes: { red?: boolean; blue?: boolean };
  /** Whose warmup host turn: red → blue → done. */
  warmupTurn?: DraftSide;
  pendingContinue: Set<DraftSide>;
  continueAcks: Set<DraftSide>;
  closed: boolean;
};

const MAX_ROLL_TIE_ATTEMPTS = 5;

function isQualFormat(rules: MatchRules): boolean {
  return rules.format === 'qualifier' || rules.format === 'play_all';
}

function modsCommandForSlot(slot: MappoolSlot): string[] {
  if (slot.freemod) return ['Freemod'];
  return slot.mods.filter((mod) => {
    const key = mod.replace(/^\+/, '').trim().toUpperCase();
    return key !== 'FM' && key !== 'FREEMOD';
  });
}

async function setLobbyMap(ctx: Internal, slot: MappoolSlot) {
  ctx.currentSlot = slot;
  await ctx.irc.setMap(ctx.channel!, slot.beatmapId, modsCommandForSlot(slot));
}

function statusLine(
  opts: CreateMatchRefereeOptions,
  score: { red: number; blue: number },
  bestOf: number,
  suffix: string,
) {
  const a = opts.teams.red?.name ?? 'Red';
  const b = opts.teams.blue?.name ?? 'Blue';
  return `${a} | ${score.red} - ${score.blue} | ${b} // Bo${bestOf} // ${suffix}`;
}

/** Domain announce always; IRC only when `irc` is true (default). */
async function announce(ctx: Internal, message: string, opts?: { irc?: boolean }) {
  ctx.emitter.emit('announce', { message });
  if (opts?.irc === false) return;
  if (ctx.channel) await ctx.irc.sendMessage(ctx.channel, message);
}

function snapshot(ctx: Internal): RefereeStateSnapshot {
  return {
    phase: ctx.phase,
    channel: ctx.channel,
    mpId: ctx.mpId,
    url: ctx.url,
    score: { ...ctx.draft.score },
    bestOf: ctx.rules.bestOf,
    firstTo: ctx.rules.firstTo,
  };
}

function fsmSnapshot(ctx: Internal): Record<string, unknown> {
  return {
    phase: ctx.phase,
    score: { ...ctx.draft.score },
    mapsPlayed: ctx.draft.mapsPlayed,
    qualReplayQueue: ctx.qualReplayQueue,
    mpId: ctx.mpId,
    channel: ctx.channel,
    url: ctx.url,
    awaitingScoreApply: ctx.awaitingScoreApply,
    awaitingScoreSince: ctx.awaitingScoreSince ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function emitState(ctx: Internal, detail?: string) {
  const state = snapshot(ctx);
  if (detail) state.detail = detail;
  ctx.emitter.emit('state', state);
}

function clearReadyPoll(ctx: Internal) {
  if (ctx.readyPoll) {
    clearInterval(ctx.readyPoll);
    ctx.readyPoll = undefined;
  }
}

function clearTimer(ctx: Internal) {
  if (ctx.timer) {
    clearTimeout(ctx.timer);
    ctx.timer = undefined;
  }
}

async function abortIrcTimer(ctx: Internal) {
  clearReadyPoll(ctx);
  if (ctx.channel) await ctx.irc.mpAbortTimer(ctx.channel);
  clearTimer(ctx);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** All present players ready + format/lineup rules. Verified via `!mp settings`. */
function lineupReadyForStart(
  ctx: Internal,
  players: Array<{ ready: boolean; team?: string; username?: string; osuId: string }>,
): boolean {
  if (players.length === 0) return false;
  if (players.some((row) => !row.ready)) return false;

  if (ctx.rules.format === 'qualifier' || ctx.rules.format === 'play_all') {
    return players.length >= 1;
  }

  const red = players.filter((row) =>
    row.team === 'red' || sideForUser(ctx, row.username, row.osuId) === 'red').length;
  const blue = players.filter((row) =>
    row.team === 'blue' || sideForUser(ctx, row.username, row.osuId) === 'blue').length;
  const pps = ctx.rules.playersPerSide;
  if (ctx.rules.lineupMode === 'strict') {
    return red >= pps && blue >= pps;
  }
  // flexible: both sides represented (or continue already handled elsewhere)
  return red >= 1 && blue >= 1;
}

async function markMapStarted(ctx: Internal) {
  ctx.mapInProgress = true;
  ctx.mapStartedAt = Date.now();
  ctx.abortPending = false;
  ctx.leftDuringMap = new Set();
}

async function tryStartIfReady(ctx: Internal): Promise<boolean> {
  if (ctx.closed || !ctx.channel || ctx.mapInProgress) return false;
  if (ctx.phase !== 'playing' && ctx.phase !== 'playing_all'
    && ctx.phase !== 'tb_mandatory' && ctx.phase !== 'tb_optional') {
    return false;
  }
  try {
    // Always re-check with !mp settings against lineup/format rules before starting.
    const inspected = await ctx.irc.inspectLobbyReady(ctx.channel);
    if (!lineupReadyForStart(ctx, inspected.players)) {
      await announce(ctx, 'Ready — lineup check failed.', { irc: false });
      return false;
    }
    const slot = ctx.currentSlot;
    if (slot?.freemod && slot.fmRules) {
      const fm = validateFmRules(
        inspected.players.map((row) => ({
          mods: row.mods ?? [],
          team: row.team ?? sideForUser(ctx, row.username, row.osuId),
        })),
        slot.fmRules,
      );
      if (!fm.ok) {
        await announce(ctx, fm.detail ?? 'FM composition invalid.');
        return false;
      }
    }
    // Abort ready countdown (!mp aborttimer + local timer) then start.
    clearReadyPoll(ctx);
    clearTimer(ctx);
    await ctx.irc.mpAbortTimer(ctx.channel);
    await markMapStarted(ctx);
    await ctx.irc.startMatch(ctx.channel, 5);
    await announce(ctx, 'Starting.', { irc: false });
    return true;
  } catch {
    return false;
  }
}

function armReadyPoll(ctx: Internal) {
  clearReadyPoll(ctx);
  ctx.readyPoll = setInterval(() => {
    void tryStartIfReady(ctx);
  }, 2_000);
}

/** Ready window: poll `!mp settings`; start early when lineup is ready. */
async function beginReadyGate(
  ctx: Internal,
  opts?: { readySec?: number; graceSec?: number; label?: string },
) {
  if (!ctx.channel) return;
  ctx.mapInProgress = false;
  ctx.mapStartedAt = undefined;
  ctx.abortPending = false;
  const readySec = opts?.readySec ?? ctx.rules.timers.downloadReadySec;
  const graceSec = opts?.graceSec ?? ctx.rules.timers.downloadGraceSec;
  const label = opts?.label ?? 'Ready up.';
  await announce(ctx, label);
  await startTimer(ctx, readySec, async () => {
    const started = await tryStartIfReady(ctx);
    if (started) return;
    await announce(ctx, 'Ready timeout — grace.', { irc: false });
    await startTimer(ctx, graceSec, async () => {
      const ok = await tryStartIfReady(ctx);
      if (ok) return;
      // Last resort so qual smoke does not stall forever (skip if FM still invalid).
      const inspected = await ctx.irc.inspectLobbyReady(ctx.channel!);
      const slot = ctx.currentSlot;
      if (slot?.freemod && slot.fmRules) {
        const fm = validateFmRules(
          inspected.players.map((row) => ({
            mods: row.mods ?? [],
            team: row.team ?? sideForUser(ctx, row.username, row.osuId),
          })),
          slot.fmRules,
        );
        if (!fm.ok) {
          await announce(ctx, fm.detail ?? 'FM composition invalid.');
          return;
        }
      }
      clearReadyPoll(ctx);
      await markMapStarted(ctx);
      await announce(ctx, 'Grace ended — starting.', { irc: false });
      await ctx.irc.startMatch(ctx.channel!, 5);
    });
    armReadyPoll(ctx);
  });
  armReadyPoll(ctx);
  // Immediate check (players may already be Ready from previous map).
  await sleep(400);
  await tryStartIfReady(ctx);
}

function resetAbortsForNewMap(ctx: Internal) {
  ctx.abortsThisMap = 0;
  ctx.abortPending = false;
}

function withinAbortGrace(ctx: Internal): boolean {
  if (!ctx.mapInProgress || !ctx.mapStartedAt) return false;
  const graceMs = ctx.rules.timers.abortGraceSec * 1000;
  if (graceMs <= 0) return false;
  return Date.now() - ctx.mapStartedAt <= graceMs;
}

async function requestBotAbort(ctx: Internal, reason: string) {
  if (!ctx.channel || ctx.abortPending) return;
  if (ctx.abortsThisMap >= ctx.rules.maxAbortsPerMap) {
    await announce(ctx, `No more aborts (${ctx.rules.maxAbortsPerMap}/${ctx.rules.maxAbortsPerMap}).`);
    return;
  }
  ctx.abortPending = true;
  await announce(ctx, `Abort: ${reason}`, { irc: false });
  await ctx.irc.mpAbort(ctx.channel);
}

/** Referee or bot abort — does NOT score the map; reopen ready gate. */
async function onMatchAborted(
  ctx: Internal,
  input: { reason: string; byBot: boolean },
) {
  if (ctx.phase !== 'playing' && ctx.phase !== 'playing_all'
    && ctx.phase !== 'tb_mandatory' && ctx.phase !== 'tb_optional') {
    return;
  }
  // Ignore duplicate Bancho "Aborted" lines after we already reopened ready.
  if (!ctx.mapInProgress && !ctx.abortPending) return;

  clearReadyPoll(ctx);
  clearTimer(ctx);
  ctx.mapInProgress = false;
  ctx.mapStartedAt = undefined;
  ctx.abortPending = false;
  ctx.abortsThisMap += 1;
  const max = ctx.rules.maxAbortsPerMap;
  ctx.emitter.emit('abort', {
    reason: input.reason,
    abortsThisMap: ctx.abortsThisMap,
    maxAbortsPerMap: max,
    byBot: input.byBot,
  });
  await announce(ctx, `Aborted ${ctx.abortsThisMap}/${max} — ready up.`);
  await beginReadyGate(ctx, {
    readySec: ctx.rules.timers.abortReadySec,
    graceSec: ctx.rules.timers.downloadGraceSec,
    label: `Ready (${ctx.abortsThisMap}/${max} aborts).`,
  });
}

function resolveOsuId(ctx: Internal, usernameOrId: string): string {
  const needle = usernameOrId.toLowerCase();
  for (const team of [ctx.opts.teams.red, ctx.opts.teams.blue]) {
    for (const player of team?.players ?? []) {
      if (player.osuId.toLowerCase() === needle || player.username?.toLowerCase() === needle) {
        return player.osuId;
      }
    }
  }
  return usernameOrId;
}

async function onPlayerLeftDuringMap(ctx: Internal, username: string) {
  if (!ctx.mapInProgress) return;
  const osuId = resolveOsuId(ctx, username);
  if (!withinAbortGrace(ctx)) {
    ctx.leftDuringMap.add(osuId);
    if (isQualFormat(ctx.rules) && ctx.currentSlot) {
      await announce(ctx, `${username} DC after grace — map continues; replay offered later.`);
    } else {
      await announce(ctx, `${username} DC after grace — score 0 for this map.`);
    }
    return;
  }
  await requestBotAbort(ctx, `${username} left within abort grace`);
}

async function startTimer(ctx: Internal, seconds: number, onExpire: () => void | Promise<void>) {
  await abortIrcTimer(ctx);
  if (ctx.channel) await ctx.irc.mpTimer(ctx.channel, seconds);
  ctx.timer = setTimeout(() => {
    void onExpire();
  }, seconds * 1000);
}

function setPhase(ctx: Internal, phase: RefereePhase, detail?: string) {
  ctx.phase = phase;
  ctx.emitter.emit('phase', { phase, detail });
  emitState(ctx, detail);
}

function allInvites(ctx: Internal): string[] {
  if (ctx.opts.invites?.length) return ctx.opts.invites;
  const ids: string[] = [];
  for (const team of [ctx.opts.teams.red, ctx.opts.teams.blue]) {
    for (const player of team?.players ?? []) {
      ids.push(player.username ?? player.osuId);
    }
  }
  return [...new Set(ids)];
}

function sideForUser(ctx: Internal, user?: string, osuId?: string): DraftSide | undefined {
  const needle = (osuId ?? user ?? '').toLowerCase();
  if (!needle) return undefined;
  for (const player of ctx.opts.teams.red?.players ?? []) {
    if (player.osuId.toLowerCase() === needle || player.username?.toLowerCase() === needle) return 'red';
  }
  for (const player of ctx.opts.teams.blue?.players ?? []) {
    if (player.osuId.toLowerCase() === needle || player.username?.toLowerCase() === needle) return 'blue';
  }
  if (ctx.opts.captains?.redOsuId?.toLowerCase() === needle) return 'red';
  if (ctx.opts.captains?.blueOsuId?.toLowerCase() === needle) return 'blue';
  return undefined;
}

function isCaptain(ctx: Internal, side: DraftSide, user?: string, osuId?: string): boolean {
  const cap = side === 'red' ? ctx.opts.captains?.redOsuId : ctx.opts.captains?.blueOsuId;
  const needle = (osuId ?? user ?? '').toLowerCase();
  if (cap && cap.toLowerCase() === needle) return true;
  const team = side === 'red' ? ctx.opts.teams.red : ctx.opts.teams.blue;
  const player = team?.players.find((row) =>
    row.osuId.toLowerCase() === needle || row.username?.toLowerCase() === needle);
  return Boolean(player?.isCaptain || (!cap && player));
}

async function beginJoin(ctx: Internal) {
  setPhase(ctx, 'joining', 'waiting for players');
  const invites = allInvites(ctx);
  for (const target of invites) {
    await ctx.irc.invitePlayer(ctx.channel!, target);
  }
  for (const streamer of ctx.opts.streamers) {
    await ctx.irc.addref(ctx.channel!, streamer);
  }
  await announce(ctx, `Join window ${ctx.rules.timers.joinSec}s — invites sent.`);
  await startTimer(ctx, ctx.rules.timers.joinSec, () => onJoinTimeout(ctx));
}

async function onJoinTimeout(ctx: Internal) {
  const inspected = await ctx.irc.inspectLobbyReady(ctx.channel!);
  const redPresent = inspected.players.some((row) => row.team === 'red' || sideForUser(ctx, row.username, row.osuId) === 'red');
  const bluePresent = inspected.players.some((row) => row.team === 'blue' || sideForUser(ctx, row.username, row.osuId) === 'blue');

  if (ctx.rules.format === 'qualifier' || ctx.rules.format === 'play_all') {
    if (!redPresent && !bluePresent && inspected.players.length === 0) {
      await finishForfeit(ctx, { both: true, reason: 'no_players_joined' });
      return;
    }
    await abortIrcTimer(ctx);
    await beginPlayAll(ctx);
    return;
  }

  if (!redPresent && !bluePresent) {
    await finishForfeit(ctx, { both: true, reason: 'both_teams_noshow' });
    return;
  }
  if (!redPresent) {
    await finishForfeit(ctx, { side: 'red', reason: 'red_noshow' });
    return;
  }
  if (!bluePresent) {
    await finishForfeit(ctx, { side: 'blue', reason: 'blue_noshow' });
    return;
  }

  await abortIrcTimer(ctx);
  await beginWarmupVote(ctx);
}

async function maybeAdvanceOnJoin(ctx: Internal) {
  if (ctx.phase !== 'joining' || ctx.rules.format !== 'team_match') return;
  const inspected = await ctx.irc.inspectLobbyReady(ctx.channel!);
  const red = inspected.players.some((row) => sideForUser(ctx, row.username, row.osuId) === 'red' || row.team === 'red');
  const blue = inspected.players.some((row) => sideForUser(ctx, row.username, row.osuId) === 'blue' || row.team === 'blue');
  if (red && blue) {
    await abortIrcTimer(ctx);
    await beginWarmupVote(ctx);
  }
}

async function beginWarmupVote(ctx: Internal) {
  ctx.warmupVotes = {};
  setPhase(ctx, 'warmup_vote');
  await announce(ctx, 'Warmups? Type !si or !no (one per team).');
  await startTimer(ctx, ctx.rules.timers.warmupVoteSec, async () => {
    await abortIrcTimer(ctx);
    await beginRollChoice(ctx);
  });
}

async function beginRollChoice(ctx: Internal) {
  setPhase(ctx, 'roll_choice');
  ctx.rolls = {};
  if (ctx.rollTieAttempts === undefined) ctx.rollTieAttempts = 0;
  const a = ctx.opts.teams.red?.name ?? 'Red';
  const b = ctx.opts.teams.blue?.name ?? 'Blue';
  await announce(ctx, `Captains type !roll (${a} / ${b}).`);
  await startTimer(ctx, ctx.rules.timers.rollChoiceSec, async () => {
    if (ctx.rolls.red === undefined) ctx.rolls.red = 0;
    if (ctx.rolls.blue === undefined) ctx.rolls.blue = 0;
    await settleRolls(ctx);
  });
}

async function recordCaptainRoll(ctx: Internal, side: DraftSide, value: number) {
  if (ctx.phase !== 'roll_choice') return;
  if (ctx.rolls[side] !== undefined) return;
  ctx.rolls[side] = value;
  if (ctx.rolls.red !== undefined && ctx.rolls.blue !== undefined) {
    await abortIrcTimer(ctx);
    await settleRolls(ctx);
  }
}

async function settleRolls(ctx: Internal) {
  const red = ctx.rolls.red ?? 0;
  const blue = ctx.rolls.blue ?? 0;
  if (red === blue) {
    ctx.rollTieAttempts = (ctx.rollTieAttempts ?? 0) + 1;
    if (ctx.rollTieAttempts < MAX_ROLL_TIE_ATTEMPTS) {
      // Internal re-roll — do not announce the tied scores.
      ctx.rolls = {};
      await announce(ctx, 'Captains type !roll.');
      await startTimer(ctx, ctx.rules.timers.rollChoiceSec, async () => {
        if (ctx.rolls.red === undefined) ctx.rolls.red = 0;
        if (ctx.rolls.blue === undefined) ctx.rolls.blue = 0;
        await settleRolls(ctx);
      });
      return;
    }
    // Exhausted ties → stable red (still announce final only).
  }
  const winner: DraftSide = red === blue ? 'red' : red > blue ? 'red' : 'blue';
  ctx.draft.rollWinner = winner;
  ctx.rollTieAttempts = 0;
  const a = ctx.opts.teams.red?.name ?? 'Red';
  const b = ctx.opts.teams.blue?.name ?? 'Blue';
  await announce(ctx, `${a} ${red} – ${blue} ${b}.`);
  const hasProtect = (ctx.rules.protectsPerTeam ?? 0) > 0 || ctx.draft.script.some((row) => row.type === 'protect');
  const hasBan = (ctx.rules.bansPerTeam ?? 0) > 0 || ctx.draft.script.some((row) => row.type === 'ban');
  const prompt = hasProtect
    ? 'first protect and ban, or first pick?'
    : hasBan
      ? 'first ban or first pick?'
      : 'you pick first.';
  await announce(ctx, `${winner === 'red' ? a : b}, ${prompt}`);
  if (!hasProtect && !hasBan) {
    ctx.draft.choice = 'first_pick';
    ctx.draft.firstPickSide = winner;
    await beginDrafting(ctx);
    return;
  }
  await startTimer(ctx, ctx.rules.timers.rollChoiceSec, async () => {
    ctx.draft.choice = hasProtect ? 'first_protect_ban' : 'first_ban';
    ctx.draft.firstPickSide = winner === 'red' ? 'blue' : 'red';
    await announce(ctx, 'Choice timeout — defaulting.');
    await beginDrafting(ctx);
  });
}

function applyChoice(ctx: Internal, choice: 'first_protect_ban' | 'first_ban' | 'first_pick') {
  const winner = ctx.draft.rollWinner ?? 'red';
  ctx.draft.choice = choice;
  if (choice === 'first_pick') ctx.draft.firstPickSide = winner;
  else ctx.draft.firstPickSide = winner === 'red' ? 'blue' : 'red';
}

async function beginDrafting(ctx: Internal) {
  await abortIrcTimer(ctx);
  ctx.draft.scriptIndex = 0;
  ctx.draft.actionsDoneInPhase = 0;
  setPhase(ctx, 'drafting');
  await promptDraftStep(ctx);
}

async function promptDraftStep(ctx: Internal) {
  const phase = ctx.draft.script[ctx.draft.scriptIndex];
  if (!phase) {
    await finishMatch(ctx, 'draft_complete');
    return;
  }
  if (phase.type === 'pick_play') {
    setPhase(ctx, 'drafting', 'pick');
    const first = ctx.draft.firstPickSide ?? 'red';
    const side: DraftSide = ctx.draft.picks.length % 2 === 0 ? first : (first === 'red' ? 'blue' : 'red');
    const slots = filterAvailableSlots(ctx.pool, ctx.draft, 'pick');
    await announce(ctx, statusLine(ctx.opts, ctx.draft.score, ctx.rules.bestOf, `Pick: ${side}`));
    await announce(ctx, `slots: ${formatSlotList(slots)}`, { irc: false });
    await startTimer(ctx, ctx.rules.timers.draftActionSec, async () => {
      await announce(ctx, 'Pick timeout.');
    });
    return;
  }

  const first = ctx.draft.rollWinner ?? 'red';
  const order = expandSideOrder(phase.order, phase.countPerSide, first);
  const side = order[ctx.draft.actionsDoneInPhase] ?? first;
  const context = phase.type === 'protect' ? 'protect' : 'ban';
  const slots = filterAvailableSlots(ctx.pool, ctx.draft, context);
  await announce(ctx, statusLine(ctx.opts, ctx.draft.score, ctx.rules.bestOf, `${phase.type}: ${side}`));
  await announce(ctx, `slots: ${formatSlotList(slots)}`, { irc: false });
  await startTimer(ctx, ctx.rules.timers.draftActionSec, async () => {
    await announce(ctx, `${phase.type} timeout.`);
  });
}

async function applyDraftAction(
  ctx: Internal,
  kind: 'protect' | 'ban' | 'pick',
  slotToken: string,
  side: DraftSide,
) {
  const found = ctx.pool.find((row) => row.slot.toLowerCase() === slotToken.toLowerCase());
  if (!found) {
    await announce(ctx, `Unknown slot: ${slotToken}`);
    return;
  }
  const available = filterAvailableSlots(ctx.pool, ctx.draft, kind === 'pick' ? 'pick' : kind);
  if (!available.some((row) => row.slot === found.slot)) {
    await announce(ctx, `Slot not available: ${found.slot}`);
    return;
  }

  const entry: DraftEntry = {
    side,
    slot: found.slot,
    beatmapId: found.beatmapId,
    kind,
  };
  if (kind === 'protect') ctx.draft.protects.push(entry);
  if (kind === 'ban') ctx.draft.bans.push(entry);
  if (kind === 'pick') ctx.draft.picks.push(entry);

  await abortIrcTimer(ctx);
  await announce(ctx, `${kind} ${found.slot} (${side})`);

  if (kind === 'pick') {
    setPhase(ctx, 'playing', found.slot);
    resetAbortsForNewMap(ctx);
    await setLobbyMap(ctx, found);
    await announce(ctx, `Map ${found.slot}${found.freemod ? ' (FM)' : found.mods.length ? ` (${found.mods.join(' ')})` : ''}.`);
    await beginReadyGate(ctx);
    return;
  }

  const phase = ctx.draft.script[ctx.draft.scriptIndex];
  ctx.draft.actionsDoneInPhase += 1;
  if (phase && phase.type !== 'pick_play') {
    const needed = phase.countPerSide * 2;
    if (ctx.draft.actionsDoneInPhase >= needed) {
      ctx.draft.scriptIndex += 1;
      ctx.draft.actionsDoneInPhase = 0;
    }
  }
  await promptDraftStep(ctx);
}

async function onMapFinished(
  ctx: Internal,
  scores: Array<{ osuId: string; score: number; team?: string; username?: string; mods?: string[] }>,
) {
  if (ctx.phase !== 'playing' && ctx.phase !== 'playing_all'
    && ctx.phase !== 'tb_mandatory' && ctx.phase !== 'tb_optional'
    && ctx.phase !== 'qual_replay') {
    return;
  }
  // Abort must not be treated as a scored finish.
  if (ctx.abortPending) {
    await onMatchAborted(ctx, { reason: 'abort_pending_finish_ignored', byBot: true });
    return;
  }
  clearReadyPoll(ctx);
  clearTimer(ctx);
  ctx.mapInProgress = false;
  ctx.mapStartedAt = undefined;
  ctx.abortPending = false;

  const disconnected = [...ctx.leftDuringMap];
  ctx.awaitingScoreApply = true;
  ctx.awaitingScoreSince = new Date().toISOString();
  ctx.emitter.emit('map_finished', {
    mpId: ctx.mpId ?? '',
    channel: ctx.channel,
    slot: ctx.currentSlot?.slot,
    beatmapId: ctx.currentSlot?.beatmapId,
    disconnectedOsuIds: disconnected,
    ircScores: scores,
  });

  // FakeIRC / tests often provide scores inline — apply immediately.
  // Live host fetches osu API and dispatches `score.apply`.
  if (scores.length > 0) {
    await applyMapScores(ctx, scores);
  } else {
    // Host fetch timeout — advance with DC zeros / empty sheet (no IRC timer noise).
    clearTimer(ctx);
    ctx.timer = setTimeout(() => {
      void (async () => {
        if (ctx.awaitingScoreApply) await applyMapScores(ctx, []);
      })();
    }, 20_000);
  }
}

async function applyMapScores(ctx: Internal, scores: MapScoreLine[]) {
  if (!ctx.awaitingScoreApply && ctx.phase !== 'qual_replay') {
    // Allow host apply even if IRC path already advanced when only IRC empty→pending
  }
  if (!ctx.awaitingScoreApply) return;
  ctx.awaitingScoreApply = false;
  ctx.awaitingScoreSince = undefined;

  const multipliers = ctx.rules.modMultipliers ?? DEFAULT_MOD_MULTIPLIERS;
  const slot = ctx.currentSlot;
  const disconnected = new Set(ctx.leftDuringMap);
  ctx.leftDuringMap = new Set();

  let settingsMods = new Map<string, string[]>();
  if (slot?.freemod && ctx.channel) {
    try {
      const inspected = await ctx.irc.inspectLobbyReady(ctx.channel);
      settingsMods = new Map(inspected.players.map((row) => [row.osuId, row.mods ?? []]));
    } catch {
      // best-effort
    }
  }

  const byId = new Map<string, MapScoreLine>();
  for (const row of scores) byId.set(row.osuId, row);

  // Qual: DC'd players skip this attempt and enter replay queue (missing score later).
  if (isQualFormat(ctx.rules) && slot && disconnected.size && ctx.phase !== 'qual_replay') {
    for (const osuId of disconnected) {
      byId.delete(osuId);
      const team = sideForUser(ctx, osuId, osuId);
      const already = ctx.qualReplayQueue.some(
        (item) => item.forOsuId === osuId && item.slot === slot.slot && item.beatmapId === slot.beatmapId,
      );
      if (!already) {
        ctx.qualReplayQueue.push({
          slot: slot.slot,
          beatmapId: slot.beatmapId,
          freemod: Boolean(slot.freemod),
          mods: slot.mods,
          fmRules: slot.fmRules,
          forOsuId: osuId,
          team,
          label: slot.slot,
        });
      }
    }
  }

  // Match (and declined/failed presence): force DC score 0 (acc WC → 0 as well).
  if (!isQualFormat(ctx.rules) || ctx.phase === 'qual_replay') {
    for (const osuId of disconnected) {
      byId.set(osuId, { osuId, score: 0, mods: [], team: sideForUser(ctx, osuId, osuId) });
    }
  }

  // Qual replay: only credit the replaying player (or sub who finished).
  if (ctx.phase === 'qual_replay' && ctx.currentReplay) {
    const target = ctx.currentReplay.forOsuId;
    const allowed = new Set([target, ...rosterSubs(ctx, ctx.currentReplay.team)]);
    for (const key of [...byId.keys()]) {
      if (!allowed.has(key) && key !== target) byId.delete(key);
    }
    // If target DC'd again during replay, re-queue (ask again later; no 0 yet).
    if (disconnected.has(target) || ![...byId.keys()].some((id) => allowed.has(id))) {
      ctx.qualReplayQueue.push({ ...ctx.currentReplay });
      ctx.currentReplay = undefined;
      await announce(ctx, `${playerLabel(ctx, target)} DC on replay — queued again.`);
      await promptNextQualReplay(ctx);
      return;
    }
  }

  const adjusted = [...byId.values()].map((row) => {
    const mods = row.mods?.length ? row.mods : settingsMods.get(row.osuId) ?? [];
    const rawScore = disconnected.has(row.osuId) && !isQualFormat(ctx.rules) ? 0 : row.score;
    const forcedZero = disconnected.has(row.osuId) && !isQualFormat(ctx.rules);
    const score = forcedZero
      ? 0
      : (slot?.freemod || mods.length)
        ? applyModMultipliers(rawScore, mods, multipliers)
        : rawScore;
    return {
      osuId: row.osuId,
      username: row.username,
      team: row.team,
      mods,
      rawScore,
      score,
      disconnected: forcedZero || undefined,
    };
  });

  let red = 0;
  let blue = 0;
  for (const row of adjusted) {
    const side = (row.team === 'blue' || row.team === '2')
      ? 'blue'
      : (row.team === 'red' || row.team === '1')
        ? 'red'
        : sideForUser(ctx, row.osuId, row.osuId);
    if (side === 'red') red += row.score;
    if (side === 'blue') blue += row.score;
  }
  const mapWinner: DraftSide = red >= blue ? 'red' : 'blue';
  if (!isQualFormat(ctx.rules)) {
    ctx.draft.score[mapWinner] += 1;
  }
  if (ctx.phase !== 'qual_replay') {
    ctx.draft.mapsPlayed += 1;
  }
  ctx.emitter.emit('score', {
    red: ctx.draft.score.red,
    blue: ctx.draft.score.blue,
    mapScores: adjusted,
    slot: slot?.slot,
    beatmapId: slot?.beatmapId,
  });

  if (ctx.phase === 'qual_replay') {
    ctx.currentReplay = undefined;
    await promptNextQualReplay(ctx);
    return;
  }

  if (isQualFormat(ctx.rules)) {
    await advancePlayAll(ctx);
    return;
  }

  await announce(ctx, statusLine(ctx.opts, ctx.draft.score, ctx.rules.bestOf, `Map: ${mapWinner}`));

  if (ctx.draft.score.red >= ctx.rules.firstTo || ctx.draft.score.blue >= ctx.rules.firstTo) {
    const tiedAlmost = ctx.draft.score.red === ctx.rules.firstTo - 1
      && ctx.draft.score.blue === ctx.rules.firstTo - 1;
    if (tiedAlmost) {
      setPhase(ctx, 'tb_mandatory');
      await playTiebreaker(ctx);
      return;
    }
    if (ctx.rules.optionalTb) {
      setPhase(ctx, 'tb_optional');
      await announce(ctx, 'Optional TB? Type !tb or !tb no.');
      await startTimer(ctx, ctx.rules.timers.rollChoiceSec, async () => {
        await finishMatch(ctx, 'first_to_no_tb');
      });
      return;
    }
    await finishMatch(ctx, 'first_to');
    return;
  }

  const phase = ctx.draft.script[ctx.draft.scriptIndex];
  if (phase?.type === 'pick_play') {
    if (phase.until.kind === 'maps_played' && ctx.draft.mapsPlayed >= phase.until.count) {
      ctx.draft.scriptIndex += 1;
      ctx.draft.actionsDoneInPhase = 0;
    }
  }
  setPhase(ctx, 'drafting');
  await promptDraftStep(ctx);
}

function rosterSubs(ctx: Internal, team?: string): string[] {
  const side = team === 'blue' ? 'blue' : team === 'red' ? 'red' : undefined;
  const roster = side === 'blue'
    ? ctx.opts.teams.blue?.players ?? []
    : side === 'red'
      ? ctx.opts.teams.red?.players ?? []
      : [...(ctx.opts.teams.red?.players ?? []), ...(ctx.opts.teams.blue?.players ?? [])];
  return roster.map((p) => p.osuId);
}

async function promptNextQualReplay(ctx: Internal) {
  const next = ctx.qualReplayQueue.shift();
  if (!next) {
    await finishMatch(ctx, 'play_all_done');
    return;
  }
  ctx.currentReplay = next;
  setPhase(ctx, 'qual_replay', next.slot);
  const name = playerLabel(ctx, next.forOsuId);
  await announce(
    ctx,
    `${name}: replay ${next.slot}? !yes (or team/sub) / !no → 0. Skipping = 0.`,
  );
  await startTimer(ctx, ctx.rules.timers.downloadReadySec, async () => {
    // Timeout = decline
    await declineQualReplay(ctx, next);
  });
}

function playerLabel(ctx: Internal, osuId: string): string {
  for (const team of [ctx.opts.teams.red, ctx.opts.teams.blue]) {
    const hit = team?.players.find((p) => p.osuId === osuId);
    if (hit) return hit.username ?? osuId;
  }
  return osuId;
}

function canAnswerReplay(ctx: Internal, item: QualReplayItem, user?: string, osuId?: string): boolean {
  const needle = (osuId ?? user ?? '').toLowerCase();
  if (!needle) return false;
  if (item.forOsuId.toLowerCase() === needle) return true;
  const side = item.team ?? sideForUser(ctx, user, osuId);
  if (!side) {
    // Solo qual: any roster mate
    return rosterSubs(ctx).some((id) => id.toLowerCase() === needle);
  }
  const team = side === 'red' ? ctx.opts.teams.red : ctx.opts.teams.blue;
  return Boolean(team?.players.some(
    (p) => p.osuId.toLowerCase() === needle || p.username?.toLowerCase() === needle,
  ));
}

async function acceptQualReplay(ctx: Internal, item: QualReplayItem) {
  await abortIrcTimer(ctx);
  const slot: MappoolSlot = {
    slot: item.slot,
    beatmapId: item.beatmapId,
    mods: item.mods,
    freemod: item.freemod,
    fmRules: item.fmRules,
    unbannable: false,
    unprotectable: false,
    tiebreaker: false,
  };
  resetAbortsForNewMap(ctx);
  await setLobbyMap(ctx, slot);
  await announce(ctx, `Replay ${item.slot} for ${playerLabel(ctx, item.forOsuId)} — ready up.`);
  await beginReadyGate(ctx, {
    label: `Replay ${item.slot} ready.`,
  });
}

async function declineQualReplay(ctx: Internal, item: QualReplayItem) {
  await abortIrcTimer(ctx);
  ctx.currentReplay = undefined;
  ctx.emitter.emit('score', {
    red: ctx.draft.score.red,
    blue: ctx.draft.score.blue,
    mapScores: [{
      osuId: item.forOsuId,
      score: 0,
      rawScore: 0,
      mods: [],
      team: item.team,
      disconnected: true,
    }],
    slot: item.slot,
    beatmapId: item.beatmapId,
  });
  await announce(ctx, `${playerLabel(ctx, item.forOsuId)} declined ${item.slot} → 0.`);
  await promptNextQualReplay(ctx);
}

async function playTiebreaker(ctx: Internal) {
  const tb = ctx.pool.find((row) => row.tiebreaker) ?? filterAvailableSlots(ctx.pool, ctx.draft, 'pick')[0];
  if (!tb) {
    await finishMatch(ctx, 'no_tb_map');
    return;
  }
  setPhase(ctx, 'tb_mandatory', tb.slot);
  resetAbortsForNewMap(ctx);
  await setLobbyMap(ctx, tb);
  await announce(ctx, `TB: ${tb.slot}${tb.freemod ? ' (FM)' : tb.mods.length ? ` (${tb.mods.join(' ')})` : ''}`);
  await beginReadyGate(ctx);
}

async function beginPlayAll(ctx: Internal) {
  setPhase(ctx, 'playing_all');
  ctx.draft.scriptIndex = 0;
  await advancePlayAll(ctx);
}

async function advancePlayAll(ctx: Internal) {
  const playable = ctx.pool.filter((row) => !row.tiebreaker);
  const runs = ctx.rules.qualPoolRuns;
  const totalMaps = playable.length * runs;
  if (!playable.length || ctx.draft.mapsPlayed >= totalMaps) {
    if (ctx.qualReplayQueue.length) {
      await promptNextQualReplay(ctx);
      return;
    }
    await finishMatch(ctx, 'play_all_done');
    return;
  }
  const next = playable[ctx.draft.mapsPlayed % playable.length]!;
  const run = Math.floor(ctx.draft.mapsPlayed / playable.length) + 1;
  setPhase(ctx, 'playing_all', next.slot);
  resetAbortsForNewMap(ctx);
  await setLobbyMap(ctx, next);
  const modSuffix = next.freemod ? ' FM' : next.mods.length ? ` ${next.mods.join(' ')}` : '';
  const runSuffix = runs > 1 ? ` (run ${run}/${runs})` : '';
  await announce(ctx, `${next.slot}${modSuffix}${runSuffix}`);
  await beginReadyGate(ctx);
}

async function finishForfeit(
  ctx: Internal,
  input: { side?: DraftSide; both?: boolean; reason: string },
) {
  await abortIrcTimer(ctx);
  setPhase(ctx, 'forfeit', input.reason);
  ctx.emitter.emit('forfeit', input);
  let winner: DraftSide | undefined;
  if (input.both) {
    const redSeed = ctx.opts.teams.red?.seed ?? 999;
    const blueSeed = ctx.opts.teams.blue?.seed ?? 999;
    winner = redSeed <= blueSeed ? 'red' : 'blue';
  } else if (input.side === 'red') winner = 'blue';
  else if (input.side === 'blue') winner = 'red';
  ctx.emitter.emit('finished', {
    winner,
    score: ctx.draft.score,
    reason: input.reason,
  });
  await announce(ctx, `Forfeit: ${input.reason}${winner ? ` — winner ${winner}` : ''}`);
  await safeClose(ctx);
}

async function finishMatch(ctx: Internal, reason: string) {
  await abortIrcTimer(ctx);
  if (isQualFormat(ctx.rules)) {
    setPhase(ctx, 'finished', reason);
    ctx.emitter.emit('finished', {
      winner: undefined,
      score: ctx.draft.score,
      reason,
    });
    const closeSec = ctx.rules.timers.qualCloseSec;
    await announce(ctx, `Qualifiers complete. Closing in ${closeSec}s.`);
    if (closeSec <= 0) {
      await safeClose(ctx);
      return;
    }
    await startTimer(ctx, closeSec, async () => {
      await safeClose(ctx);
    });
    return;
  }

  const winner: DraftSide | undefined = ctx.draft.score.red === ctx.draft.score.blue
    ? undefined
    : ctx.draft.score.red > ctx.draft.score.blue ? 'red' : 'blue';
  setPhase(ctx, 'finished', reason);
  const a = ctx.opts.teams.red?.name ?? 'Red';
  const b = ctx.opts.teams.blue?.name ?? 'Blue';
  await announce(ctx, `${a} | ${ctx.draft.score.red} - ${ctx.draft.score.blue} | ${b} // Winner: ${winner ?? 'draw'}`);
  ctx.emitter.emit('finished', { winner, score: ctx.draft.score, reason });
  await safeClose(ctx);
}

async function safeClose(ctx: Internal) {
  if (ctx.closed) return;
  ctx.closed = true;
  clearReadyPoll(ctx);
  clearTimer(ctx);
  try {
    if (ctx.channel) await ctx.irc.closeLobby(ctx.channel);
  } catch {
    // ignore
  }
  ctx.gate.release(ctx.id);
}

async function handleStartGate(ctx: Internal, override = false) {
  if (!ctx.channel) return;
  const inspected = await ctx.irc.inspectLobbyReady(ctx.channel);
  if (!override) {
    const notReady = inspected.players.filter((row) => !row.ready);
    if (inspected.players.length === 0 || notReady.length) {
      await announce(ctx, 'Not all Ready.');
      return;
    }
    const red = inspected.players.filter((row) => row.team === 'red' || sideForUser(ctx, row.username, row.osuId) === 'red').length;
    const blue = inspected.players.filter((row) => row.team === 'blue' || sideForUser(ctx, row.username, row.osuId) === 'blue').length;
    const pps = ctx.rules.playersPerSide;
    const incomplete: DraftSide[] = [];
    if (ctx.rules.format === 'team_match') {
      if (red < pps) incomplete.push('red');
      if (blue < pps) incomplete.push('blue');
    }
    if (incomplete.length) {
      if (ctx.rules.lineupMode === 'strict') {
        await announce(ctx, `Lineup incomplete. Need ${pps}/side.`);
        return;
      }
      ctx.pendingContinue = new Set(incomplete);
      ctx.continueAcks = new Set();
      await announce(ctx, `Incomplete (${incomplete.join(', ')}). Type !continue.`);
      return;
    }
    const slot = ctx.currentSlot;
    if (slot?.freemod && slot.fmRules) {
      const fm = validateFmRules(
        inspected.players.map((row) => ({
          mods: row.mods ?? [],
          team: row.team ?? sideForUser(ctx, row.username, row.osuId),
        })),
        slot.fmRules,
      );
      if (!fm.ok) {
        await announce(ctx, fm.detail ?? 'FM composition invalid.');
        return;
      }
    }
  }
  await markMapStarted(ctx);
  await ctx.irc.startMatch(ctx.channel, 5);
}

export function createMatchReferee(
  irc: BanchoIrcClient,
  rawOptions: CreateMatchRefereeOptions,
  deps?: { capacity?: LobbyCapacityGate },
): MatchReferee {
  const opts = createMatchRefereeOptionsSchema.parse(rawOptions);
  const rules = opts.rules;
  const script = resolveDraftScript(rules);
  const emitter = new RefereeEmitter();
  const gate = deps?.capacity ?? createLobbyCapacityGate(4);
  const id = randomUUID();

  const ctx: Internal = {
    irc,
    opts,
    rules,
    gate,
    emitter,
    id,
    phase: 'setup',
    draft: {
      script,
      scriptIndex: 0,
      actionsDoneInPhase: 0,
      protects: [],
      bans: [],
      picks: [],
      score: { red: 0, blue: 0 },
      mapsPlayed: 0,
    },
    pool: opts.mappool.slots,
    mapInProgress: false,
    abortsThisMap: 0,
    abortPending: false,
    leftDuringMap: new Set(),
    awaitingScoreApply: false,
    rolls: {},
    rollTieAttempts: 0,
    qualReplayQueue: [],
    warmupVotes: {},
    pendingContinue: new Set(),
    continueAcks: new Set(),
    closed: false,
  };

  irc.onChat(async ({ channel, user, message }) => {
    if (ctx.channel && channel !== ctx.channel) return;
    emitter.emit('chat', { channel, user, message });
    // Individual ready or BanchoBot "All players are ready" → !mp settings + rules, then start (abort countdown).
    if (/changed to\s+Ready\b/i.test(message) || isAllPlayersReadyMessage(message)) {
      void tryStartIfReady(ctx);
    }
    await dispatchInternal(ctx, { type: 'chat', user, message });
  });

  irc.onMatchFinished(async ({ channel, scores }) => {
    if (ctx.channel && channel !== ctx.channel) return;
    await onMapFinished(ctx, scores);
  });

  irc.onMatchAborted(async ({ channel }) => {
    if (ctx.channel && channel !== ctx.channel) return;
    await onMatchAborted(ctx, {
      reason: ctx.abortPending ? 'bot_or_referee_abort' : 'referee_abort',
      byBot: ctx.abortPending,
    });
  });

  irc.onPlayerJoined(async ({ channel }) => {
    if (ctx.channel && channel !== ctx.channel) return;
    await maybeAdvanceOnJoin(ctx);
  });

  irc.onPlayerLeft(async ({ channel, username, osuId }) => {
    if (ctx.channel && channel !== ctx.channel) return;
    await onPlayerLeftDuringMap(ctx, username ?? osuId);
  });

  return {
    id,
    on: emitter.on.bind(emitter),
    getState: () => snapshot(ctx),
    getSnapshot: () => fsmSnapshot(ctx),
    async start() {
      await waitForCapacity(gate, id);
      if (opts.resume) {
        ctx.channel = opts.resume.channel.startsWith('#')
          ? opts.resume.channel
          : `#mp_${opts.resume.mpId}`;
        ctx.mpId = opts.resume.mpId;
        ctx.url = opts.resume.url ?? `https://osu.ppy.sh/mp/${opts.resume.mpId}`;
        await irc.joinChannel(ctx.channel);
        const snap = opts.resume.snapshot;
        if (snap?.score) ctx.draft.score = { ...snap.score };
        if (typeof snap?.mapsPlayed === 'number') ctx.draft.mapsPlayed = snap.mapsPlayed;
        if (Array.isArray(snap?.qualReplayQueue)) {
          ctx.qualReplayQueue = snap.qualReplayQueue as QualReplayItem[];
        }
        if (snap?.awaitingScoreApply) {
          ctx.awaitingScoreApply = true;
          ctx.awaitingScoreSince = typeof snap.awaitingScoreSince === 'string'
            ? snap.awaitingScoreSince
            : new Date().toISOString();
        }
        emitter.emit('lobby_created', {
          mpId: ctx.mpId,
          channel: ctx.channel,
          url: ctx.url,
          lobbyName: opts.lobbyName,
        });
        const phase = (snap?.phase as RefereePhase | undefined) ?? 'joining';
        setPhase(ctx, phase, 'resumed');
        await announce(ctx, `Resumed ${ctx.url}`);
        if (phase === 'qual_replay' && ctx.qualReplayQueue.length) {
          await promptNextQualReplay(ctx);
        } else if (phase === 'playing_all' || phase === 'playing') {
          await advancePlayAll(ctx);
        } else if (phase === 'joining' || phase === 'setup') {
          await beginJoin(ctx);
        }
        // Other phases: staff continues via dispatch / chat
        return;
      }

      setPhase(ctx, 'setup');
      const created = await irc.createMultiLobby(opts.lobbyName);
      ctx.channel = created.channel;
      ctx.mpId = created.mpId;
      ctx.url = created.url;
      emitter.emit('lobby_created', {
        mpId: created.mpId,
        channel: created.channel,
        url: created.url,
        lobbyName: opts.lobbyName,
      });

      const size = Math.min(16, rules.playersPerSide * 2 + rules.mp.extraSlots);
      await irc.setSize(created.channel, size);
      const teamMode = isQualFormat(rules)
        ? teamModeCode(String(rules.mp.teamMode || 'HeadToHead'))
        : teamModeCode(String(rules.mp.teamMode || 'TeamVS'));
      // Qual default HeadToHead when edition left TeamVS accidentally
      const resolvedTeam = isQualFormat(rules) && teamMode === 2
        ? 0
        : teamMode;
      const winCond = winConditionCode(String(rules.mp.winCondition || 'Score'));
      await irc.mpSet(created.channel, `${resolvedTeam} ${winCond}`);
      await announce(ctx, created.url);
      await beginJoin(ctx);
    },
    async close() {
      await safeClose(ctx);
    },
    async dispatch(action) {
      await dispatchInternal(ctx, action);
    },
  };
}

async function dispatchInternal(ctx: Internal, action: RefereeDispatch) {
  if (ctx.closed) return;

  if (action.type === 'score.apply') {
    await applyMapScores(ctx, action.scores);
    return;
  }
  if (action.type === 'referee_override_start') {
    await handleStartGate(ctx, true);
    return;
  }
  if (action.type === 'start') {
    await handleStartGate(ctx, false);
    return;
  }
  if (action.type === 'continue') {
    for (const side of ctx.pendingContinue) ctx.continueAcks.add(side);
    if ([...ctx.pendingContinue].every((side) => ctx.continueAcks.has(side))) {
      ctx.pendingContinue.clear();
      await markMapStarted(ctx);
      await ctx.irc.startMatch(ctx.channel!, 5);
    }
    return;
  }
  if (action.type === 'roll.choice') {
    applyChoice(ctx, action.choice);
    await beginDrafting(ctx);
    return;
  }
  if (action.type === 'roll') {
    const side = action.side ?? sideForUser(ctx, undefined, action.osuId);
    if (side) await recordCaptainRoll(ctx, side, action.value);
    return;
  }
  if (action.type === 'draft.protect' || action.type === 'draft.ban' || action.type === 'draft.pick') {
    const kind = action.type === 'draft.protect' ? 'protect' : action.type === 'draft.ban' ? 'ban' : 'pick';
    const side = action.side ?? ctx.draft.rollWinner ?? 'red';
    await applyDraftAction(ctx, kind, action.slot, side);
    return;
  }
  if (action.type === 'warmup.yes' || action.type === 'warmup.no') {
    const side = action.side ?? 'red';
    ctx.warmupVotes[side] = action.type === 'warmup.yes';
    await maybeFinishWarmupVote(ctx);
    return;
  }
  if (action.type === 'warmup.done') {
    await endWarmups(ctx);
    return;
  }
  if (action.type === 'tb.yes') {
    if (ctx.phase === 'tb_optional') {
      await abortIrcTimer(ctx);
      await playTiebreaker(ctx);
    }
    return;
  }
  if (action.type === 'tb.no') {
    if (ctx.phase === 'tb_optional') {
      await abortIrcTimer(ctx);
      await finishMatch(ctx, 'first_to_no_tb');
    }
    return;
  }
  if (action.type === 'replay.yes' || action.type === 'replay.no') {
    const item = ctx.currentReplay;
    if (!item || ctx.phase !== 'qual_replay') return;
    if (action.type === 'replay.yes') await acceptQualReplay(ctx, item);
    else await declineQualReplay(ctx, item);
    return;
  }

  if (action.type !== 'chat') return;
  const parsed = parseRefereeChat(action.message);
  const side = sideForUser(ctx, action.user, action.osuId);

  if (parsed.kind === 'bancho_roll') {
    const rollSide = sideForUser(ctx, parsed.user, parsed.user);
    if (rollSide) await recordCaptainRoll(ctx, rollSide, parsed.value);
    return;
  }
  if (parsed.kind === 'roll' && side && isCaptain(ctx, side, action.user, action.osuId)) {
    // Player typed !roll — BanchoBot will echo the result; no-op until bancho_roll
    return;
  }

  if (parsed.kind === 'start') {
    await handleStartGate(ctx, false);
    return;
  }
  if (parsed.kind === 'continue' && side) {
    if (!ctx.pendingContinue.has(side)) {
      await announce(ctx, `${side} does not need to confirm.`);
      return;
    }
    ctx.continueAcks.add(side);
    const remaining = [...ctx.pendingContinue].filter((row) => !ctx.continueAcks.has(row));
    if (remaining.length) {
      await announce(ctx, `${side} confirmed. Waiting: ${remaining.join(', ')}.`);
      return;
    }
    ctx.pendingContinue.clear();
    await announce(ctx, 'Short-handed start confirmed.');
    await markMapStarted(ctx);
    await ctx.irc.startMatch(ctx.channel!, 5);
    return;
  }

  if (ctx.phase === 'warmups' && parsed.kind === 'si') {
    await endWarmups(ctx);
    return;
  }

  if (ctx.phase === 'qual_replay' && ctx.currentReplay && (parsed.kind === 'si' || parsed.kind === 'no')) {
    if (!canAnswerReplay(ctx, ctx.currentReplay, action.user, action.osuId)) {
      await announce(ctx, 'Only the player or their team may answer the replay.');
      return;
    }
    if (parsed.kind === 'si') await acceptQualReplay(ctx, ctx.currentReplay);
    else await declineQualReplay(ctx, ctx.currentReplay);
    return;
  }

  if (ctx.phase === 'tb_optional' && (parsed.kind === 'tb_yes' || parsed.kind === 'si')) {
    await abortIrcTimer(ctx);
    await playTiebreaker(ctx);
    return;
  }
  if (ctx.phase === 'tb_optional' && (parsed.kind === 'tb_no' || parsed.kind === 'no')) {
    await abortIrcTimer(ctx);
    await finishMatch(ctx, 'first_to_no_tb');
    return;
  }

  if (ctx.phase === 'warmup_vote' && (parsed.kind === 'si' || parsed.kind === 'no') && side) {
    ctx.warmupVotes[side] = parsed.kind === 'si';
    await maybeFinishWarmupVote(ctx);
    return;
  }

  if (ctx.phase === 'roll_choice' && parsed.kind === 'choice' && side && side === ctx.draft.rollWinner) {
    applyChoice(ctx, parsed.choice);
    await beginDrafting(ctx);
    return;
  }

  if (ctx.phase === 'drafting' && (parsed.kind === 'protect' || parsed.kind === 'ban' || parsed.kind === 'pick') && side) {
    if (!isCaptain(ctx, side, action.user, action.osuId)) {
      await announce(ctx, 'Only captains may draft.');
      return;
    }
    const slot = parsed.slot;
    if (!slot) return;
    const phase = ctx.draft.script[ctx.draft.scriptIndex];
    const phaseKind: 'protect' | 'ban' | 'pick' = phase?.type === 'pick_play'
      ? 'pick'
      : phase?.type === 'protect'
        ? 'protect'
        : 'ban';
    const effective = parsed.kind === 'pick' ? phaseKind : parsed.kind;
    await applyDraftAction(ctx, effective, slot, side);
  }
}

async function maybeFinishWarmupVote(ctx: Internal) {
  const red = ctx.warmupVotes.red;
  const blue = ctx.warmupVotes.blue;
  if (red === undefined || blue === undefined) return;
  await abortIrcTimer(ctx);
  if (!red && !blue) {
    await beginRollChoice(ctx);
    return;
  }
  await beginWarmups(ctx);
}

function captainHostTarget(ctx: Internal, side: DraftSide): string | undefined {
  const capId = side === 'red' ? ctx.opts.captains?.redOsuId : ctx.opts.captains?.blueOsuId;
  const team = side === 'red' ? ctx.opts.teams.red : ctx.opts.teams.blue;
  return capId
    ?? team?.players.find((p) => p.isCaptain)?.username
    ?? team?.players[0]?.username
    ?? team?.players[0]?.osuId;
}

async function beginWarmups(ctx: Internal) {
  setPhase(ctx, 'warmups');
  const warmupMap = ctx.pool.find((row) => !row.tiebreaker) ?? ctx.pool[0];
  if (!warmupMap || !ctx.channel) {
    await beginRollChoice(ctx);
    return;
  }
  await setLobbyMap(ctx, warmupMap);
  // One host at a time: red turn if they voted yes, else blue, else done.
  if (ctx.warmupVotes.red) {
    await startWarmupTurn(ctx, 'red');
    return;
  }
  if (ctx.warmupVotes.blue) {
    await startWarmupTurn(ctx, 'blue');
    return;
  }
  await beginRollChoice(ctx);
}

async function startWarmupTurn(ctx: Internal, side: DraftSide) {
  ctx.warmupTurn = side;
  if (ctx.channel) {
    try {
      await ctx.irc.mpClearHost(ctx.channel);
    } catch {
      // ignore
    }
  }
  const host = captainHostTarget(ctx, side);
  if (host && ctx.channel) {
    await ctx.irc.mpHost(ctx.channel, host);
    await announce(ctx, `Warmup (${side}): ${host} hosts. Type !yes when done.`);
  } else {
    await announce(ctx, `Warmup (${side}). Type !yes when done.`);
  }
  await startTimer(ctx, ctx.rules.timers.warmupPickSec, async () => {
    await advanceWarmupTurn(ctx);
  });
}

async function advanceWarmupTurn(ctx: Internal) {
  if (ctx.phase !== 'warmups') return;
  await abortIrcTimer(ctx);
  if (ctx.channel) {
    try {
      await ctx.irc.mpClearHost(ctx.channel);
    } catch {
      // ignore
    }
  }
  const current = ctx.warmupTurn;
  if (current === 'red' && ctx.warmupVotes.blue) {
    await startWarmupTurn(ctx, 'blue');
    return;
  }
  ctx.warmupTurn = undefined;
  await announce(ctx, 'Warmups done.');
  await beginRollChoice(ctx);
}

/** @deprecated use advanceWarmupTurn — kept name for dispatch handlers */
async function endWarmups(ctx: Internal) {
  await advanceWarmupTurn(ctx);
}
