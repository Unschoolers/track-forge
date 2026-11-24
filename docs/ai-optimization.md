# Offline AI Optimization Lab — implementation plan

Status: all five phases implemented; one measured Green Hard improvement
promoted after multi-track/multi-seed offline study. All final CI gates must pass
before merge. No unattended production changes.

## Problem and constraints

The creator's reverse Desert sand replay exposed inefficient AI lap times.
A Green-only experiment briefly improved solo times but **failed** the existing
Kids Room full-field recovery test; it was closed unmerged in PR #275.
Do not optimize only one track, accept a recovery regression, weaken a test,
or imitate the player's exact inputs.

Physics remains 60 Hz and identical across players and AI. No course-name/id
branches in production AI. Driver profiles change *decisions*, never tire forces.

## Architecture and phases

1. **Diagnostic contract**: versioned tabular `runs`, `events`, `telemetry`.
   `qa/optimization/records.mjs` projects actual `runLaneCheck` results.
   JSONL is the durable interchange; optional Python DuckDB converter writes
   columnar Parquet after an experiment batch. Detailed telemetry is opt-in.
2. **Headless execution**: reuse the existing deterministic `runLaneCheck`
   through a small Node worker-thread pool; reuse road geometry per worker.
   Tasks identified by car, profile, scenario, seed, mode and difficulty.
   Worker exceptions must reject the study, not be counted as slow laps.
3. **Bounded search**: generate plausible, car-specific *driving-policy* variants,
   first cheap solo screening, then real traffic / multiple seeds / held-out
   tracks. Never optimize physical car parameters. Rank matched relative lap
   improvements with explicit maximum per-track regressions; safety is a gate,
   not a weighted preference.
4. **CI + regressions**: existing Kids Room Hard race, Pine Hairpins,
   official routes, all four cars and lane checks; record before/after
   matrices with distinct solo and traffic columns. No automated production
   writes, and no automatic merge.
5. **One improvement**: promote only a measured, cross-track-safe candidate
   into `aiCarDrivingProfiles.ts`; run the final CI head and merge only when
   all required checks pass. If none qualify, report that honestly.

## Analyzer data model

- `runs.jsonl`: **one vehicle per trial** with trial ID, policy ID, geometry
  fingerprint, scenario, physical car, AI driver slot, difficulty, seed, grid,
  reversed direction, start ratio, finish, recoveries and off-road duration.
- `events.jsonl`: exact-time recovery / path-jump / collision / other issues,
  with the same join keys.
- `telemetry.jsonl`: optional 10 Hz recorded pose/line samples from simulations.
  Detailed braking/slip data requires **new instrumentation**; do not infer it.
- `summary.json`: ranked policies, rejected candidates and comparison matrix.

Parquet is for *offline analysis*, not gameplay. Convert batch results with
`python3 qa/optimization/to_parquet.py <results-folder>` after installing the
DuckDB Python package. Parquet files can be queried using
`SELECT ... FROM 'qa/results/optimization/runs.parquet'`.

## Reproducibility and validation

Tie comparisons to physics revision, exact track geometry + terrain fingerprint,
car, start ratio, direction, handling, grid, seed, and laps. Do not compare the
creator's live four-car record as if it were a matched AI-only baseline.
Never include training scenarios alone as proof of generalization.
No background process or runtime game dependency is introduced.

## First executed study (2026-11-23)

Command: `npm run qa:optimize -- --workers 2 --trials 14 --seeds 1,4331`.

- **298 fixed-step race trials / 19.749 s wall time**, two worker threads;
  JSONL output plus three ZSTD-compressed Parquet files.
- For every car, evaluate candidate driving profiles on reverse Desert sand
  and Pine Hairpins. Screen only valid finishes without forced recoveries.
- Validate survivors on Desert sand, Pine Hairpins, Kids Room and Meadow Loop,
  both seeds, solo and full traffic. Validate the tuned car as both player and
  AI rival in a hard-mode opponent grid. This last requirement caught a real
  roster issue: Hard deliberately mirrors the player's car, so Yellow only
  appears as a rival if Yellow occupies the player slot.
- One selected policy, **Green `hardEdgeAvoidanceScale: 0.4 → 0.25`**,
  improves the mean matched lap time **2.54%** across 24 same-scenario
  comparisons. No newly introduced recoveries in those matched runs.
- Desert sand Green Hard solo: **31.867 s / one recovery → 29.650 s / zero**.
  Hard Green as Red's rival: **33.750 → 30.650 s**, zero recoveries.
- Kids Room Hard solo: **71.767 → 71.150 s**. Kids Room Hard as Red rival:
  **73.333 → 73.833 s** (0.5 s slower, still zero recoveries). The optimizer
  does not conceal this traffic tradeoff. Pine Hairpins and Meadow Loop solo
  times also improve by 0.183 s and 0.583 s, respectively.
- The Yellow and Red candidates did not pass the calibration screen, and
  faster Blue candidates were rejected by traffic/safety validation. No
  unsafe "improvement" was promoted for those cars.

The proposed policy is a global Green driving profile decision, **not** a
Desert-specific lookup. `tests/domain/desertSandAiPace.test.ts` guards
the new race behavior, alongside the existing Kids Room and lane checks.

## Re-run and inspect

