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


## Kids Room Hard replay-grid investigation (2026-11-23)

The exported live Hard race finished Green human 72.98s, Green AI
74.80s, Blue AI 82.88s and Red AI 95.28s. Red recovered off-road
at 37.27s; Green AI recovered at 58.58s during a prolonged passing
attempt. The human driver manually recovered once as well. These are
observations, **not** equivalent to deterministic AI-only runs.

The optimizer now includes a separate **Kids Room replay grid**
scenario with start pads `[3,1,0,2]`. This reproduces Red's pace
and two recoveries in a four-AI Hard run (Red rival under a Green
driver slot: **96.267s, two recoveries**).

Two surface-braking experiments were evaluated and rejected: the
first removed Red's recoveries but slowed its race to **100.017s**
and broke existing pace gates. Distance-integrated braking still
failed existing race and benchmark gates.

A proposed Hard-only early abandonment of hopeless passes improved
Red's replay-grid time from 96.267s to **95.283s**. However,
cross-track comparisons detected an additional Yellow Hard recovery
on Desert sand (one → two) under both seeds. The fix was
**reverted**, not silently accepted. The patch did not resolve
Green's real-world player-relative passing incident.

**No production AI driving-policy change was accepted in this
investigation.** Only the diagnostic scenario and the difficulty
specific QA acceptance policy are retained. Hard remains a strict
safety gate. Normal/Easy may have deliberate errors; on Easy,
one or two more recoveries versus the *same seeded* baseline
are tolerated if the race still finishes and the route/state
remain valid. Three or more extra recoveries require investigation.
See `qa/optimization/recoveryPolicy.mjs` and its boundary tests.

Revisit Red's ice→street speed prediction and Green's player-relative
passing with bounded **before/after cross-track comparisons**, rather
than accepting a local win that adds Hard-mode recoveries elsewhere.
