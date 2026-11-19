# Changelog

All notable changes to `@osutourney/autoreferee` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — 1.0.0 candidate

Gate: **live Bancho smoke green** (`fake: false` + `OSU_CLIENT_*` score path). See [autoreferee-release.md](../../docs/operations/autoreferee-release.md).

### Added

- MatchReferee FSM: qual / play_all / team_match, FM gate, DC grace → match zero / qual replay
- Warmups one host at a time; roll ties re-roll internally (no announce until unequal)
- IRC live client reconnect + tracked `#mp_*` re-JOIN; resume reattach (no `!mp make`)
- FSM snapshot fields: `awaitingScoreApply`, `awaitingScoreSince`
- Mod multipliers / FM / ranking helpers synced from `@osutourney/contracts` (`from-contracts.ts`)
- FakeIRC integration tests + host bridge E2E (FakeIRC + mock osu API) in monorepo CI

### Changed

- Scores SoT: host `map_finished` → osu API → `score.apply` (IRC empty finish waits up to 20s)

## [0.1.0] — 2026-11

Initial publicable package layout (unstable 0.x): IRC client, MatchReferee, draft presets, FakeIRC smoke.
