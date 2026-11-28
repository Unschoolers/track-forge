# Race diagnostics: reusable AI analysis

Use this whenever a player exports a `.trackforge.json` track or `trackforge-race-*.json` replay. Keep the evidence, branch and test seeds with the issue. No code edits to the user-authored track are needed.

## Inspect the original telemetry

```bash
npm run qa:race -- track path/to/Roundabout.trackforge.json
npm run qa:race -- stats path/to/trackforge-race-Roundabout-Hard.json
npm run qa:race -- stats path/to/race.json --level 2 --json
npm run qa:race -- stats path/to/race.json --level 3 --json
npm run qa:race -- stats path/to/race.json --full
npm run qa:race -- compare path/to/Normal.json path/to/Hard.json
npm run qa:race:test
```

Diagnostic levels apply to `stats` and `simulate` (default `--level 1`):

- **1:** recovery reason, event time and road index; the latest pre-recovery speed, acceleration, heading, steering and surface when recorded; sector durations, same-sector prior-lap deltas, and turn count.
- **2:** level 1 plus detected turn intervals and two seconds of pre-recovery samples. Turns are heuristic intervals of yaw rate ≥ 0.25 radians/second for at least 0.25 seconds, not authored track corners.
- **3:** level 2 plus the full sampled vehicle timeline, for deeper analysis or plotting.

Vehicle heading is in radians, yaw in radians/second, steering is normalized input, and acceleration is a speed difference per second in game units. Acceleration is unavailable across recovery cuts. Recovery events give the engine's reason, not proof of the underlying driving cause. Recorded samples precede the event and may not coincide with its exact tick; simulation recovery snapshots use the preceding simulation tick. Missing fields remain null rather than being invented. Player input samples may be compacted in long captures. Opt-in optimizer `events.jsonl` includes the most recent sampled context for every recovery even when full telemetry is disabled; `telemetry.jsonl` adds heading, yaw, steering and road distance when enabled.

`stats` gives **each car separately** (including player Red and AI Red): mean and peak speed; braking, grass and curb time; surface-specific mean speeds; severe steering reversal counts; recoveries; gates; exact-tick events; and repeated incidents grouped by *generated road sample index*. Recoveries are always individual events with a time and index. For cross-lap comparison, a hotspot groups the same road-index range independently of lap number.

By default, time-weighted stats **stop at the player's recorded finish**. Rivals may not have completed two laps in the exported replay; their `finishTime` is explicitly `null`. Use `--full` to inspect the recording tail, not to invent missing finish times. Braking and surface seconds are estimated from the exported frame cadence; event counts use exact recorded event ticks. An intentional unfinished export (`result: null`) is analyzed through its last recorded frame and labeled `unfinished-race`, including zero-duration countdown captures. No finish times are invented. Damaged telemetry fails with a clear error.

`track` prints a deterministic geometry/terrain fingerprint, road point count, surface/structure breakdown, terrain cell counts, bounds, checkpoints and scenery count. The fingerprint ignores track names, versions, decoration and terrain cell ordering, so it can check whether a replay and an independently uploaded track use the same *road and terrain*. It does **not** assert identical scenery or checkpoints.

`stats` and `compare` accept replay format version 1 without modifying the source files. The summary identifies the recorded ruleset and format version, preserving historical Simulation collision incidents. `compare` matches car color **and player/AI role** (not changing grid slot). It warns about different geometry, difficulty, ruleset, grid, laps, mode and player car. It does not treat a human four-car time as directly equivalent to a seeded AI solo time.

## Simulate a supplied track, with exactly the authored geometry

```bash
npm run qa:race -- simulate path/to/Roundabout.trackforge.json --car all --mode solo --difficulty hard
npm run qa:race -- simulate path/to/Roundabout.trackforge.json --car red --mode traffic --difficulty hard --grid 2,1,0,3 --start 0.7746478873239436
npm run qa:race -- simulate path/to/trackforge-race-Roundabout-Hard.json --level 2
npm run qa:race -- simulate path/to/Roundabout.trackforge.json --car yellow --seed 4331
```

