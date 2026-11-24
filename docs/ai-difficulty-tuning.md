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
  mixed street/dirt/ice circuit from the creator's race. The latest human
  Green Arcade best is **1:08.883** for two laps (2026-11-23), improved from
  **1:11.383**. Other Kids Room human records include Blue **1:19.967**,
  Red **1:22.100**, and Yellow **1:12.117**. These are live four-car races,
  not directly identical to solo AI benchmarks.
- Green is a **cornering/grip specialist**. Its quick yaw response can justify
  a higher *planned* apex speed on sufficiently grippy street and dirt; ice
  remains low-grip. Actual tire friction and car specifications never change
  by difficulty or because an AI is driving.
- Test Green as an AI rival with Red occupying the player slot on **Hard,
  Normal and Easy**. For each fixed seed, require clean full-race finishes.
  Enforce `Hard < Normal < Easy` on the separate matched solo benchmarks;
  the full-field grids can differ across difficulties.
- The existing Normal competitiveness check remains independently enforced:
  Green Normal must finish within ten seconds of the 1:12.900 personal best
  on the two seeded Kids room runs. Hard's correctness is **also** mandatory.
- Run `tests/domain/kidsRoomAiPace.test.ts`,
  `tests/domain/aiDifficultyPolicy.test.ts`,
  `tests/domain/emileHardRace.test.ts`, and lane/official-course QA.
  A win on this one circuit is not proof that every course improved.

## Individual car driving profiles

The common physics engine, collision safety, gates, recovery, traffic rules and
corner geometry remain shared. Arcade Hard **steering and planning policy**
lives in `src/domain/race/ai/aiCarDrivingProfiles.ts` and is independently
adjustable per car (steering reaction, gain, preview, safe corner-speed reserve).
Do not put AI-only handling, grip, engine, or brake multipliers in these
profiles. Treat these as driver decisions, not a second vehicle physics model.

- **Red — pavement racer:** preserve clean straight-line pace and exploit
  genuine high service-brake capacity, but avoid aggressive low-grip
  corner entry; verify dirt and ice separately.
- **Green — corner specialist:** exploit actual yaw response and mixed-surface
  grip with a longer preview and controlled pursuit shortening near road edges.
  An unguarded edge pursuit was fast in solo runs but caused two off-road
  recoveries in traffic; keep real-traffic safety and tire-force validation.
- **Blue — balanced:** steering gain helps Kids Room but can regress Pine
  Hairpins. Prefer well-timed preview over globally aggressive steering.
- **Yellow — heavy off-road:** optimize turn anticipation and steering response
  to retain momentum on dirt and ice; still obey real mass and tire grip.

Calibrate every proposed per-car policy on **Kids Room and Pine Hairpins** with
fixed seeds, plus official circuits and lane QA. A faster Kids Room time alone
must never excuse a slower/unsafe Pine Hairpins run.

Frozen 12-cell baseline: `qa/benchmarks/kidsRoomAiBaseline.json`. For each PR,
report the new 4 × 3 matrix and **Hard vs. creator best** for every car,
marking comparisons between solo AI and four-car human races as approximate.
The frozen baseline recorded Blue and Green Hard slower than Normal; PR #272
corrected that ordering. Preserve it on every new benchmark, not just one car.

## Implementation landmarks

- `src/domain/race/ai/cornerSpeed.ts`: speed prediction based on actual
  chassis response, grip, surface and braking distances; **do not** add
  track-specific, AI-only speed/physics boosts.
- `src/domain/race/ai/difficultyPolicy.ts`: difficulty-specific corner
  reserves, with **Hard as the pace reference**.
- `src/domain/race/ai/aiDriver.ts`: shared corner tactics; difficulty still
  affects safety, traffic and mistakes.
- `tests/domain/kidsRoomAiPace.test.ts`: source-replay-based pace and
  all-three-difficulty Green ordering.

When an AI change is proposed, the PR must report **Hard first**: finish
times, recoveries, performance and difficulty ordering, followed by Normal
and Easy. If Hard regresses, fix it before declaring the change complete.
