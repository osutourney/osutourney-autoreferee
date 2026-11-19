# Failover reattach

Worker affinity sweep / manual `bancho-failover` enqueues `failover_resume`.

Host behavior (`apps/bancho` `autoreferee-host`):

1. If lobby already live → no-op.
2. If `mode=auto` and not closed/forfeit:
   - Read `externalId` / `settings.osuLobbyId`.
   - If MP id present → `createMatchReferee({ resume: { mpId, channel, snapshot } })` → **JOIN** existing channel (no `!mp make`).
   - Snapshot from `settings.autoref_snapshot` or `matches.result.autoref`.
3. Without MP id → start creates a new lobby (cold start only).

Live IRC client reconnects independently and re-JOINs tracked `#mp_*` channels.
