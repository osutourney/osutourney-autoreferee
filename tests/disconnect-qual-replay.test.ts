import { describe, expect, it } from 'vitest';
import { createBanchoIrcClient } from '../src/irc/client.js';
import { FakeBanchoIrcClient } from '../src/irc/fake-client.js';
import { createMatchReferee } from '../src/referee/match-referee.js';

describe('disconnect + qual replay', () => {
  it('zeros DC after grace in team match', async () => {
    const irc = await createBanchoIrcClient({ fake: true }) as FakeBanchoIrcClient;
    const scores: Array<{ osuId: string; score: number; disconnected?: boolean }> = [];
    const match = createMatchReferee(irc, {
      lobbyName: 'MATCH-DC',
      rules: {
        format: 'team_match',
        playersPerSide: 1,
        firstTo: 5,
        bestOf: 9,
        protectsPerTeam: 0,
        bansPerTeam: 0,
        timers: {
          joinSec: 60,
          warmupVoteSec: 60,
          warmupPickSec: 60,
          downloadReadySec: 30,
          downloadGraceSec: 1,
          draftActionSec: 60,
          rollChoiceSec: 60,
          abortGraceSec: 0,
          abortReadySec: 1,
        },
      },
      teams: {
        red: { name: 'A', players: [{ osuId: '10', username: 'RedCap', isCaptain: true }] },
        blue: { name: 'B', players: [{ osuId: '20', username: 'BlueCap', isCaptain: true }] },
      },
      captains: { redOsuId: '10', blueOsuId: '20' },
      mappool: {
        slots: [
          { slot: 'NM1', beatmapId: '1', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
        ],
      },
    });
    match.on('score', (e) => {
      for (const row of e.mapScores ?? []) {
        scores.push({ osuId: row.osuId, score: row.score, disconnected: row.disconnected });
      }
    });
    await match.start();
    const channel = match.getState().channel!;
    const mpId = match.getState().mpId!;

    // Force pick/play without waiting join/warmup/roll timers
    await match.dispatch({ type: 'draft.pick', slot: 'NM1', side: 'red' });
    await match.dispatch({ type: 'referee_override_start' });
    await irc.emitPlayerLeft(channel, mpId, '10', 'RedCap');
    await irc.emitMatchFinished(channel, mpId, [
      { osuId: '10', score: 999_999, team: 'red' },
      { osuId: '20', score: 500_000, team: 'blue' },
    ]);
    await new Promise((r) => setTimeout(r, 100));
    expect(scores.find((r) => r.osuId === '10')?.score).toBe(0);
    expect(scores.find((r) => r.osuId === '20')?.score).toBe(500_000);
    await match.close();
  });

  it('queues qual DC for replay and accepts !yes', async () => {
    const irc = await createBanchoIrcClient({ fake: true }) as FakeBanchoIrcClient;
    const announces: string[] = [];
    const match = createMatchReferee(irc, {
      lobbyName: 'QUAL-DC',
      rules: {
        format: 'qualifier',
        playersPerSide: 1,
        firstTo: 99,
        bestOf: 99,
        protectsPerTeam: 0,
        bansPerTeam: 0,
        qualPoolRuns: 1,
        timers: {
          joinSec: 1,
          downloadReadySec: 30,
          downloadGraceSec: 1,
          draftActionSec: 1,
          rollChoiceSec: 1,
          warmupVoteSec: 1,
          warmupPickSec: 1,
          abortGraceSec: 0,
          qualCloseSec: 1,
        },
      },
      invites: ['p1'],
      teams: { red: { name: 'Solo', players: [{ osuId: '1', username: 'p1' }] } },
      mappool: {
        slots: [
          { slot: 'NM1', beatmapId: '10', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
        ],
      },
    });
    match.on('announce', (e) => announces.push(e.message));
    await match.start();
    const channel = match.getState().channel!;
    const mpId = match.getState().mpId!;
    irc.setPlayerReady(channel, '1', true, 'p1', 1, 'red');
    await new Promise((r) => setTimeout(r, 1200));
    await match.dispatch({ type: 'referee_override_start' });
    await irc.emitPlayerLeft(channel, mpId, '1', 'p1');
    await irc.emitMatchFinished(channel, mpId, []);
    await match.dispatch({ type: 'score.apply', scores: [] });
    await new Promise((r) => setTimeout(r, 100));
    expect(announces.some((m) => /replay NM1/i.test(m))).toBe(true);

    await match.dispatch({ type: 'replay.yes' });
    await new Promise((r) => setTimeout(r, 50));
    expect(irc.commands).toContain('!mp map 10');
    await match.dispatch({ type: 'referee_override_start' });
    await irc.emitMatchFinished(channel, mpId, [{ osuId: '1', score: 800_000 }]);
    await new Promise((r) => setTimeout(r, 100));
    expect(announces.some((m) => /Qualifiers complete/i.test(m))).toBe(true);
    await match.close();
  });
});
