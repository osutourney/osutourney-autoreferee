# `@osutourney/autoreferee`

osu! Bancho multiplayer auto-referee engine (custom IRC, no BanchoJS).

**Version:** `0.1.0` (0.x). **1.0.0** ships after live Bancho smoke is green — see [`CHANGELOG.md`](./CHANGELOG.md) and [autoreferee-release.md](../../docs/operations/autoreferee-release.md).

Copyright © Lehenna S.A.S. de C.V. — MIT License. **Attribution required** (see `NOTICE`).

> **Source of truth:** this package lives in the **osutourney-api** monorepo (`packages/autoreferee`).  
> PRs and development happen there. The public `osutourney-autoreferee` GitHub repo is a **visibility mirror** only (synced on release / explicit push).

## In this monorepo

```bash
pnpm --filter @osutourney/autoreferee build
pnpm --filter @osutourney/autoreferee test
pnpm --filter @osutourney/autoreferee example:smoke
```

Consumers use `workspace:*` (e.g. `apps/bancho`).

## Install (npm, when published)

```bash
pnpm add @osutourney/autoreferee
```

## Quick API

```ts
import { createBanchoIrcClient, createMatchReferee, classicDraftPreset } from '@osutourney/autoreferee';

const irc = await createBanchoIrcClient({ fake: true });
const match = createMatchReferee(irc, {
  lobbyName: 'DEMO: (A) vs (B)',
  rules: { ...classicDraftPreset(), format: 'team_match', playersPerSide: 2 },
  teams: {
    red: { name: 'A', players: [{ osuId: '1', username: 'p1' }] },
    blue: { name: 'B', players: [{ osuId: '2', username: 'p2' }] },
  },
});
match.on('lobby_created', (e) => console.log(e.url));
await match.start();
```

## Standalone smoke

```bash
cd packages/autoreferee/examples/local-smoke
cp config.example.json config.json
pnpm start
```

## Docs

- Package: `packages/autoreferee/docs/`
- Host: `docs/operations/bancho.md`
- Mirror sync: `docs/operations/autoreferee-mirror.md`
