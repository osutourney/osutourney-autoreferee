# Disconnects + scores (host API)

## Scores

Bancho IRC finish often has **no** per-player scores. Flow:

1. Lib emits `map_finished` `{ mpId, beatmapId, disconnectedOsuIds, ircScores }`
2. Host fetches osu! API (`fetchLatestMapScores`) and dispatches `score.apply`
3. Lib applies multipliers, DC zeros, advances FSM
4. FakeIRC may pass scores inline (auto-`score.apply`)

Requires `OSU_CLIENT_ID` / `OSU_CLIENT_SECRET` on `apps/bancho`.

Win condition metric (Score / Accuracy / Combo / ScoreV2): that field is the ranking value. **Missing field or DC → 0** (same rule for every WC).

## Disconnect grace

- Within `abortGraceSec` after `!mp start` → `!mp abort` (same as before)
- After grace → map continues
  - **team_match:** that player scores **0** for the map
  - **qualifier / play_all:** player is queued for **replay after all pool runs**

## Qual replay

After `qualPoolRuns` complete:

1. Ask player (or teammate / sub): `!yes` to replay / `!no` → 0
2. Multiple DCs on the same map → can re-queue and retry
3. Sub: another roster player who answers `!yes` may play the slot

## Related

- [qual-fm.md](./qual-fm.md)
- Host: `apps/bancho` `map_finished` → `score.apply`
