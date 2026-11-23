# Issue #270 — consolidated performance and safety

**Decision: Roundabout recovery blocker FIXED in deterministic QA.** Red and Blue now complete the original Roundabout replay grids and two additional traffic configurations without forced recovery. The fix changes the AI's planned corner pace, **not** car physics. **Merge is still conditional on all four workflows passing on the final PR head.**

## Provenance and apples-to-apples conditions

- **Before:** [frozen original matrix](../qa/benchmarks/kidsRoomAiBaseline.json) from commit [`fea2b737`](https://github.com/Unschoolers/track-forge/commit/fea2b737484528192b8b0eadf1b516929ee61735). This precedes the Red improvement already merged in PR #269. Therefore the gains below are **total progress since frozen baseline**, not solely PR #272 changes.
- **Original fast-but-unsafe PR:** PR performance code commit [`c2883ae2`](https://github.com/Unschoolers/track-forge/commit/c2883ae26c384bd22c74f6f3f28f99e71a1089a0), [CI run 45121339543](https://github.com/Unschoolers/track-forge/actions/runs/45121339543) / [benchmark job 137515576429](https://github.com/Unschoolers/track-forge/actions/runs/45121339543/job/137515576429). All steps passed, including strict replay validation, TypeScript, performance sweeps, full domain suite and lane QA.
- **Kids Room:** exact fixture `tests/fixtures/kidsRoomAi.trackforge.json`, Arcade, 2 laps, solo AI without traffic, start ratio `0.21932299012693934`, deterministic seeds **1** and **4331**. Identical course, physics and start for before/after.
- **Your best:** four-car live races, **not controlled equivalents** of solo AI; gap is contextual only. All times in seconds, smaller is better. "Recovery" means forced recovery, not momentarily leaving the road.

## Kids Room — frozen before versus current Hard

| Car | Frozen Hard (s) | PR Hard (s) | Time saved (s) | Your best (s) | AI behind best* | Hard recoveries (seed 1, 4331) |
|---|---:|---:|---:|---:|---:|---|
| Red | 101.533 | 96.833 | **4.700** | 82.100 | +14.733 | 0, 0 |
| Green | 81.783 | 76.483 | **5.300** | 71.383 | +5.100 | 0, 0 |
| Blue | 86.150 | 81.950 | **4.200** | 79.967 | +1.983 | 0, 0 |
| Yellow | 90.450 | 80.850 | **9.600** | 72.117 | +8.733 | 0, 0 |

*Your time includes real traffic; AI run is solo.*

Immediately before the new issue-#270 Hard tuning, the already-merged Red improvement in PR #269 put Red at **101.050 s**. The new PR therefore saves another **4.217 s** for Red relative to that intermediate benchmark.

## Difficulty ordering — identical solo conditions

| Car | Easy (s) | Normal (s) | Hard (s) | Hard < Normal < Easy, both seeds |
|---|---:|---:|---:|---|
| Red | 107.733 | 102.167 | 96.833 | PASS |
| Green | 85.133 | 80.867 | 76.483 | PASS |
| Blue | 89.033 | 83.333 | 81.950 | PASS |
| Yellow | 96.400 | 92.033 | 80.850 | PASS |

## Kids Room — Hard off-road exposure

| Car | Frozen off-road (s) | Current off-road (s) |
|---|---:|---:|
| Red | 4.483 | 3.883 |
| Green | 3.000 | 2.167 |
| Blue | 2.517 | 2.117 |
| Yellow | 3.100 | 1.650 |

Short off-road excursions are recorded separately from forced recoveries.

## Safety across other circuits

### Pine Hairpins — Hard solo, one lap, seed 11

| Car | Current finish (s) | Forced recoveries |
|---|---:|---:|
| Red | 28.883 | 0 |
| Green | 25.067 | 0 |
| Blue | 25.933 | 0 |
| Yellow | 26.817 | 0 |

**Limit:** no frozen, matched Pine timing is included here. This table verifies present clean finishes, **not** a proven Pine improvement.

### Roundabout v8 — Hard, 2 laps, four AI-driven vehicles

**Root cause.** On a long smooth all-pavement circuit, `racingPavementAllowance` treated a six-sample curvature of approximately **0.41 radians** as a safe sweeping corner. It granted the full **2.15×** corner-speed pace multiplier instead of using the physically achievable braking target. Red entered the western hairpin at over 300 speed units, saturated steering, and recovered off the road. The focused fix [`88a9d9d7`](https://github.com/Unschoolers/track-forge/commit/88a9d9d79b0289dc10fa84c1b58cf5e9b4993dd4) tapers that allowance between **0.20 and 0.34 radians**. No physics, grip, checkpoint, or recovery code changed.

**Matched before/after:** identical real Roundabout v8 geometry and terrain, Arcade, start ratio `0.7746478873239436`, 2 laps, all four vehicles AI-driven, fixed physical grids and seeds. Compare the original [fast PR baseline, run 45121339543](https://github.com/Unschoolers/track-forge/actions/runs/45121339543) to the [corrected controller, run 45122947131](https://github.com/Unschoolers/track-forge/actions/runs/45122947131). The latter ran at `fce22116` (the subsequent `49a2046f` commit **only expands test grid coverage**).

| Replay physical grid / AI player | Before Red recoveries | Before Blue recoveries | After Red recoveries | After Blue recoveries |
|---|---:|---:|---:|---:|
| `[2,1,0,3]`, Red | 3 | 0 | **0** | **0** |
| `[2,3,1,0]`, Red | 2 | 1 | **0** | **0** |
| `[2,3,1,0]`, Yellow | 1 | 0 | **0** | **0** |
| **Total per seed** | **6** | **1** | **0** | **0** |

For these three directly matched conditions, **all 12 vehicles have zero off-road time after the fix**. The revised Red times include **65.500 → 64.767 s**, **70.150 → 63.767 s**, **66.217 → 64.550 s** and **66.167 → 63.783 s**. Blue finished between **0.033 s faster and 0.600 s slower**, depending on grid. The largest slowdown for any car across the three full traffic grids is **0.867 s** (Yellow); there is **no material cross-track pace regression**. Recovered laps are not fair clean-driving lap comparisons, so the time figures are supporting context, not the sole success metric.

**Expanded traffic gate:** `tests/domain/roundaboutDiagnostic.test.ts` now enforces no Red/Blue forced recoveries on **five** physical grid/player-slot combinations, including Blue in the AI player position and two independently rearranged grids, across seeds `1`, `4331`, and `98765` (**15 deterministic two-lap traffic runs**). The [expanded test's Roundabout step passed](https://github.com/Unschoolers/track-forge/actions/runs/45123274448). Different physical grids, not merely different random seeds, provide the meaningful traffic variation; Hard can behave identically across seeds.

Kids Room remains **96.833 / 76.483 / 81.950 / 80.850 s** (Red/Green/Blue/Yellow), each with zero forced recovery in both seeds. Pine Hairpins safety and pace checks also pass; the narrow racing-pavement rule does not alter its low-speed profile. The full official lane suite must remain green before merge.

### Rejected experiments: important counterexamples

| Candidate | What initially improved | Why it is not accepted |
|---|---|---|
| Red global corner reserve `0.22` | Eliminated Red recoveries in sampled Roundabout grids | Kids Room slowed **96.833 → 107.300 s**; Pine 29.983 s with **1 recovery** |
| Red sharp-pavement hairpin reserve `0.16` | Eliminated Red Roundabout recoveries | Kids Room slowed to **100.117 s**; Pine 29.433 s with **1 recovery**; Blue still recovered |
| Blue reduced edge avoidance and increased corner speed | Kids Room improved to **80.917 s** from 81.950 s | Roundabout Blue recoveries across the three displayed grids increased from **1 to 3** per seed |

No candidate is approved on a single quick lap or a race that requires recovery.

## Review hardening in this PR

- Candidate sweeps no longer mutate `CAR_DRIVING_PROFILES`. Every `runLaneCheck` receives optional **race-local immutable AI profile overrides**; shared production defaults remain untouched. `tests/domain/aiProfileIsolation.test.ts` asserts an overridden run changes behavior while the next default run remains identical.
- `summarizeRace` validates the complete stable set of vehicle IDs, car/role identity, timestamps, finite speed and finish timestamps **for every frame**, including frames beyond the default observation cutoff. Missing/corrupt telemetry throws an actionable error instead of silently undercounting. `qa/race-analysis/summary.check.mjs` tests missing, duplicated, replaced, and invalid later-frame records.

## Reproduction

```sh
npm run qa:race:test
npx vitest run tests/domain/aiProfileIsolation.test.ts tests/domain/kidsRoomAiBenchmark.test.ts --reporter=verbose
AI_PROFILE_SWEEP=1 npx vitest run tests/domain/aiHardProfileSweep.test.ts --reporter=verbose
AI_ROUNDABOUT_SWEEP=1 npx vitest run tests/domain/roundaboutDiagnostic.test.ts --reporter=verbose
npm run qa:lanes -- --scenario all --mode both --seeds 1 --fail-on-regressions
```

Look for `AI_PACE_MATRIX`, `AI_PROFILE_SWEEP`, `AI_HARD_CROSS_TRACK_CANDIDATES` in the output. Tests are deterministic but two seeds with identical outcomes are **not independent evidence** of broad traffic robustness.

## Acceptance gate

- [x] Better Hard Kids Room time for every car against frozen benchmark (zero forced recoveries on both seeds).
- [x] Controlled ordering: Hard faster than Normal faster than Easy for each car.
- [x] Present Pine Hairpins solo completions without recovery.
- [x] No global profile mutation; complete race export validation with regression tests.
- [x] **Zero Red and Blue recoveries** on all original Roundabout traffic replay grids.
- [x] **Five** distinct traffic grid/player combinations, with three deterministic seeds each, assert the safety requirement.
- [x] Matched before/after Roundabout pace, plus unchanged Kids Room performance and clean Pine safety; no significant regression.
- [x] Race analysis, typecheck, domain and targeted Roundabout tests at `fce22116` in [run 45122947131](https://github.com/Unschoolers/track-forge/actions/runs/45122947131).
- [ ] **Before merge:** four GitHub workflows must pass on the *final PR commit*: Issue 270 Hard AI branch QA, AI lane QA, Mobile gameplay QA, Verify and build Android. Check live statuses in the PR.

**Post-merge validation:** compare a new human four-car live replay against the original user bests. Deterministic AI-only traffic tests do not prove human-versus-AI competitiveness; this is follow-up telemetry, not an excuse to bypass the four-workflow merge gate.

**Merge only after all final-head checks are green.**
