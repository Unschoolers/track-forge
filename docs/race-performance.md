# Race performance baseline

## Imported track editor profiling

Use the opt-in SSR profiler to separate JSON import, domain geometry, terrain
mesh compilation, and representative editor mutations for a saved or imported
track. It accepts either a Track Forge export wrapper (`{ "track": ... }`) or
the track object directly and prints one JSON report:

```sh
node qa/perf/track-profile.mjs path/to/track.trackforge.json
```

The report includes JSON parsing and `decodeTrack`, cold and warm
`TrackGeometryService` lookups, full and overview terrain presentation builds,
a 16-cell terrain paint and a one-point move, plus geometry rebuilds after each
edit. Timings are single-process Node/Vite SSR samples; they exclude Vite module
startup, Phaser rendering, browser layout, GPU work, and pointer sampling. They
are useful for finding expensive domain stages, not for claiming an editor FPS
or device improvement. Compare the same file, Node version, and machine before
and after changes. Use browser/device profiling for rendering and interaction
latency.

Run its focused contract test with:

```sh
node --test qa/perf/track-profile.test.mjs
```

Record City Harbor in both lighting modes and use daytime for Rally and Sandy
Beach. Use the same saved track files before and after a change.

| Track | Lighting | Mode |
| --- | --- | --- |
| City Harbor | Day | Normal Race or Race AI, as offered |
| City Harbor | Night | Normal Race or Race AI, as offered |
| Rally | Day | Race AI |
| Sandy Beach | Day | Normal Race or Race AI, as offered |

Choose Blue, Arcade, Normal difficulty and Dynamic zoom on. Use two laps for
closed circuits and one run for point-to-point tracks. Each race should report
four cars. Keep audio settings fixed and leave the controls untouched for the
first five seconds after **GO**.

1. Reload the app, open Race Setup for the track and choose the lighting and mode
   from the table. Leave the flyover playing for five seconds after setting
   those options, then press **Start Race**. Save this as the first-run capture.
2. After the capture completes, use the race menu to **Quit to Home**. Open the
   same Race Setup again, apply the same settings, and press **Start Race**
   after the same five seconds of flyover playback. Save this as the warm run.
3. Capture three pairs per scenario on each build. Compare the median of the
   three first runs and the median of the three warm runs separately.

## Visual frame pacing and high-refresh motion

Race physics stays fixed at 60 Hz for deterministic handling, collision,
multiplayer and recordings. `RaceSession.presentationState()` is a **render-only**
view: it blends the two most recent simulation poses using the remaining
fractional fixed-step time. Phaser's normal `requestAnimationFrame` display
loop may draw at 30/60/90/120+ FPS; it is **not capped at 60 FPS**. Drawing
never advances simulation or publishes extra race snapshots. Interpolation
resets on restart, pause, manual recovery and automatic recovery/teleport.

Do not enable pixel rounding on the rotating, fractionally zoomed race camera
or force `setTimeout` as a pacing workaround. Do not request Android 120 Hz or
pick a default FPS cap based on desktop benchmarks: Android may impose a
display cap and higher refresh rates cost battery.

To verify visually, drive at high speed on City Harbor daylight and night,
Rally and Sandy Beach with dynamic zoom on and off, ideally on both a
60 Hz and a 90/120 Hz device. Watch whether the car **and its shadow, lights,
topper and camera** move smoothly, including steering, ramps, restart and
recovery. Compare actual `frameIntervalMs` p50/p95/p99 and recording setup
with the same device and track. A 30 FPS mode is desirable only if its
presentation times are evenly paced (about 33.3 ms apart on a 60 Hz panel);
do not treat an unverified `fps.target` setting as a limiter or an energy
optimization. Measure temperature, energy use and thermally sustained FPS on
physical Android devices before enabling high-refresh native requests.

## Physical Android debug APK

Build an instrumented debug APK locally using the Android prerequisites in the
[README](../README.md). Install it on a spare device or update a local build that
uses the same signing key and an equal or lower version code.

```sh
npm ci
VITE_TRACKFORGE_RACE_PERF=1 npm run android:apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

On PowerShell set `$env:VITE_TRACKFORGE_RACE_PERF = '1'` before running
`npm run android:apk`.

Open Track Forge on the phone. Connect with USB debugging and open the
`https://trackforge.local` WebView in desktop Chrome's `chrome://inspect/#devices`.
In its console, set `location.search = '?racePerf'` to reload with profiling
enabled. Import any missing saved tracks through **Race → Import Track**.

Press **Start Race** from Race Setup and leave the game in the foreground.
Once the capture has completed, copy the result from the WebView console.

```js
copy(JSON.stringify(window.__trackForgeRacePerformance.report(), null, 2))
```

Compare results with `status: "complete"`. Pausing, backgrounding, or reaching
the finish during sampling interrupts the capture. Keep the device, Android and
WebView versions, display refresh rate, and build commit with the JSON. Use
`location.reload()` before each new pair to retain the benchmark query.

## Mobile Chromium smoke test

