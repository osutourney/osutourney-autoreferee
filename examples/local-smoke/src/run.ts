import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBanchoIrcClient,
  createMatchReferee,
} from '@osutourney/autoreferee';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'config.json');
if (!existsSync(configPath)) {
  console.error('Missing config.json — copy config.example.json');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
  fake?: boolean;
  username?: string;
  password?: string;
  lobbyName: string;
  invite?: string;
  format?: 'qualifier' | 'play_all' | 'team_match';
  playersPerSide?: number;
  lineupMode?: 'strict' | 'flexible';
  maxAbortsPerMap?: number;
  qualPoolRuns?: number;
  modMultipliers?: Record<string, number>;
  timers?: Record<string, number>;
  mappool?: Array<{
    slot: string;
    beatmapId: string;
    mods?: string[];
    freemod?: boolean;
    fmRules?: {
      scope?: 'lobby' | 'per_team';
      requiredGroups?: Array<{ anyOf: string[][]; count?: number; max?: number }>;
    };
  }>;
};

async function main() {
  const irc = await createBanchoIrcClient({
    fake: config.fake === true,
    username: config.username,
    password: config.password,
  });

  const invite = config.invite?.trim() || 'lehenna';
  const format = config.format ?? 'qualifier';
  const slots = (config.mappool?.length
    ? config.mappool
    : [
      { slot: 'NM1', beatmapId: '2275555', mods: [] as string[] },
      { slot: 'NM5', beatmapId: '2957016', mods: [] as string[] },
      { slot: 'HD2', beatmapId: '75930', mods: ['HD'] },
    ]
  ).map((row) => ({
    slot: row.slot,
    beatmapId: String(row.beatmapId),
    mods: row.mods ?? [],
    freemod: row.freemod,
    fmRules: row.fmRules,
    unbannable: false,
    unprotectable: false,
    tiebreaker: false,
  }));

  const match = createMatchReferee(irc, {
    lobbyName: config.lobbyName,
    rules: {
      format,
      playersPerSide: config.playersPerSide ?? 1,
      lineupMode: config.lineupMode ?? 'flexible',
      firstTo: 99,
      bestOf: 99,
      protectsPerTeam: 0,
      bansPerTeam: 0,
      maxAbortsPerMap: config.maxAbortsPerMap ?? 2,
      qualPoolRuns: config.qualPoolRuns ?? 1,
      modMultipliers: config.modMultipliers,
      timers: {
        joinSec: 120,
        warmupVoteSec: 15,
        warmupPickSec: 15,
        downloadReadySec: 90,
        downloadGraceSec: 60,
        abortGraceSec: 30,
        abortReadySec: 90,
        qualCloseSec: 60,
        draftActionSec: 30,
        rollChoiceSec: 15,
        ...config.timers,
      },
    },
    invites: [invite],
    teams: {
      red: {
        name: 'Solo',
        players: [{ osuId: '0', username: invite, isCaptain: true }],
      },
    },
    mappool: { slots },
  });

  match.on('lobby_created', (e) => console.log('[lobby_created]', e.url));
  match.on('phase', (e) => console.log('[phase]', e.phase, e.detail ?? ''));
  match.on('announce', (e) => console.log('[announce]', e.message));
  match.on('score', (e) => console.log('[score]', e));
  match.on('finished', (e) => console.log('[finished]', e));
  match.on('forfeit', (e) => console.log('[forfeit]', e));
  match.on('abort', (e) => console.log('[abort]', e));
  match.on('error', (e) => console.error('[error]', e.message));

  const shutdown = async () => {
    console.log('Shutting down…');
    try {
      await match.close();
    } catch {
      // ignore
    }
    try {
      await irc.disconnect();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  match.on('finished', () => {
    console.log('Match finished — press Ctrl+C to disconnect (lobby may already be closed by referee).');
  });

  await match.start();
  console.log('Smoke running — state:', match.getState().phase, match.getState().url ?? '');
  console.log(`Invited: ${invite} | format: ${format} | Ctrl+C to stop (no auto-close).`);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
