# Advanced race replay export (v1, with precise driver input trace)

## User journey

After a **single-player** race, hold the results status (e.g. **BEST GHOST SAVED** or **RACE DATA READY**) for 800 ms to reveal **EXPORT RACE FILE**. Normal taps and scroll gestures do nothing. Desktop users can right-click the status; keyboard users can focus it and press Enter or Space. Feedback respects the existing haptics preference.

The file is saved through the existing web/Android JSON export adapter as `trackforge-race-<track>-<timestamp>.json`. It includes the exact authored track and the current race setup, all vehicles and AI data, gameplay events and standings/splits. Unlike the best ghost, **this is the latest race** and remains available even when the race did not beat the record. Restart/leave invalidates it. Nearby multiplayer uses its separate diagnostics exporter.

## Contract

- `format: "trackforge-race-replay"`, `formatVersion: 1` distinguish it from importable track JSON. It must **not** be accepted as a track by `trackCodec`.
- `tickSeconds: 1/60`, `sampleTicks: 3` initially (20 Hz) record positions and AI state for every vehicle, with precise simulation tick and rounded timestamps.
- `frames[].vehicles` includes ID, car, player/rival flag, pose, velocity, handling state, progress, damage state, surface/structure, observed surface grip, curb contact, player brake pressure (AI pressure is not persisted), and AI lane/steer/pass phase. `frames[].input` retains the legacy sampled player control.
- `playerControls[]` captures **every 60 Hz physics tick** of the human player's steering, throttle, and brake as compact tuples `[tick, steering, throttle, braking]` (braking is `0` or `1`). Align ticks to the 20 Hz pose samples for corner-by-corner analysis; this preserves short brake presses that pose-only sampling could miss. `playerInputSampleTicks` reports the actual interval, normally `1`; exceptionally long runs compact older input history with an explicit lower cadence.
- `events[]` captures simulation events at the exact tick plus explicit manual resets. A recovery frame has `cut: true` on the affected car. Consumers must never interpolate across a cut.
- `result` includes finish order and splits. Rivals can continue for five simulated seconds after player finish; reports exported during that window contain whatever has been recorded so far.
- Recording is **in memory only**; no additional browser storage writes or new track-save schema. The previous best ghost logic remains unchanged.
- Memory is bounded to at most 6,000 pose samples, 18,000 compact player-input samples and 10,000 events. Long-run pose and input histories compact independently; `sampleTicks` and `playerInputSampleTicks` report their effective cadences. `droppedEvents` reports event overflow explicitly.

## Debugging and future playback

Replay consumers should draw recorded vehicle coordinates against the included track, not re-simulate physics (which changes between game versions). Frame data supports watching the player and opponents together and inspecting the recorded AI state. For diagnosing a faster human lap, align each `playerControls[]` tick to vehicle frames by `tick`, compare braking point, grip, lateral offset and exit speed, and verify sector events. This data is measured, not an inferred steering plan. V1 exports telemetry; an interactive replay importer/viewer is a separate enhancement, not needed for export and bug reports.

## Verification

`tests/application/raceDiagnostics.test.ts` protects all-car capture and recovery/terminal boundaries. `tests/ui/raceDiagnostics.test.ts` protects hold vs tap, gesture cancellation, availability for non-record races and keyboard access. Verify typecheck/lint/build and Android export on device before merging.
