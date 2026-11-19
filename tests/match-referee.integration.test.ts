import { describe, expect, it } from 'vitest';
import { createBanchoIrcClient } from '../src/irc/client.js';
import { FakeBanchoIrcClient } from '../src/irc/fake-client.js';
import { createMatchReferee } from '../src/referee/match-referee.js';
import { classicDraftPreset } from '../src/draft/presets.js';

describe('MatchReferee FakeIRC', () => {
  it('creates lobby and emits mp url', async () => {
    const irc = await createBanchoIrcClient({ fake: true }) as FakeBanchoIrcClient;
    const created: Array<{ url: string; mpId: string }> = [];
    const match = createMatchReferee(irc, {
      lobbyName: 'TEST: (A) vs (B)',
      rules: {
        ...classicDraftPreset({ firstTo: 1, bansPerTeam: 0, protectsPerTeam: 0 }),
        format: 'team_match',
        playersPerSide: 1,
        timers: {
          joinSec: 2,
          warmupVoteSec: 1,
          warmupPickSec: 1,
          downloadReadySec: 1,
          downloadGraceSec: 1,
          draftActionSec: 1,
          rollChoiceSec: 1,
        },
      },
      teams: {
        red: { name: 'A', players: [{ osuId: '10', username: 'RedCap', isCaptain: true }] },
        blue: { name: 'B', players: [{ osuId: '20', username: 'BlueCap', isCaptain: true }] },
      },
      captains: { redOsuId: '10', blueOsuId: '20' },
      mappool: {
        slots: [
          { slot: 'NM1', beatmapId: '100', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
        ],
      },
    });
    match.on('lobby_created', (e) => created.push(e));
    await match.start();
    expect(created[0]?.url).toMatch(/osu\.ppy\.sh\/mp\//);
    expect(irc.commands.some((row) => row.startsWith('!mp size'))).toBe(true);
    await match.close();
  });

  it('sets map then mods separately and advances after match finished', async () => {
    const irc = await createBanchoIrcClient({ fake: true }) as FakeBanchoIrcClient;
    const phases: string[] = [];
    const match = createMatchReferee(irc, {
      lobbyName: 'QUAL',
      rules: {
        format: 'qualifier',
        playersPerSide: 1,
        firstTo: 99,
        bestOf: 99,
        protectsPerTeam: 0,
        bansPerTeam: 0,
        timers: {
          joinSec: 1,
          warmupVoteSec: 1,
          warmupPickSec: 1,
          downloadReadySec: 30,
          downloadGraceSec: 1,
          draftActionSec: 1,
          rollChoiceSec: 1,
        },
      },
      invites: ['lehenna'],
      teams: { red: { name: 'Solo', players: [{ osuId: '1', username: 'lehenna' }] } },
      mappool: {
        slots: [
          { slot: 'NM1', beatmapId: '2275555', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
          { slot: 'HD2', beatmapId: '75930', mods: ['HD'], unbannable: false, unprotectable: false, tiebreaker: false },
        ],
      },
    });
    match.on('phase', (e) => phases.push(e.phase));
    await match.start();
    const channel = match.getState().channel!;
    const mpId = match.getState().mpId!;
    irc.setPlayerReady(channel, '1', true, 'lehenna', 1, 'red');
    // Skip join window → play_all
    await new Promise((r) => setTimeout(r, 1200));
    expect(irc.commands).toContain('!mp map 2275555');
    expect(irc.commands).toContain('!mp mods None');

    await irc.emitMatchFinished(channel, mpId, []);
    // Host path: empty IRC scores → score.apply from osu API (simulated here)
    await match.dispatch({ type: 'score.apply', scores: [{ osuId: '1', score: 1000 }] });
    await new Promise((r) => setTimeout(r, 100));
    expect(irc.commands).toContain('!mp map 75930');
    expect(irc.commands).toContain('!mp mods HD');
    await match.close();
  });

  it('aborts on leave within grace and does not advance map', async () => {
    const irc = await createBanchoIrcClient({ fake: true }) as FakeBanchoIrcClient;
    const aborts: Array<{ reason: string }> = [];
    const match = createMatchReferee(irc, {
      lobbyName: 'QUAL-ABORT',
      rules: {
        format: 'qualifier',
        playersPerSide: 1,
        firstTo: 99,
        bestOf: 99,
        protectsPerTeam: 0,
        bansPerTeam: 0,
        maxAbortsPerMap: 2,
        timers: {
          joinSec: 1,
          warmupVoteSec: 1,
          warmupPickSec: 1,
          downloadReadySec: 30,
          downloadGraceSec: 1,
          draftActionSec: 1,
          rollChoiceSec: 1,
          abortGraceSec: 60,
          abortReadySec: 30,
        },
      },
      invites: ['lehenna'],
      teams: { red: { name: 'Solo', players: [{ osuId: '1', username: 'lehenna' }] } },
      mappool: {
        slots: [
          { slot: 'NM1', beatmapId: '111', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
          { slot: 'NM2', beatmapId: '222', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
        ],
      },
    });
    match.on('abort', (e) => aborts.push(e));
    await match.start();
    const channel = match.getState().channel!;
    const mpId = match.getState().mpId!;
    irc.setPlayerReady(channel, '1', true, 'lehenna', 1, 'red');
    await new Promise((r) => setTimeout(r, 1200));
    // Force start path: poll may need ready via inspect
    await match.dispatch({ type: 'referee_override_start' });
    // Simulate map in progress via startMatch already; emit leave
    // Ensure map started: startMatch was called
    expect(irc.commands).toContain('!mp start 5');

    // Manually mark by calling leave — need mapInProgress. Override start sets it.
    await irc.emitPlayerLeft(channel, mpId, '1', 'lehenna');
    await new Promise((r) => setTimeout(r, 50));
    expect(irc.commands).toContain('!mp abort');

    await irc.emitMatchAborted(channel, mpId);
    await new Promise((r) => setTimeout(r, 50));
    expect(aborts.length).toBeGreaterThanOrEqual(1);
    // Still on first map — no NM2 yet
    expect(irc.commands.filter((c) => c === '!mp map 222')).toHaveLength(0);
    await match.close();
  });

  it('runs qualPoolRuns and closes without winner IRC', async () => {
    const irc = await createBanchoIrcClient({ fake: true }) as FakeBanchoIrcClient;
    const ircMessages: string[] = [];
    const scores: Array<{ score: number; mods?: string[] }> = [];
    const match = createMatchReferee(irc, {
      lobbyName: 'QUAL-RUNS',
      rules: {
        format: 'qualifier',
        playersPerSide: 1,
        firstTo: 99,
        bestOf: 99,
        protectsPerTeam: 0,
        bansPerTeam: 0,
        qualPoolRuns: 2,
        timers: {
          joinSec: 1,
          downloadReadySec: 30,
          downloadGraceSec: 1,
          draftActionSec: 1,
          rollChoiceSec: 1,
          warmupVoteSec: 1,
          warmupPickSec: 1,
          qualCloseSec: 1,
        },
      },
      invites: ['p1'],
      teams: { red: { name: 'Solo', players: [{ osuId: '1', username: 'p1' }] } },
      mappool: {
        slots: [
          { slot: 'NM1', beatmapId: '10', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
          { slot: 'NM2', beatmapId: '20', mods: [], unbannable: false, unprotectable: false, tiebreaker: false },
        ],
      },
    });
    match.on('announce', (e) => {
      // track domain announces that also went IRC via fake messages later
      void e;
    });
    match.on('score', (e) => {
      for (const row of e.mapScores ?? []) scores.push({ score: row.score, mods: row.mods });
    });
    await match.start();
    const channel = match.getState().channel!;
    const mpId = match.getState().mpId!;
    irc.setPlayerReady(channel, '1', true, 'p1', 1, 'red');
    await new Promise((r) => setTimeout(r, 1200));

    // 2 maps × 2 runs = 4 finishes
    for (let i = 0; i < 4; i++) {
      await match.dispatch({ type: 'referee_override_start' });
      await irc.emitMatchFinished(channel, mpId, [{ osuId: '1', score: 1000, team: 'red' }]);
      await new Promise((r) => setTimeout(r, 80));
    }

    expect(irc.commands.filter((c) => c === '!mp map 10').length).toBeGreaterThanOrEqual(2);
    expect(irc.commands.filter((c) => c === '!mp map 20').length).toBeGreaterThanOrEqual(2);
    expect(irc.messages.some((m) => /Winner:/i.test(m.content))).toBe(false);
    expect(irc.messages.some((m) => /Qualifiers complete/i.test(m.content))).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));
    expect(irc.commands).toContain('!mp close');
    void ircMessages;
    void scores;
  });

  it('blocks FM start when composition invalid and applies multipliers on score', async () => {
    const irc = await createBanchoIrcClient({ fake: true }) as FakeBanchoIrcClient;
    const scoreEvents: Array<{ score: number; rawScore?: number; mods?: string[] }> = [];
    const match = createMatchReferee(irc, {
      lobbyName: 'QUAL-FM',
      rules: {
        format: 'qualifier',
        playersPerSide: 1,
        firstTo: 99,
        bestOf: 99,
        protectsPerTeam: 0,
        bansPerTeam: 0,
        timers: {
          joinSec: 1,
          downloadReadySec: 30,
          downloadGraceSec: 1,
          draftActionSec: 1,
          rollChoiceSec: 1,
          warmupVoteSec: 1,
          warmupPickSec: 1,
          qualCloseSec: 1,
        },
      },
      invites: ['a', 'b'],
      teams: {
        red: {
          name: 'Duo',
          players: [
            { osuId: '1', username: 'a' },
            { osuId: '2', username: 'b' },
          ],
        },
      },
      mappool: {
        slots: [
          {
            slot: 'FM1',
            beatmapId: '99',
            mods: ['FM'],
            freemod: true,
            fmRules: {
              scope: 'lobby',
              requiredGroups: [
                { anyOf: [['HD']], count: 1 },
                { anyOf: [['HR']], count: 1 },
              ],
            },
            unbannable: false,
            unprotectable: false,
            tiebreaker: false,
          },
        ],
      },
    });
    match.on('score', (e) => {
      for (const row of e.mapScores ?? []) {
        scoreEvents.push({ score: row.score, rawScore: row.rawScore, mods: row.mods });
      }
    });
    await match.start();
    const channel = match.getState().channel!;
    const mpId = match.getState().mpId!;
    // Both HD — invalid
    irc.setPlayerReady(channel, '1', true, 'a', 1, 'red', ['HD']);
    irc.setPlayerReady(channel, '2', true, 'b', 2, 'red', ['HD']);
    await new Promise((r) => setTimeout(r, 1200));
    expect(irc.commands).toContain('!mp mods Freemod');
    const startsBefore = irc.commands.filter((c) => c === '!mp start 5').length;
    await irc.emitChat(channel, 'BanchoBot', 'All players are ready');
    await new Promise((r) => setTimeout(r, 100));
    expect(irc.messages.some((m) => /FM need/i.test(m.content))).toBe(true);
    expect(irc.commands.filter((c) => c === '!mp start 5').length).toBe(startsBefore);

    // Fix composition
    irc.setPlayerReady(channel, '2', true, 'b', 2, 'red', ['HR']);
    await irc.emitChat(channel, 'BanchoBot', 'All players are ready');
    await new Promise((r) => setTimeout(r, 100));
    expect(irc.commands.filter((c) => c === '!mp start 5').length).toBeGreaterThan(startsBefore);

    await irc.emitMatchFinished(channel, mpId, [
      { osuId: '1', score: 1_000_000, team: 'red', mods: ['HD'] },
      { osuId: '2', score: 1_000_000, team: 'red', mods: ['HR'] },
    ]);
    await new Promise((r) => setTimeout(r, 80));
    expect(scoreEvents.find((r) => r.mods?.includes('HD'))?.score).toBe(Math.round(1_000_000 * 1.06));
    expect(scoreEvents.find((r) => r.mods?.includes('HR'))?.score).toBe(Math.round(1_000_000 * 1.12));
    await match.close();
  });
});

