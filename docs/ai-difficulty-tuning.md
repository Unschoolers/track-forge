# AI difficulty tuning: Hard first

**Rule for all cars, including Green and Red:** calibrate the fastest reliable and
physically legal **Hard** AI first. Treat that as the reference driving policy;
Normal and Easy are deliberately slower, more forgiving variants, **not**
separately optimized racing controllers. A good Normal lap never compensates
for a broken or uncompetitive Hard lap.

## Calibration sequence

1. Replay the actual human race and inspect corner entry, exit speed, brake
   pressure/frames, lateral slip, off-road time, gate events and finish time.
   Compare like-for-like **car, track revision, handling, laps and starting
   conditions**. Keep the replay as evidence, not as an AI steering script.
2. Simulate **Hard first**, multiple deterministic seeds, on the same full
   track and several regression courses. Correct excessive braking or poor
   driving lines without bypassing real tire friction, vehicle limits, curbs,
   water, collisions, checkpoints or recovery rules. Require valid finishes
   with no avoidable automatic recoveries.
3. Only after Hard is stable, derive **Normal** and **Easy** from the same
   driving/controller foundation, using the existing difficulty policy's
   speed/corner safety margins, mistake rate and overtaking caution.
   Lower difficulty must not have superior driving or hidden grip/engine
   advantages; any minor steering-safety differences must preserve
   **Hard faster than Normal faster than Easy** in comparable races.
4. Re-run the full deterministic race tests with identical seeds, grid
   composition and physics for each difficulty. Inspect individual-car
   finish times, not just field averages, and make sure a tuned Normal
   cannot mask Hard regressions. Preserve other cars' handling identities.

## Green on Kids room: explicit regression contract

- **Source:** `tests/fixtures/kidsRoomAi.trackforge.json` captures the
  mixed street/dirt/ice circuit from the creator's race. The reference human
  Green Arcade lap total is **1:12.900** for two laps.
- Green is a **cornering/grip specialist**. Its quick yaw response can justify
  a higher *planned* apex speed on sufficiently grippy street and dirt; ice
  remains low-grip. Actual tire friction and car specifications never change
  by difficulty or because an AI is driving.
- Test Green as an AI rival with Red occupying the player slot on **Hard,
  Normal and Easy**. For each fixed seed, require clean full-race finishes and
  strictly increasing times `Hard < Normal < Easy`.
- The existing Normal competitiveness check remains independently enforced:
  Green Normal must finish within ten seconds of the 1:12.900 personal best
  on the two seeded Kids room runs. Hard's correctness is **also** mandatory.
- Run `tests/domain/kidsRoomAiPace.test.ts`,
  `tests/domain/aiDifficultyPolicy.test.ts`,
  `tests/domain/emileHardRace.test.ts`, and lane/official-course QA.
  A win on this one circuit is not proof that every course improved.

## Implementation landmarks

- `src/domain/race/ai/cornerSpeed.ts`: speed prediction based on actual
  chassis response, grip, surface and braking distances; **do not** add
  track-specific, AI-only speed/physics boosts.
- `src/domain/race/ai/difficultyPolicy.ts`: difficulty-specific corner
  reserves and authored-line pace, with **Hard as the pace reference**.
- `src/domain/race/ai/aiDriver.ts`: shared corner tactics; difficulty still
  affects safety, traffic and mistakes.
- `tests/domain/kidsRoomAiPace.test.ts`: source-replay-based pace and
  all-three-difficulty Green ordering.

When an AI change is proposed, the PR must report **Hard first**: finish
times, recoveries, performance and difficulty ordering, followed by Normal
and Easy. If Hard regresses, fix it before declaring the change complete.
