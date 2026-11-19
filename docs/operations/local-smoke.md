# Local smoke

```bash
cd packages/autoreferee/examples/local-smoke
cp config.example.json config.json   # edit creds; never commit config.json
pnpm --filter @osutourney/autoreferee build
pnpm --filter @osutourney/autoreferee-local-smoke start
```

## Modes

| `fake` | Behavior |
| --- | --- |
| `true` | FakeIRC (no Bancho) |
| `false` | Live IRC — set `username` / `password` (IRC server password) |

Default demo is **`format: "qualifier"`**: invites `invite` (default `lehenna`), plays configured `mappool`, **no auto-close** (Ctrl+C).

Engine always sends **`!mp start 5`**.

### Abort

| Setting | Default | Meaning |
| --- | --- | --- |
| `timers.abortGraceSec` | 30 | After map start, leave in this window → bot `!mp abort` |
| `timers.abortReadySec` | 90 | Ready window after abort |
| `maxAbortsPerMap` | 2 | Cap (bot + referee); then leaves no longer auto-abort |

Abort ≠ finish: no score, same map, ready again.

## Live Bancho checklist (`fake: false`)

**1.0 release gate** — do not bump package until this is green. See monorepo `docs/operations/autoreferee-release.md`.

Env / config:

1. `BANCHO_FAKE=0` (host) or `fake: false` in smoke `config.json`
2. IRC `username` / `password` (Bancho IRC server password)
3. For host score path: `OSU_CLIENT_ID` / `OSU_CLIENT_SECRET` so `score.apply` can fetch the MP
4. Swarm/prod: IRC + osu secrets on **both** gateway and worker; worker id via hostname

### Layers

| Layer | Command | Pass criteria |
| --- | --- | --- |
| IRC only | `pnpm bancho:smoke` | exit 0 (connect/make/invite/close) |
| Lib Qual/FM | `example:smoke` + `fake: false` | maps play; FM gate; Ctrl+C clean |
| Host scores | `apps/bancho` with `OSU_CLIENT_*` | logs `score.apply.applied` after each map |

### Qualifier

1. Enter the MP before `joinSec` ends
2. Warmups: vote → **one host at a time** (red then blue) → rolls (`!roll`; ties re-roll silently)
3. Play pool (incl. FM slot if configured) — FM gate must pass before start
4. Optional DC after grace → replay queue (`!yes` / `!no`)
5. After pool runs + close timer, standings persist on host (not in lib-only smoke)

### Team match / FM

1. Set `format: "team_match"` + two teams in config (or use host `start_auto_ref`)
2. Confirm freemod slot rejects invalid mod combos before `!mp start`

### Expected failures (document, do not panic)

| Symptom | Likely cause | Exit / signal |
| --- | --- | --- |
| Empty / zero scores after map | osu API fetch empty; host timeout → zeros | `score.apply.fetch_failed` then apply |
| IRC drop mid-match | reconnect + re-JOIN; `failover_resume` reattach | no `!mp make` |
| FM never starts | `fmRules` not satisfied | stay on ready |
| `bancho:smoke` exit 2 | timeout / rate limit | retry |

If creds are absent in this environment, leave the 1.0 gate open and run smoke on an ops machine.
