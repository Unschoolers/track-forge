# TrackForge priority fixes and downloadable Android builds
Date: 2026-11-03

## Intent and authorization
Julien requested fixes for the five audited bugs, using a separate subagent for each, executed one by one, then merging into main and producing downloadable APKs for each successful build. This request authorizes implementation, branch pushes, the PR/merge, and CI artifact creation.

## Approach
Keep the existing Phaser 4 / TypeScript / Vite game and fix the existing behavior in place. Add a small Capacitor Android wrapper around the same production assets; do not migrate engines or rewrite the game. Alternatives were a custom Android WebView wrapper (more lifecycle/build code) and a native rewrite (unnecessary scope). Capacitor matches the prior APK work and keeps web and Android on the same source.

## Required behavior
- Pending edits survive track navigation, rename, creation, and normal page/app teardown. Flush the latest draft before reading or replacing it; an explicit deletion must stay deleted. Report actual save failures rather than claiming success.
- Results -> Edit Track closes the results overlay and opens an interactive editor. Existing retry/home routes continue working.
- Reverse races face and travel in the selected direction: grid placement, AI pursuit/traffic, recovery and camera direction all agree. Keep authored road grade canonical.
- Race time and physics consume ordinary frame deltas at 10/20/30/60/120 Hz using bounded fixed substeps and carried remainder. Countdown overflow is preserved, pause/restart do not retain stale accumulated time, and terminal results/scores are emitted once.
- Rankings use race-relative progress, including the initial grid behind the line, relocated starts and reverse races. Preserve finish ordering and deterministic ties.
- Every successful push/PR build produces an installable Android debug APK as a named GitHub Actions artifact with a direct artifact link in the run summary. Run verification before packaging. Support manual dispatch and document download/install instructions.
- Provide a tested APK for this change. Preserve the prior Android application ID/signing identity where recoverable, otherwise document the actual identity and installation limitation clearly. Do not commit signing secrets. Use increasing Android version codes in CI.

## Global Constraints
- Execute the five bug fixes sequentially with a separate implementer subagent per bug and focused independent review before moving on.
- Keep Phaser 4, TypeScript and Vite; no game engine migration or unrelated feature work.
- Add meaningful failing regression tests before behavior changes; never weaken existing tests to hide a regression.
- Do not commit generated dist output, dependencies, local Android SDK/JDK paths, APKs, or private signing keys.
- Merge only after the complete test suite, typecheck, lint, production build, and Android CI succeed.
- Keep existing saved track formats and browser behavior compatible.

## Validation
Start from audited main 7eaed090c3f1829870bbce291573cb7827b3e7c7 (271 tests, typecheck, lint, build pass). Each task records red/green evidence, then runs the full suite once before committing. Android validation checks the packaged assets, application ID, version, signature, and GitHub artifact.
