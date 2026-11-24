# Drift Boost v1 — implementation plan

**Status:** gameplay decisions approved; implementation pending.
**Date:** 2026-11-23
**Scope:** experimental Arcade-only drift-powered boost. No production gameplay changes are included in this planning document.

Follow [architecture](../../architecture.md), [engineering guidelines](../../engineering-guidelines.md), [delivery workflow](../../change-workflow.md), [testing guidelines](../../testing-guidelines.md), [AI tuning](../../ai-tuning.md), [race replays](../../race-replays.md) and [LAN multiplayer](../../lan-multiplayer.md).

## 1. Approved gameplay contract

| Rule | Behavior |
| --- | --- |
| Availability | Arcade only; Simulation is unaffected. |
| Charging | Valid drift duration multiplied by speed. |
| Road surfaces | Street, dirt and ice charge at the same rate for equivalent qualifying drift and speed. |
| Braking drifts | Eligible to charge. |
| Off-road / airborne | No charge. No stationary spins or collision-induced slip farming. |
| Charge retention | Charge accumulates across corners without decay; recovery preserves unspent charge. |
| Activation | A deliberate press when charge is 100%; the entire charge is consumed. |
| Initial speed | Instantly double current forward speed, bounded by the boosted ceiling. |
| Propulsion | Allow continued acceleration up to 2x the car's normal maximum while active. |
| Duration | 1 second. |
| Braking | Immediately cancel active boost; no charge refund. |
| Recovery | Cancel active propulsion, preserve unspent charge, never charge during recovery. |
| HUD | Compact top-of-screen boost meter; button pulses above the brake when ready. |
| Effects | Exhaust flames match the selected player's pin/topper color. |
| Records and ghosts | Separate boost-enabled race categories; retain existing records and ghosts. |
| AI | Earn and use boost under the same rules as humans. |

Keep steering and normal car identity intact. Reward skillful drift use without making drifting everywhere systematically faster than clean cornering.

## 2. Tuning configuration

Proposed new domain module: `src/domain/race/boostConfig.ts`. Initial experimental values, not production-calibrated results. Keep gameplay tuning together and independent from normal vehicle handling tuning.

```typescript
export const BOOST_CONFIG = {
  enabled: true,
  charge: {
    referenceSpeed: 200,
    secondsToFull: 5,
    minimumSpeed: 90,
    minimumSlipAngleDegrees: 12,
    maximumSlipAngleDegrees: 45,
    minimumDriftSeconds: 0.2,
    decayPerSecond: 0,
    surfaceMultiplier: {
      street: 1,
      dirt: 1,
      ice: 1,
      grass: 0,
    },
    carMultiplier: {
      red: 1,
      blue: 1,
      green: 1,
      yellow: 1,
    },
    allowBraking: true,
    allowAirborne: false,
  },
  activation: {
    durationSeconds: 1,
    initialSpeedMultiplier: 2,
    maximumSpeedMultiplier: 2,
    accelerationMultiplier: 2,
    decelerationSeconds: 0.4,
    cancelOnBrake: true,
    preserveChargeOnRecovery: true,
  },
} as const
```

The global enable flag is a capability/kill switch; effective race rules additionally require Arcade and explicit experimental opt-in during beta. Freeze those rules for the entire race. Do not enable the feature by default until release validation.

### Charge formula and state lifecycle

For normalized charge in [0, 1], after a continuous qualifying drift reaches the minimum duration:

```text
chargeDelta = dt / secondsToFull
            * speed / referenceSpeed
            * surfaceMultiplier
            * carMultiplier
charge = clamp(charge + chargeDelta, 0, 1)
```

Use actual world-unit speed and forward/lateral velocity relative to vehicle heading to measure slip angle. Reject reverse motion, stationary spins, non-finite inputs, airborne motion, off-road surfaces, collision/recovery artifacts and uncontrolled slides outside the qualifying angle envelope. Do not accumulate while boost is active or during the post-boost return to normal. Pause freezes all timers; countdown, finished and wrecked states cannot earn or activate boost.

```text
CHARGING -> READY (100%) -> ACTIVE (one deliberate press)
    ^                       |
    |                       v
    +---------- DECELERATING (duration elapsed or brake)
```

Recovery clears active/transient state but retains unspent charge. A held button must never auto-trigger a second activation after recharging. Brake wins over a simultaneous activation request. Release the input on reset, pause and race exit. No refund for canceled/consumed boost.

### Initial per-car speed envelopes

Based on the current `CAR_PHYSICS_SPECS` at planning time (world units/s, nominal base maximum; not measured on every terrain):

| Car | Normal max | Boost max |
| --- | ---: | ---: |
| Red | 337 | 674 |
| Blue | 306 | 612 |
| Green | 294 | 588 |
| Yellow | 286 | 572 |

