# Contributing

- **Develop in the monorepo** (`osutourney-api/packages/autoreferee`). Open PRs there only.
- The public `osutourney-autoreferee` repo is a visibility mirror — see `docs/operations/autoreferee-mirror.md` in the monorepo.
- CLA: see `CLA.md` (Lehenna S.A.S. de C.V.)
- MIT + attribution (`NOTICE`)
- Tests: `pnpm --filter @osutourney/autoreferee test` (FakeIRC only — no live Bancho/secrets in CI)
- Host bridge E2E: `apps/bancho` vitest with FakeIRC + mock `OsuMatchFetcher` (map_finished → score.apply); also runs via `turbo test`
- Live smoke (`example:smoke` / `bancho:smoke`) is **manual**, never in GitHub Actions
- Cursor conventions: monorepo `.cursor/rules` (`bancho-autoref.mdc`, coding-style, etc.) — do not add package-local `.cursor/`
- Keep monorepo `docs/operations/bancho.md` + package `docs/` in sync with behavior changes
