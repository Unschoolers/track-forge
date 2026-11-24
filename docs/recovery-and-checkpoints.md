# Authored checkpoints, timing, and recovery

## Contract

- **One checkpoint system.** The editor owns checkpoints, serialized as road-distance ratios in `Track.recoveryCheckpoints`. There are no virtual quarter-lap sectors or invisible timing gates. The physical start/finish line remains a separate required gate.
- During a race, authored checkpoints are resolved to safe road samples, sorted in driving order (including reversed circuits), drawn as visible transverse stripes, and enforced in that same order. Splits include each checkpoint and then Finish, so gates per lap = authored checkpoints + 1.
- A track with **zero valid authored checkpoints is INCOMPLETE**. It remains available to edit, but cannot be raced in single-player, Cups, or nearby play. Importing or opening an old track never silently creates gates. Once the editor adds a checkpoint, the same track becomes raceable.
- While drawing a new track with auto-checkpoints enabled, add approximately one checkpoint every ten authored control points. Automatic creation appends only; deleting or manually moving a marker is respected. The creator can add, drag, or delete markers, and undo or cancel the gesture. Existing tracks with no markers stay incomplete.
- The game ships three simple crossing-free circuits (City Sprint, Desert Sweep, Toy Box Dash) with authored checkpoints and environmental scenery. Target lap time is approximately 30 seconds; the fixed-step QA benchmark is the acceptance test, not unverified gold medal targets.
- Retire old bundled circuits. On upgrade, only delete an **untouched** old starter: race identity alone is insufficient for deletion because it omits some edits (e.g. scenery). Any saved track that differs in editable content must be preserved.
- Timing/ghost/score identity is versioned so old quarter-sector results cannot be compared with authored-checkpoint runs.

## Gate crossing and recovery

- Humans and AI use the same swept checkpoint validator, including the finish. Award a checkpoint only when the vehicle crosses its real road stripe forward, on the correct road arm and elevation, within the physics road radius plus 10 world units of forgiveness. Endpoint on-road classification does not change the crossing tolerance. A nearby-road index jump does **not** award a checkpoint, and overpasses must respect elevation.
- A valid finish requires all authored checkpoints in sequence. Missing Finish must not add an extra lap.
- A missed checkpoint starts a separate two-second countdown for each car (a warning is shown only for the local player). Manual RECOVER, RESET NOW, and automatic recovery must return to a safe approach **before that same authored gate**, preserving lap and pending checkpoint. Do not jump to a later track section.
- Without a pending missed gate, RECOVER prefers the latest safe grounded road contact instead of jumping back to a distant checkpoint. Water and bridge recovery follow the same safe-contact constraints.
- Recovery never adds a separate scoring surcharge; splits, results and ghosts use the actual race clock.
- Manual recovery holds the recovered vehicle stationary for 30 running ticks (500 ms at 60 Hz). Repeated requests during the hold are ignored. Other drivers and the race clock continue normally. Automatic recovery adds no immobilization. Only the local human receives the yellow progress light, green release light, and restart sound. Missed-checkpoint recovery is automatic even when the player skips its countdown.

## Automatic driving recovery

- A grounded AI has up to two seconds to drive back onto the road using its existing low-speed pursuit controller. A distance exceeding 100 world units from its followed road is an immediate lost-car reset. Natural re-entry clears the timer and does not emit a recovery event. Airborne time does not advance the timer. Gate eligibility is independent of the 100-unit recovery limit: all cars must physically cross each gate in order. A forced reset never grants a checkpoint.
- A player accelerating below the existing low-speed threshold must accumulate two seconds of stuck time before an automatic reset; braking still prevents or decays that timer.
- Water contact, bridge-deck loss, manual recovery, and missed-checkpoint rules retain their existing immediate/countdown behavior. Forced resets still emit recovery telemetry. The optimization goal is zero forced resets, not zero excursions onto grass.

## Validation

- Fast domain/component tests must cover marker order (normal/reversed), crossing/near-edge bypass, missed-gate recovery, finish, checkpoint-free imports, old starter preservation, and save/undo.
- Verify checkpoint rendering in both editor and race and that the displayed stripe uses the exact physics gate sample. Mobile touch tests remain useful for hit targets.
- Run the fixed 60 Hz clean-lap benchmark for all three shipped tracks and calibrate actual geometry and medal targets before merging.
- Required gates: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` plus the repository's AI and mobile workflows. Do not merge with known gate regressions.

Gate geometry uses the same centered tangent as the road ribbon, for both painted stripes and physical validation. Crossing the infinite extension of a stripe while still on its approach road is not evidence of a missed checkpoint; only an off-road bypass or confirmed forward route progress can trigger the countdown.

At a sharp bend, the gate span follows the connected local road-support cross-section, not a fixed straight-road half-width. Only contiguous samples in the gate's route window may extend that span; disconnected road arms cannot extend it. The same 10-unit grace is applied to the resulting timing span. Painted stripes use the same cross-section at their visible width.
