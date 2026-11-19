# Qualifier, freemod, scores

## Boundary

| Library (`@osutourney/autoreferee`) | Host (`apps/bancho` / competition) |
| --- | --- |
| Lobby IRC FSM, draft, timers, abort | Config / rules / mappool into `createMatchReferee` |
| FM gate via `!mp settings` + `fmRules` | Persist `score` / `finished` events |
| Live `applyModMultipliers` on map scores | Rank by seed, `advancement.top_n` |
| No standings / Postgres | Manual import uses the **same** multiplier helpers |

## Qualifier

- `rules.format`: `qualifier` \| `play_all`
- `rules.qualPoolRuns` (default 1): full non-TB pool passes
- Map index: `mapsPlayed % playable.length`; run label only when `qualPoolRuns > 1`
- End IRC: `Qualifiers complete. Closing in Ns.` then `timers.qualCloseSec` (default 60)
- No IRC “Winner” / map ranking — host ranks

## Freemod slots

```ts
{ slot: 'FM1', beatmapId: '…', freemod: true, fmRules: {
  scope: 'lobby' | 'per_team',
  requiredGroups: [
    { anyOf: [['HD'], ['EZ', 'HD']], count: 1 },
    { anyOf: [['HR'], ['HR', 'HD']], count: 1 },
  ],
}}
```

- Set map → `!mp mods Freemod`
- Pre-start: parse slot mods from settings; validate `fmRules`; announce short fail; no start

## Multipliers

Defaults: HD 1.06, HR 1.12, FL 1.12, … (product). Override with `rules.modMultipliers`.
Emitted `score.mapScores[].score` is already adjusted (`rawScore` + `mods` included).