Do not change baseline grip, braking or handling just to increase charge. Start with equal charge multipliers. Red may drift more often than Yellow; tune per-car multipliers only if benchmarks justify it.

## 3. Architecture and delivery phases

### Phase 1 — Domain and drift detection

- [ ] Create focused `boost.ts`, `boostConfig.ts` and `driftDetection.ts` modules in the race domain.
- [ ] Add typed per-vehicle boost state and race-local effective rules; initialize/reset via existing factory and recovery lifecycle.
- [ ] Share underlying drift measurements/qualification with `src/ui/screens/driftCue.ts` without introducing UI dependencies in the domain. Preserve existing non-boost cue behavior; the current cue excludes braking and uses surface-specific lateral-speed thresholds, so it cannot directly be the scoring authority.
- [ ] Keep the state machine deterministic at the existing 60 Hz tick rate. Tests cover thresholds, charge clamping, invalid drift, braking drift, equal surface rates, duration, pause, recovery and held input.

### Phase 2 — Physics integration

- [ ] Integrate with `vehiclePhysics.ts`, `vehicleDynamics.ts`, `raceVehicleStepper.ts` and race lifecycle at the narrowest owner.
- [ ] Apply one initial forward-speed impulse, then additional propulsion with a temporary ceiling of 2x the car's nominal maximum. Preserve lateral velocity/steering and avoid repeatedly doubling speed.
- [ ] Explicitly handle the existing separate safety limiter (`maximumSpeedFactor = 1.2` with nominal `safetySpeed`) and avoid stacking existing AI catch-up assist beyond the boosted ceiling. Merely increasing the engine speed limit is insufficient.
- [ ] Keep braking, grip, terrain and collision rules authoritative; define and test safe speed-envelope return over the configurable 0.4 seconds without overriding a driver's braking or introducing a second impulse.
- [ ] Validate high-speed checkpoint/finish crossing, recovery, bridges, ramps, water, barriers and collisions at boosted speeds. No tunneling, skipped gates or invalid positions.
- [ ] Prove non-boost and Simulation physics remain unchanged with deterministic comparison tests.

### Phase 3 — HUD and controls

- [ ] Add a compact segmented meter at the top of `raceHud.ts` without obscuring timing, position or split information.
- [ ] Keep a stable button area above BRAKE, show/pulse the button only when ready, and display active countdown/depletion feedback. No control repositioning during a race.
- [ ] Extend `DriverInput`, `RaceControlsPort`, `raceInput.ts` and touch binding as needed; activation is a one-shot command consumed by a running physics tick.
- [ ] Support mobile multitouch while steering and desktop Space if unassigned; prevent synthesized click duplication, input loss and accidental brake presses. Use existing accessible control and input-reset patterns.
- [ ] Add component tests for visibility, readiness, pulse state, pause/reset/exit and simultaneous steering/boost. Verify Android touch behavior.

### Phase 4 — Effects and feedback

- [ ] Add exhaust anchors to vehicle artwork (appropriate to each car) and use the existing vehicle transforms for position/orientation/height.
- [ ] Render flames using the actual selected identity pin/topper color, not the car's paint. Resolve local and remote identities at the presentation boundary; use an appropriate existing default when necessary.
- [ ] Reuse race effects/rendering infrastructure and bounded particle budgets. Flames stop promptly when active boost ends; optional subtle speed lines, ignition audio and haptic feedback respect existing preferences.
- [ ] Validate day/night visibility, bridge elevation, multiple cars, ghost rendering and frame-time budget. No network particle payloads.

### Phase 5 — AI strategy and tuning

- [ ] All AI cars use the same charge and activation rules; no hidden free charge or artificial speed bonus.
- [ ] Add a focused AI boost decision policy based on upcoming curvature, straight length, braking distance, speed, surface and per-car handling. Avoid risky activation near hairpins, crossings and recovery hazards.
- [ ] Use the existing AI tuning tool for all four cars. Compare deterministic baseline and tuned runs; preserve per-car and difficulty behavior. No track-specific policy exceptions.
- [ ] Measure with/without boost lap times and recovery/collision counts; improve times through measured tuning and reject regressions. Run deterministic lane tests and `npm run qa:lanes` as applicable.

### Phase 6 — Multiplayer

- [ ] Extend the existing nearby/LAN protocol with compact boost state and race-rule compatibility; ensure all participants agree on boost-enabled rules and version.
- [ ] Synchronize activation/cancellation and enough active state for remote exhaust visuals and pose interpolation, including loss/out-of-order handling and recovery cuts. Do not send particles or introduce a high-frequency side channel.
- [ ] Test compatible and incompatible peers, stale state, pause/reset, disconnect and remote color/pose rendering. Measure packet overhead and smoothness at boosted speeds.

### Phase 7 — Records, ghosts and diagnostics

