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
first five seconds after **GO**. Reload the app before each run, open Race Setup,
and wait for its flyover to appear before pressing **Start Race**. Record three
runs per scenario and compare medians of the reported values.

## Physical Android debug APK

Build an instrumented debug APK locally using the Android prerequisites in the
[README](../README.md).

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
`location.reload()` between runs to retain the benchmark query.

## Mobile Chromium smoke test

Use the existing mobile browser harness to capture the same JSON with the Pixel 7
emulation in an 844 × 390 viewport. The default run uses Starter Circuit.

```sh
npm ci
npm install --no-save --package-lock=false @playwright/test@1.64.1
npx playwright install chromium
npm run qa:mobile -- race-performance
```

For all four scenarios, place the exports in a local directory with filenames
`City-Harbor.trackforge.json`, `Rally.trackforge.json` and
`Sandy-Beach.trackforge.json`. Keep the Track Forge track names from the table.

```sh
TRACKFORGE_RACE_PERF_TRACKS=/path/to/exports npm run qa:mobile -- race-performance
```

Open `race-performance.json` in the Playwright test attachments. The smoke
test checks the report and records timing for diagnosis. Use the physical
device runs to compare against the frame time targets.

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
For a 60 Hz device, aim for frame p95 below 20 ms and frame p99 below 33 ms.