The simulator emits a machine-readable line prefixed `TRACKFORGE_AI_DIAGNOSTIC`. Use this to compare individual AI finish times, recoveries, off-road seconds and failures on identical track/cars/settings. When passed a **race replay**, the command defaults to its player car, difficulty, grid, and start; that slot is AI-controlled for this diagnostic. When passed a **track file**, it defaults to four single-car simulations. Override as needed with `--car`, `--mode`, `--seed`, `--laps`, `--start`, `--grid` and `--seconds`. These are deterministic simulations using the current Arcade engine, **not** exact replays of human input, historical Simulation physics or multiplayer network traffic. A legacy Simulation input produces an explicit ruleset warning.

The authored start ratio is used when available; otherwise the start ratio is inferred from the first recorded player road distance
when a replay does not explicitly save it. The latter reflects the starting grid offset and is approximate. If this cannot be recovered, use
`--start`: the tool fails rather than silently starting at a different point.

For Roundabout v8, the creator's **installed APK build 1288** is an explicit
baseline, not the unmerged #270 branch. The Blue-player Hard export uses grid
`[2,3,1,0]`; the earlier Red-player Hard export uses `[2,1,0,3]`.
Both capture repeated Red/Blue problems around generated road samples
1450–1499. Keep these as **separate traffic fixtures**. A deterministic
run with different grid, seed or physics version does not prove that the
installed APK's behavior has been reproduced.

The simulator uses actual exported road controls and terrain cells, but the lane-check harness currently does **not** recreate authored scenery colliders or live opponent/player inputs; authored timing/recovery checkpoints are preserved. Do not claim a simulated time is directly comparable to a user's race without recording these differences. For production regressions keep a compact, versioned fixture such as `tests/domain/roundaboutDiagnostic.test.ts` and fixed seeds, and verify on other tracks.

## Compare difficulty on the same course

```bash
node qa/race-analysis/cli.mjs difficulty desert-reverse --car red --json
node qa/race-analysis/cli.mjs difficulty desert-reverse --car red --normal-bonus 0.1 --normal-reserve 0.2 --json
```

This runs the existing AI lab for Normal and Hard with the same track, car, start, grid, laps, seed and solo/traffic mode. Experimental Normal overrides are explicit, apply only to the offline trial and are printed in the report. `--mode traffic`, `--seed`, and `--bin-size` are available. Road sample indices are grouped into fixed-width sections (50 by default) across all laps, and intervals are attributed to the section at the beginning of the 10 Hz sample. Positive `secondsDelta` means Hard spent longer there. Sections show sampled mean speed, braking, off-road time, steering saturation, slip and lane offset; absolute values are game units. Equal `entries` helps confirm both runs passed through the section equally often. Sections with missing data or unequal entry counts require review. Recovery and missing-sample intervals are explicitly excluded and counted, so section deltas may not sum to the finish difference. Samples are estimates, not proof of causation. The AI is a rival in this harness and may use different recovery behavior than a human player.

## Investigation loop

1. Check the track fingerprint and setup/version; label live traffic vs AI solo explicitly.
2. Run `stats` on the player and AI replay; examine repeated recoveries, road-index hotspots, braking/grass and sector crossing times.
3. Reproduce with `simulate` on the same track, mode, grid and seed; test other colors using solo mode (or substitute the AI-controlled player car).
4. Tune **driver strategy only**, per car in `src/domain/race/ai/aiCarDrivingProfiles.ts`; never grant AI-only engine, steering friction, or brake power. A fast lap with automatic recovery is a regression.
5. Run `npm run qa:race:test`, the targeted AI tests, lane QA, typecheck and cross-track regression runs before claiming a gain.

Sources: `qa/race-analysis/{summary.mjs,cli.mjs}` and `tests/qa/raceAnalysisSimulation.test.ts`; pure analyzer tests `qa/race-analysis/summary.check.mjs`.
