# Overview

`@osutourney/autoreferee` is the **match referee engine** for osu! Bancho multiplayer.

- Owns IRC + full match FSM (join, warmups, draft, play, TB, qualifiers).
- Emits domain events for hosts to persist (DB, dashboard).
- Does **not** know Postgres, Nest, or tournament edition tables.

Host apps (e.g. OsuTourney `apps/bancho`) supply rules/roster/mappool and persist `lobby_created.url`. Qualifier FM / multipliers / trimmed IRC: [qual-fm.md](./qual-fm.md). Scores + disconnects: [disconnects-scores.md](./disconnects-scores.md).

**SoT:** `osutourney-api/packages/autoreferee`. Public GitHub mirror is visibility-only.

Version **0.1.0** (0.x). Promote to **1.0.0** after live smoke — [CHANGELOG](../../CHANGELOG.md), [release runbook](../../../../docs/operations/autoreferee-release.md).
