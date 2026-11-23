# Race analysis toolkit

Use these small, reproducible tools when a creator shares a race replay or a
`.trackforge.json` track. They live under `qa/race-analysis/`; they are
**diagnostics**, not gameplay features. Do not embed creator-specific racing
scripts or bypass car physics.

## One-time commands

```sh
npm ci
npm run qa:race:test
npm run qa:race -- track "Roundabout.trackforge.json"
npm run qa:race -- stats "trackforge-race-Roundabout.json"
npm run qa:race -- stats "trackforge-race-Roundabout.json" --full --json
npm run qa:race -- compare "race-before.json" "race-after.json"
```

`track` reports a stable SHA-256 geometry/terrain fingerprint, road control
point count, surfaces, structures, terrain types, bounds, and checkpoints.
The fingerprint deliberately ignores cosmetic metadata (name, creator,
decoration, version number). Always verify that two files have the **same
fingerprint** before attributing a timing change to AI behavior.

`stats` reports every racer **by ID and color**, time-weighted mean and
maximum speed, brake/grass/curb time, steering saturation, recoveries, gate
events, and incident hotspots grouped by road-sample index. The default
observation ends when the player finishes, preventing AI cars racing longer
from biasing comparisons; `--full` includes the complete recording.
An AI that has not finished is marked **unfinished**, not assigned an
extrapolated time. Finish times in the exported standings are shown as
recorded. Telemetry is sampled every few physics ticks, while event times
are exact; frame-level durations have sampling uncertainty.

`compare` matches like-for-like players and AI by **car color and role**,
not start-grid slot. It explicitly warns when geometry, race mode, difficulty,
handling, lap count, car selection, or physical grid positions differ.
Do not interpret warnings as comparable A/B experiments.

## Deterministic driver simulations

```sh
# The original replay's player car, difficulty, traffic and grid by default
npm run qa:race -- simulate "race.json"

# Test every chassis against the same exported geometry (no replay scripting)
npm run qa:race -- simulate "track.trackforge.json" --car all \
  --difficulty hard --mode solo --seed 1 --laps 2 --seconds 130

# Reproduce an exported race's physical slots explicitly
npm run qa:race -- simulate "race.json" --car red \
  --mode traffic --grid 2,3,1,0 --seed 4331 --start 0.77465
```

Simulation uses `runLaneCheck` with the actual authored track and terrain,
Arcade AI/physics, deterministic random seed, traffic and grid positions.
For race exports, the starting ratio is reconstructed from the first player's
recorded path distance when possible; pass `--start` if unavailable. This
**does not replay the human's controls or reconstruct the original random
state**; it is a deterministic comparison run, not an exact forensic playback.
`TRACKFORGE_AI_DIAGNOSTIC` is emitted as JSON including individual vehicle
finishes, recoveries, off-road seconds, and high-severity issues. Every
run is bounded by `--seconds`. Invalid files, car IDs, or grid slots
must fail visibly.

Advanced multi-seed runs can set `TRACKFORGE_ANALYSIS_OPTIONS` (including
`seeds: [1, 4331, 98765]`) and run
`npx vitest run qa/race-analysis/simulateTrack.test.ts` with
`TRACKFORGE_ANALYSIS_TRACK` set to an absolute filename.

## Repeatable investigation checklist

1. Record **app build**, track geometry fingerprint, game mode, handling,
   difficulty, lap count, physical grid, and seed (where reproducible).
   A user replay from a published APK is a baseline until its changes are
   actually in that APK.
2. Compare each chassis's lap/gate times and speed, braking, grass, curb,
   slip, steering saturation, and recoveries. Use `stats --json` to explore
   exact repeatable road-sample ranges.
3. Identify whether the issue is shared corner planning, traffic interactions,
   individual chassis policy, surface grip, or the lane/recovery system.
   Distinguish causal evidence from correlations in a single race.
4. Test **Hard first**, multiple seeds/slots, plus Kids Room, Pine Hairpins,
   and other official QA. Zero avoidable recoveries and real physics are
   mandatory. Do not hide a failure by slowing other difficulties.
5. Keep diagnostic fixtures in `tests/` and reusable logic in `qa/`.
   Prefer focused unit/component tests. Run `npm run qa:race:test`,
   `npm test`, lane QA and `npm run typecheck` before a PR.
   
## Historical reproducibility

Issue #270's Roundabout v8 examples are in
`tests/domain/roundaboutDiagnostic.test.ts`. The creator's
**build 1288** replay with the Blue player uses physical grid
`[2,3,1,0]`; the earlier Red-player Hard replay used `[2,1,0,3]`.
Red and Blue's repeated problems at road indices ~1450–1499 are from the
published build, **not** a validation of the unmerged tuning branch.
The same track can behave differently with different traffic and grid order;
keep those scenarios separate.
