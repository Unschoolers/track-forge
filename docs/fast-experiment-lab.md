# Fast experiment lab

Use a `lab/*` branch without an open PR for short, repeatable steering and AI experiments. A push triggers only the Fast experiment lab (not the normal PR or main release pipelines). The lab runs focused vehicle contracts, then the real AI optimization tool on Pine Hairpins, Meadow Loop, reverse Desert sand, Kids Room and Figure Eight, Hard, seed 1, all four cars, solo and traffic. It compares the original AI profiles against main, tries 14 driving-policy candidates per car on the changed physics, and uploads before/after summaries, timing and recovery data. This is a screening run, not proof of generalization or permission to merge.

The baseline uses main's checked-out physics, simulator, profiles and fixtures; only the CLI selector is shared to allow the same narrow study. No production configuration is promoted by the workflow. A regression in the targeted contracts or matched physics comparison fails the experiment. Full PR verification and the multi-track/multi-seed driving and passing studies remain mandatory before integration.

Local commands:
```sh
npx vitest run tests/domain/vehicleDynamics.test.ts tests/domain/vehiclePhysics.test.ts tests/domain/vehiclePhysicsConfig.test.ts tests/domain/carHandlingIdentity.test.ts tests/domain/carSpeedIdentity.test.ts
npm run qa:optimize -- --scenarios pine-hairpins,meadow-loop,desert-reverse,kids-room,figure-eight-replay --seeds 1 --workers 2 --trials 14 --no-telemetry
```

Use `--baseline-only` to measure current AI profiles without searching. The normal optimizer invocation (without new flags) retains its existing study.

For a physics recalibration, keep the physics candidate fixed and use `--reference <baseline-results.json>` from a matched `--baseline-only` run on main. The lab evaluates all 14 candidates per car on five tracks, compares directly against old physics, and validates the combined set of individually qualifying profiles with real traffic. Recovery counts may never increase for any matched vehicle. Existing automatic recovery events are recorded as debt; unrelated simulation errors and lost finishes remain blockers. Changes of up to 1 second slower per matched race are acceptable when the fleet improves overall, recoveries decrease, or a documented gameplay improvement is approved. Differences within ±0.1 seconds are neutral; average gain is measured in seconds with equal weight per car. A loss exceeding 1 second requires manual review, not silent acceptance. Rank candidates by recovery reduction first, pace second. A change with no meaningful benefit is not recommended. Use the explicit --gameplay-improvement flag only with documented player-facing evidence. Zero recoveries remains the target. No automatic production profile updates.