Use the existing mobile browser harness to capture the same JSON with the Pixel 7
emulation in an 844 × 390 viewport. The default run uses Starter Circuit.

```sh
npm ci
npx playwright install chromium
npm run qa:mobile -- race-performance
```

For all four scenarios, place the exports in a local directory with filenames
`City-Harbor.trackforge.json`, `Rally.trackforge.json` and
`Sandy-Beach.trackforge.json`. The harness selects tracks by their imported
names.

```sh
TRACKFORGE_RACE_PERF_TRACKS=/path/to/exports npm run qa:mobile -- race-performance
```

This is an **opt-in diagnostic**, excluded from routine CI browser shards. Set `TRACKFORGE_PERFORMANCE_QA=1` when explicitly invoking this test under CI (normal local invocation does not need it).\n\nOpen `race-performance.json` in the benchmark test attachments. The
export-based scenarios use the first-run and warm-run procedure and attach
`race-performance-first.json` and `race-performance-warm.json`. Add
`--repeat-each=3` for three capture pairs per scenario. Use the physical device
runs to compare against the performance targets.

## Report fields

| Field | Measurement |
| --- | --- |
| `startToCountdownMs` | Setup button click to the first Phaser post-render with a countdown cue shown in the race HUD |
| `frameIntervalMs` | Elapsed time between successive Phaser frame timestamps that reached post-render while racing |
| `raceUpdateMs` | Time in the race scene update, including simulation and drawing command preparation |
| `simulationMs` | Time around input preparation and the race session advance, including fixed steps and synchronous subscriber work |
| `renderSubmissionMs` | Time from Phaser pre-render to post-render, including scene drawing and renderer submission |

The four sampled fields give nearest-rank p50, p95 and p99 in milliseconds. The
sample starts after the first running frame and spans five seconds or 2,048
samples, whichever comes first. Rendering timings are on the WebView thread.
On physical Android, aim for warm Start → countdown under 500 ms. On a 60 Hz
device, aim for frame p95 below 20 ms and frame p99 below 33 ms.

## Sandy Beach terrain culling comparison

On the supplied Sandy Beach export, import the track and use **Remove extra
road** before saving. The repair retains the first 21 road controls and the
original terrain, trees, and scenery. With the export-based browser harness,
the repair is applied automatically when offered.

A three-pair comparison in headless Chromium with SwiftShader, Pixel 7 emulation,
and the 844 × 390 viewport produced the following medians of per-run p95s:

| Warm run metric | Before | After terrain culling |
| --- | ---: | ---: |
| Frame interval | 66.7 ms | 50.0 ms |
| Render submission | 19.6 ms | 11.6 ms |

The baseline frame p95 ranged from 50.1 to 300 ms, showing substantial host
and software-rendering variation. These numbers demonstrate the harness and
an observed reduction in this environment; they do not establish Android GPU
performance. Repeat the documented physical-device protocol for device targets.

## Race prewarm failure diagnostics

Optional presentation prewarming runs in short deferred slices before the race. If a texture or geometry prewarm fails, it now emits a bounded console error with the original exception and stops that prewarm job. The normal synchronous rendering path remains available; an exception is **not** evidence of a successful prewarm. Record the track, lighting, platform and console error when investigating first-frame stalls. Do not hide the error or reduce rendering quality to make the log disappear.

## Papou night-race stutter investigation

The reported course contains 36 authored road points, 2,627 terrain cells
(2,082 hill and 545 water), 16 trees, a long elevated segment, and night
lighting. The previous static-tree fix does not address per-frame lamp halo
commands. Each visible lamp previously added five circle commands and five
style changes on every frame, even though its transform and colors are fixed.
The race now constructs those same commands once in additive batches of eight
lamps, using bounds that cover both the road halo and the fixture. Existing
padded static culling controls visibility; only moving vehicle lights are
regenerated each frame. This reduces CPU-side command construction, not
necessarily the GPU geometry submission cost of Phaser Graphics.

This is an identified redundant workload, not a confirmed root cause of the
reported two-to-three-second cadence. Reproduce on the same Android device in
both lighting modes, dynamic zoom and audio fixed, for at least 30 seconds of
active driving. Inspect frame-time spikes, GC, and render submission separately.
The current five-second benchmark is insufficient for a robust periodic-stall
comparison. Do not claim a measured FPS improvement until a matched capture
exists.

### Meadow bitmap tile uploads

Meadow road, terrain and bridge bitmap layers queue missing textures through
one post-render scheduler, uploading at most one tile per display frame. Tiles
intersecting the current render window have priority; each layer may retain up
to eight camera-forward prefetched tiles within the existing 48-texture limit.
The existing vector road and terrain rendering remains underneath as the
fallback while bitmap tiles are pending or when the viewport exceeds the tile
budget. This bounds texture uploads and memory but does **not** guarantee that
the initial camera area is fully textured before the countdown starts, nor
does it establish a performance improvement. Verify startup readiness, camera
movement and equivalent before/after captures on the target device before
making either claim.

### Startup readiness and frame-budgeted bitmap streaming