```sh
npm run qa:optimize:test
npm run qa:optimize -- --workers 2 --trials 14 --seeds 1,4331
# Optional offline columnar export: pip install duckdb
python3 qa/optimization/to_parquet.py qa/results/optimization
```

Inspect `qa/results/optimization/summary.json` for the complete before/after
matrix, candidate rejections and per-track details. The CI workflow uploads
summary/JSONL/Parquet files together as a downloadable artifact.
If the physics, road compilation or AI profiles change, **run new experiments**;
do not compare different physics revisions as if equivalent.

## Independent driving line and overtaking experiments

Track Forge deliberately tests two different capabilities rather than
optimizing them with the same metric:

- **Driving** (`--focus driving`, default): each car runs alone in the real
  60 Hz simulator to tune steering, braking, corner anticipation and pace,
  then validates the candidates with rivals.
- **Passing** (`--focus passing`): a named car chases one independently
  AI-driven opponent. The deterministic two-car grid is
  `[3,0,1,2]` (car behind, rival ahead). The simulator uses real vehicle
  movement and the same engine/collisions, never a stationary test obstacle.
  Screen pass decisions and lane rejoining in duels, then validate the
  survivor in solo races and full-field traffic on held-out tracks/seeds.
- **Isolation**: passing decisions are in
  `src/domain/race/ai/aiCarPassingPolicies.ts`, independent from
  `aiCarDrivingProfiles.ts`. Overrides are race-local, keyed by car ID:
  changing Red's passing settings does **not** affect Yellow's solo run.
  A full-field Yellow result may still change indirectly because opponents
  physically interact; those changes belong to traffic regression checks.
- **Measurements**: `runs.jsonl` / Parquet includes
  `policy_kind`, `duel_opponent_car`, `pass_attempts` and
  `passing_seconds`. These prevent confusing a fast solo line with a
  good pass. Per-trial IDs distinguish duel, solo and full-race configurations.

Try both independent searches (each is bounded and parallel):
```sh
npm run qa:optimize -- --focus driving --workers 2 --trials 14 --seeds 1,4331
npm run qa:optimize -- --focus passing --workers 2 --trials 8 --seeds 1,4331 \
  --out qa/results/passing
python3 qa/optimization/to_parquet.py qa/results/passing
```
The passing profile defaults retain the previous live behavior across all
four cars until a measured, safe, cross-track candidate is accepted. A
candidate recommendation is **not** automatically written to production.

## Figure-eight four-colour benchmark (2026-11-23)

The actual live replay is `trackforge-race-Figure-eight-2026-11-23T19-52-49-541Z.json`.
The benchmark fixture `figureEightRaceAi.trackforge.json` preserves its 19 control
points, full water terrain, overpass structures, starting ratio and direction.
The older `figureEight.trackforge.json` has different geometry at points
11–16 and **cannot** be used for like-for-like race analysis. Cosmetic trees
and scenery are excluded from the headless lane-geometry fixture.

Hard / Arcade / forward / 2 laps / grid `[0,2,3,1]`.
Human Green 40.367 s; AI Green 41.083 s, Blue 41.917 s, Red 44.117 s.
Live AI passing durations: Green 5.35s, Blue 16.55s (2 attempts),
Red 8.30s. No automatic recoveries; Red went off pavement onto grass
briefly without resetting. The Hard player-selected Green mirror means
Yellow is absent from the exported race, not skipped from simulations.

The parallel 4-colour driving and passing studies now include
`figure-eight-replay` as a calibration scenario while keeping Kids
Room and Meadow Loop as holdout tracks. The initial study completed
396 driving and 330 passing trials, and **no candidate met the
full-field Hard safety/performance gate**. Some Blue/Green candidate
lap-time gains caused recoveries or excessive slowdowns elsewhere.

### Calibrated passing opportunities

A Yellow-versus-Green duel at equal AI pace contained zero attempts
because Green is inherently quicker. It is invalid to conclude from
such a duel that Yellow has no passing problem: in the actual Figure-eight
full-field simulation Yellow tried to pass six times, spending 24.8s
in the passing state. Passing calibration now uses a **real independently
AI-driven moving opponent** with `duelOpponentSpeedLimit = 220`, rather
than a stationary obstacle or a rival which the car cannot catch.
The speed-limit override is legal only for a duel, is race-local, and is
recorded in comparison metadata and Parquet. Full-field traffic
validation always uses real unmodified opponents.

For local replication:
```sh
npm run qa:optimize -- --focus driving --workers 2 --trials 14 --seeds 1,4331 --out qa/results/optimization
npm run qa:optimize -- --focus passing --workers 2 --trials 8 --seeds 1,4331 --out qa/results/passing
```

Note: the current Hard AI baseline produces identical outcomes for seeds
1 and 4331 on all scenario/vehicle configurations. They still independently
exercise the test harness; do not claim increased stochastic coverage
until a Hard policy actually consumes random decisions.

### Red terrain and steering physics validation

A player-facing handling adjustment increases Red's steering range and ice grip,
retains its existing ice stopping-distance target, and improves grass recovery
acceleration without raising the grass speed target. Run the existing driving
and passing optimization studies on this physics revision before promoting any
new AI policy. Compare solo and traffic baseline matrices with the previous
physics revision, including recovery counts; policy optimization itself must
not alter physical vehicle parameters. The creator Turn fixture's component
regressions also measure actual velocity direction on ice under braking.
