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

- Award a checkpoint only when the vehicle crosses its real road stripe forward and within the bounded lateral forgiveness. A nearby-road index jump does **not** award a checkpoint, and overpasses must respect elevation.
- A valid finish requires all authored checkpoints in sequence. Missing Finish must not add an extra lap.
- A missed checkpoint starts a two-second warning and reset countdown. Manual RECOVER, RESET NOW, and automatic recovery must return to a safe approach **before that same authored gate**, preserving lap and pending checkpoint. Do not jump to a later track section.
- Without a pending missed gate, RECOVER prefers the latest safe grounded road contact instead of jumping back to a distant checkpoint. Water and bridge recovery follow the same safe-contact constraints.
- Recovery never adds a separate scoring surcharge; splits, results and ghosts use the actual race clock.
- Manual recovery holds the recovered vehicle stationary for 30 running ticks (500 ms at 60 Hz). Repeated requests during the hold are ignored. Other drivers and the race clock continue normally. Automatic recovery adds no immobilization. Only the local human receives the yellow progress light, green release light, and restart sound. Missed-checkpoint recovery is automatic even when the player skips its countdown.

## Validation

- Fast domain/component tests must cover marker order (normal/reversed), crossing/near-edge bypass, missed-gate recovery, finish, checkpoint-free imports, old starter preservation, and save/undo.
- Verify checkpoint rendering in both editor and race and that the displayed stripe uses the exact physics gate sample. Mobile touch tests remain useful for hit targets.
- Run the fixed 60 Hz clean-lap benchmark for all three shipped tracks and calibrate actual geometry and medal targets before merging.
- Required gates: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` plus the repository's AI and mobile workflows. Do not merge with known gate regressions.
