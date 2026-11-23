# Race performance baseline

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