The race scene prepares the initial player camera's padded bitmap window
synchronously during scene creation, before its first rendered countdown frame.
Only current-window tiles are warmed; forward prefetch remains deferred. This
can increase Start-to-countdown latency on a cold track, so measure that metric
alongside driving frame intervals. The vector overview remains the intentional
fallback when a window exceeds the texture cap. No simulation clock or nearby
countdown protocol is changed.

During driving, canvas painting and GPU registration run on separate display
frames. The scheduler checks elapsed CPU frame time at post-render against
the observed frame interval (capped at the 60 Hz interval) with 3 ms reserved.
This is an admission budget, not a hard deadline: individual canvas painting
and GPU registration cannot be preempted, and a persistently overloaded device
may defer work until a frame has room. Current-window work outranks prefetch.
The original 48 GPU texture cap remains strict. Offscreen GPU textures are retained until the existing 48-tile-per-layer cap
requires eviction; CPU canvas caches remain bounded separately. No eager
retirement during spare frames. Static road culling
is unchanged while bitmap selection refreshes on quantized heading and tile
window changes. The editor skips tile enumeration when its grid is unchanged.

Compare the same Papou track, lighting, car and device for 30–60 seconds of
active driving, cold and warm, including turns. Record p95/p99 frame intervals,
spikes over 33/50 ms, startup latency and Android memory pressure. The component
tests establish scheduling behavior, not a measured device improvement.

To benchmark one specific exported track in the browser, set
`TRACKFORGE_RACE_PERF_TRACK` to its path. The test imports it and records cold
and warm runs in daytime, using the imported track name:

```sh
TRACKFORGE_RACE_PERF_TRACK=/path/to/Nj.trackforge.json npm run qa:mobile -- race-performance
```


## Editor point-drag invalidation

Large authored terrain is static during a live point move: keep its previous
mesh and raster, update road geometry through the frame loop, and rebuild the
road-conditioned terrain once on release. A cancelled drag restores the
original road and can reuse the unchanged terrain. Terrain/environment/lighting
changes still invalidate the terrain. Diagnostics and selection panels refresh
at gesture end, rather than reconstructing DOM for intermediate coordinates.
The road raster is not captured every drag frame. This is an editor-only
presentation optimization; committed geometry, recovery, undo and saving are
unchanged. Elevation-dependent terrain shading catches up when the drag ends.

Run the editor-specific diagnostic against a private exported track without
committing that track to the repository:

```sh
TRACKFORGE_EDITOR_PERF_TRACK=/path/to/Nj.trackforge.json npm run qa:mobile -- editor-drag-performance.spec.mjs
```

Use `TRACKFORGE_PERFORMANCE_QA=1` instead for a synthetic 18,268-cell fixture.
The report records idle, 24 live pointer moves, and release separately, with
frame intervals and terrain/world/geometry/DOM call counts and CPU timings.
Compare identical browser/device/viewport/track runs before and after changes;
there are no wall-clock CI assertions. The existing road-edit browser test
checks actual terrain redraw counts independently of timing.

## Papou daytime stutter — 98-second capture

10,569 frame intervals: median 8.3 ms, p95 8.4 ms, p99 33.4 ms,
89 intervals above 50 ms and 22 above 100 ms; worst 308.2 ms. The worst
stall follows a frame with only 13.7 ms of measured update + render submission.
The largest stalls cluster in seconds 5–20, beyond the default five-second
smoke benchmark. The cause is not established by the current CPU timings.
The streaming scheduler previously retired textures above eight unused tiles
even when below its existing hard cap, forcing unnecessary recreation on return.
Retain them until actual capacity pressure. GPU and CPU limits are unchanged;
average resident memory may increase. New replay diagnostics attribute deferred
canvas painting and texture registration (including capacity-driven eviction)
to the preceding rendered frame. Measure the following frame interval and
compare both laps on the same device; GPU completion remains unmeasured.

## NJ race: eliminate runtime material streaming

Android build 1827.1 captured 24,540 frame intervals over 367.9 seconds.
Fully resident terrain: median 8.4 ms; partially resident: 16.7 ms; no visible
terrain texture despite pending tiles: 24.9 ms (4,311 frames). A terrain upload
lasted 85.9 ms, immediately before a 100 ms interval. The streaming scheduler
requires spare CPU time; expensive vector fallback draws starve it, so missing
textures can persist. The race now bakes immutable sparse road, terrain and
bridge tiles into atlas pages before gameplay. Only sprite selection changes
as the camera moves. Remove duplicate terrain fill/ripple/slope/plateau/shore
vectors when the complete bitmap atlas exists; retain projected hill shadows,
road shoulders and markings, bridge structures and vehicle depth ordering.
The 128 MiB RGBA page allocation budget includes gutters and page padding;
normal circuits retain native resolution and larger maps get a uniform
budgeted resolution rather than missing artwork. CPU canvas backing and GPU
copies can each consume memory; startup cost increases. Editor rendering is
unchanged. Verify on Android before claiming frame-time improvement.