- [ ] Add boost-enabled rule identity to record and ghost categories in the existing storage/record ownership boundary; missing legacy metadata means boost disabled. Existing records remain readable and intact.
- [ ] Ensure ghost selection, time trial and medal/record lookup never accidentally compare incompatible race rules.
- [ ] Version diagnostic replay changes as needed; capture precise boost activation input at 60 Hz and charge, active duration, speed, cancellation and recovery state/events in bounded telemetry.
- [ ] Preserve existing replay compatibility. Ghosts play recorded poses/effects; do not re-simulate old physics to reconstruct boost.

### Phase 8 — Beta and release validation

- [ ] Complete component/domain tests first; use browser/device tests only for behavior requiring actual input/rendering.
- [ ] Expose **Enable Boost (Experimental)** in Arcade race setup during beta, default off until all release checks pass.
- [ ] Run the benchmark matrix below, collect telemetry and adjust only centralized parameters before considering default enablement.
- [ ] Document tuning outcomes, known limitations, compatibility and rollback.

## 4. Beta benchmark matrix

Use the five existing project track exports as deterministic regression fixtures (not special AI rules). Verify each car in both directions where supported, with equivalent seeds, handling, difficulty and race setup. Compare boost off/on and tuned vs untuned AI.

| Track | Primary focus |
| --- | --- |
| Rally2 | Sustained drift and accumulation |
| Sandy Beach | Terrain interactions and recovery |
| City Harbor | High-speed control and obstacles |
| Figure Eight | Timing gates and crossings |
| Kids Room | Technical driving and car balance |

Collect lap/finish time, time to full charge, activations per lap, time gained per boost, recovery/collision rate, AI boost efficiency, frame rate/frame time and multiplayer packet overhead. Track results by car and direction, not just aggregate averages. Include controlled clean-cornering vs drift-heavy runs to detect boost farming or balance problems.

## 5. PR sequence and agent ownership

| PR | Scope | Dependency |
| --- | --- | --- |
| 1 | Domain, physics, deterministic component tests | Base |
| 2 | HUD, input, visual and audio feedback | PR 1 contracts |
| 3 | AI strategy, per-car tuning and performance benchmarks | PR 1 contracts |
| 4 | Multiplayer, records, ghosts, replay compatibility and final release checks | Prior PRs |

Parallelize independent work after interfaces are stable. Assign separate file ownership; integrator reviews overlapping changes and reruns relevant gates after concurrent merges. Follow the repository workflow: branch from current main, focused PRs to main, fix blocking failures, merge only after review and required gates. No speculative framework rewrite.

## 6. Acceptance criteria

- [ ] Existing non-boost physics remain unchanged.
- [ ] Simulation mode is completely unaffected.
- [ ] Boost duration is deterministic at 60 Hz.
- [ ] Street, dirt and ice charge at equal rates for equivalent valid drift speed and duration.
- [ ] Braking drifts charge correctly; stationary spins, grass and airborne motion do not.
- [ ] Braking immediately cancels active boost; spent charge is not refunded.
- [ ] Recovery preserves unspent charge and cancels active propulsion.
- [ ] Holding boost cannot automatically trigger another boost.
- [ ] Boost speed never exceeds the configured boosted ceiling; post-boost behavior is safe.
- [ ] Cars retain individual handling characteristics.
- [ ] Checkpoints, finish lines, collisions and recovery remain correct at boosted speed.
- [ ] Mobile multitouch works without interrupting steering.
- [ ] Multiplayer and ghosts display appropriate boost effects.
- [ ] Historical records and ghosts remain intact in separate categories.
- [ ] AI tuning benchmarks pass without unacceptable driving regressions.
- [ ] Component tests, typecheck, lint, build and CI pass.
- [ ] Android gameplay and performance validated before enabling by default.

Run narrow relevant tests, then `npm run verify` (or `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`). Use `npm run qa:mobile` for touch/scene changes and `npm run qa:lanes` for AI. Record actual commands and outcomes in each PR; do not assert tests passed without evidence.

## 7. Alternatives, migration and rollback

Avoid UI-owned drift scoring, multiplying velocity every tick, simply raising the ordinary engine speed limit, weakening brake/grip physics, or granting AI an unrelated speed bonus. These break ownership, stability or fairness. Prefer a race-local deterministic state machine with one shared physics contract.

Use backward-compatible legacy boost-off record/ghost interpretation and explicit multiplayer rule compatibility. Keep the feature opt-in and kill-switchable while incomplete. Rollback disables new boost-enabled races without deleting historical records/ghosts or changing ordinary Arcade/Simulation behavior. Preserve benchmark fixtures, seeds and telemetry for regression diagnosis.

All tuning values are provisional until beta evidence; no further gameplay decisions are required to start development. This document does not claim that implementation, benchmarks or tests have been performed.
