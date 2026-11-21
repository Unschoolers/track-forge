# Advanced race replay export (v1)

## User journey

After a **single-player** race, hold the results status (e.g. **BEST GHOST SAVED** or **RACE DATA READY**) for 800 ms to reveal **EXPORT RACE FILE**. Normal taps and scroll gestures do nothing. Desktop users can right-click the status; keyboard users can focus it and press Enter or Space. Feedback respects the existing haptics preference.

The file is saved through the existing web/Android JSON export adapter as `trackforge-race-<track>-<timestamp>.json`. It includes the exact authored track and the current race setup, all vehicles and AI data, gameplay events and standings/splits. Unlike the best ghost, **this is the latest race** and remains available even when the race did not beat the record. Restart/leave invalidates it. Nearby multiplayer uses its separate diagnostics exporter.

## Contract

- `format: "trackforge-race-replay"`, `formatVersion: 1` distinguish it from importable track JSON. It must **not** be accepted as a track by `trackCodec`.
- `tickSeconds: 1/60`, `sampleTicks: 3` initially (20 Hz) record positions and AI state for every vehicle, with precise simulation tick and rounded timestamps.
- `frames[].vehicles` includes ID, car, player/rival flag, pose, velocity, handling state, progress, damage state, surface/structure, and AI lane/steer/pass phase. `frames[].input` holds sampled player control.
- `events[]` captures simulation events at the exact tick plus explicit manual resets. A recovery frame has `cut: true` on the affected car. Consumers must never interpolate across a cut.
- `result` includes finish order and splits. Rivals can continue for five simulated seconds after player finish; reports exported during that window contain whatever has been recorded so far.
- Recording is **in memory only**; no additional browser storage writes or new track-save schema. The previous best ghost logic remains unchanged.
- Memory is bounded to at most 6,000 timeline samples (historical points are compacted for long races) and 10,000 events. `droppedEvents` reports overflow explicitly.

## Debugging and future playback

Replay consumers should draw recorded vehicle coordinates against the included track, not re-simulate physics (which changes between game versions). Frame data supports watching the player and opponents together and inspecting the recorded AI state. V1 exports telemetry; an interactive replay importer/viewer is a separate enhancement, not needed for export and bug reports.

## Verification

`tests/application/raceDiagnostics.test.ts` protects all-car capture and recovery/terminal boundaries. `tests/ui/raceDiagnostics.test.ts` protects hold vs tap, gesture cancellation, availability for non-record races and keyboard access. Verify typecheck/lint/build and Android export on device before merging.
