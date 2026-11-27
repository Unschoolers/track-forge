# Advanced race replay export (v1, with precise driver input trace)

## User journey

During a local race, open Pause → **EXPORT DIAGNOSTICS** to save the current replay and performance data. The race stays paused, no result or score is created, and the same recording continues after Resume. Nearby's in-race menu offers **DOWNLOAD DIAGNOSTICS** through its separate network exporter; the shared race keeps running.

After a **single-player** race, hold the results status (e.g. **BEST GHOST SAVED** or **RACE DATA READY**) for 800 ms to reveal **EXPORT RACE FILE**. Normal taps and scroll gestures do nothing. Desktop users can right-click the status; keyboard users can focus it and press Enter or Space. Feedback respects the existing haptics preference.

The file is saved through the existing web/Android JSON export adapter as `trackforge-race-<track>-<timestamp>.json`. It includes the exact authored track and the current race setup, all vehicles and AI data, gameplay events and standings/splits. Unlike the best ghost, **this is the latest race** and remains available even when the race did not beat the record. Restart/leave invalidates it. Nearby multiplayer uses its separate diagnostics exporter.

The export also contains `performance.timings.frames`, sampled once per rendered
race frame. Each row contains the simulation tick, frame interval, race update,
simulation and CPU render submission times in milliseconds. Recording pauses
while the race is paused, and is capped at 36,000 samples; `droppedFrames`
reports any additional frames. The export also includes the browser user agent, pixel ratio and viewport size. GPU completion and garbage collection are not
measured directly. A long frame interval with short measured CPU durations
therefore needs further profiling before attributing its cause.

## Contract

- `format: "trackforge-race-replay"`, `formatVersion: 1` distinguish it from importable track JSON. It must **not** be accepted as a track by `trackCodec`.
- `tickSeconds: 1/60`, `sampleTicks: 3` initially (20 Hz) record positions and AI state for every vehicle, with precise simulation tick and rounded timestamps.
- `frames[].vehicles` includes ID, car, player/rival flag, pose, velocity, handling state, progress, surface/structure, observed surface grip, curb contact, player brake pressure (AI pressure is not persisted), and AI lane/steer/pass phase. `frames[].input` retains the legacy sampled player control.
- `playerControls[]` captures **every 60 Hz physics tick** of the human player's steering, throttle, and brake as compact tuples `[tick, steering, throttle, braking]` (braking is `0` or `1`). Align ticks to the 20 Hz pose samples for corner-by-corner analysis; this preserves short brake presses that pose-only sampling could miss. `playerInputSampleTicks` reports the actual interval, normally `1`; exceptionally long runs compact older input history with an explicit lower cadence.
- `events[]` captures simulation events at the exact tick plus explicit manual resets. A recovery frame has `cut: true` on the affected car. Consumers must never interpolate across a cut.
- `result` is explicitly `null` for an unfinished capture (including countdown); completed exports include finish order and splits. Rivals can continue for up to 40 simulated seconds after player finish, stopping earlier when all rivals finish; reports exported during that window contain whatever has been recorded so far.
- Recording is **in memory only**; no additional browser storage writes or new track-save schema. The previous best ghost logic remains unchanged.
- Memory is bounded to at most 6,000 pose samples, 18,000 compact player-input samples and 10,000 events. Long-run pose and input histories compact independently; `sampleTicks` and `playerInputSampleTicks` report their effective cadences. `droppedEvents` reports event overflow explicitly.

## Compatibility

The existing version 1 contract is retained. New exports report `setup.handling: 'arcade'`, `wrecked: false` on vehicle frames and standings, `result.playerWrecked: false`, and `handling: 'arcade'` on categorized high scores. These compatibility fields exist only in the replay serializer, not live gameplay. Existing files remain readable without migration. Historical Simulation collision events can still be analyzed as recorded; comparisons warn about different rulesets. Unknown versions and damaged telemetry fail explicitly.

## Debugging and future playback

Replay consumers should draw recorded vehicle coordinates against the included track, not re-simulate physics (which changes between game versions). Frame data supports watching the player and opponents together and inspecting the recorded AI state. For diagnosing a faster human lap, align each `playerControls[]` tick to vehicle frames by `tick`, compare braking point, grip, lateral offset and exit speed, and verify sector events. This data is measured, not an inferred steering plan. Version 1 exports remain readable by the offline analytics tools; an interactive replay importer/viewer is a separate enhancement, not needed for export and bug reports.

## Verification

`tests/application/raceDiagnostics.test.ts` protects all-car capture and recovery/terminal boundaries. `tests/ui/raceDiagnostics.test.ts` protects hold vs tap, gesture cancellation, availability for non-record races and keyboard access. Verify typecheck/lint/build and Android export on device before merging.

Optional `performance.timings.bitmapWork` records bounded deferred texture
work samples: operation (prepare/upload), layer (0 road, 1 terrain, 2 bridge
approach, 3 bridge deck), tile key, priority, CPU durationMs, and afterFrame
(the one-based count of the preceding recorded frame; the following interval
is the one potentially affected). `droppedBitmapWork` reports overflow. The
existing five-column frame contract is unchanged. Startup prewarming is not
included in these race-streaming samples.

Expanded performance exports also include `presentationColumns` and
`presentationFrames` (one aligned row per legacy frame, null if unavailable).
They record monotonic frame/update timestamps, ground/culling, vehicle/effect
and lighting CPU durations, camera pose, visible hill/water/bridge vector batch
and primitive counts, lamp batches, and needed/visible/resident tile counts by
layer. Primitive counts are workload proxies, not draw calls or GPU timings.
`longTasks` records browser main-thread tasks over 50 ms when supported, with
monotonic start/duration timestamps; support is identified in device metadata.
Build run/attempt and renderer type/initial canvas dimensions identify the
capture. None of these measurements waits for GPU completion. This is a
passive diagnostic: no layer toggles, quality changes or forced synchronous
GPU queries. The existing frame and replay contracts remain readable.
