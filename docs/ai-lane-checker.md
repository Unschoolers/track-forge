# AI lane checker

Run actual AI driving and race physics without a browser or renderer. Time
advances in fixed 1/60-second steps as quickly as the CPU permits. The same seed,
track and options produce identical core JSON, including trails and findings.

```sh
npm ci
npm run qa:lanes
```

Open `qa/results/lanes/report.html`. It contains the road, coloured dots for each
car, red error rings, amber warning rings, per-driver metrics, and exact failure
times, coordinates and authored section IDs. Hover dots for lane, target lane,
height, speed and passing phase. Expand another run to compare seeds/directions.
The sections-to-inspect table groups recurring findings across runs.
`report.json` contains the full parameters, 10 Hz samples and every finding.
Detection still runs on **every 60 Hz physics step**, regardless of sample rate.

## Repeatable batches

```sh
# Starter track, 3 seeds, normal difficulty, traffic, both directions, one lap.
npm run qa:lanes

# Separate basic steering/path bugs from overtaking/contact bugs.
npm run qa:lanes -- --scenario all --mode both --seeds 10

# Reproduce the seed, direction, car and difficulty reported by a failing run.
npm run qa:lanes -- --scenario bridge --mode traffic --seed 17 --seeds 1 --direction reverse --difficulty hard --car green

# Stress every car and difficulty with a larger simulation budget.
npm run qa:lanes -- --scenario all --mode both --difficulty all --car all --seeds 5 --seconds 180 --laps 3

# A saved track object or the app's JSON track array; --track can be repeated.
npm run qa:lanes -- --track ./my-tracks.json --seeds 10

# Fail on error findings; without --strict findings are diagnostic output.
npm run qa:lanes -- --strict
```

`--track` replaces built-in scenarios, reuses the app's track migrations, and
honours each track's start ratio. Direction comes from `--direction` (default
both), so custom tracks are checked in both directions too. Unclosed/unraceable
tracks fail clearly before simulation. To obtain the current browser track
array, copy the JSON value of `trackforge-library-v2` from local storage; the
Android application's storage is separate from your desktop browser.

Imported tracks are checked before geometry expansion. The QA compiler accepts
at most 2,000 authored control points and 10,000 estimated curve samples; inputs
over those budgets fail with exit code 2. This is a diagnostic-tool budget, not
a change to the game's editor limits. Translate coordinates freely; maps fit
the actual circuit rather than including the world origin.

Built-in fixtures: the mixed-surface starter circuit, tight hairpins, and a
bridge crossing. Seeds vary the AI's existing random mistakes. Short runs or
easy tracks can legitimately produce identical paths across different seeds.
Traffic mode converts all four grid slots to AI, including the usual player;
solo mode drives only the selected car. These are AI diagnostics, not a replica
of a race with human input. Finished opponents stop participating in checks.

## Findings

| Finding | Rule | Severity |
|---|---|---|
| Off road | Outside supported road for at least 0.25 s | Warning |
| Lane deviation | Actual lane differs from current target by over 18 units for 1 s | Warning |
| Wrong way | Road-tangent velocity opposes travel direction by over 15 units/s for 0.75 s | Warning |
| Stalled | No new forward route progress of at least 6 units for 5 s | Warning |
| Collision | New vehicle or bridge-barrier contact from the race engine | Warning |
| Path jump | One-step route-distance change exceeds max(40, speed × dt × 3 + 12) | Error |
| Recovery | Automatic off-road or water reset; records the position **before** reset | Error |
| Invalid lane | Planned lane outside ±25 units | Error |
| Invalid state | Invalid numeric vehicle state or route index; aborts the run | Error |
| Timeout | A driver has not completed the requested laps within the budget | Error |

Continuous problems emit one finding per episode. Off-road warnings are allowed
to recover; recoveries stay errors even if the car eventually finishes. Warnings
are candidates to inspect, not proof of a bug, particularly intentional passing,
random mistakes, and ice driving. Timeout depends on budget/track length.
No AI tuning or physics simplification is applied by this tool.

Exit codes: 0 completed diagnostics, 1 error findings with `--strict`, 2 invalid
inputs or execution failure. `--help` prints all options. Report files are
ignored by git. Simulation time and wall time are printed separately; shared CI
performance is not a stable benchmark.

The **AI lane QA** workflow runs a small matrix for domain/gameplay PRs and can
be started manually with more seeds. Download its `ai-lane-report` artifact and
open `report.html`. Findings do not fail this baseline workflow while existing
AI faults are being investigated. Input/runtime failures still fail the job.
