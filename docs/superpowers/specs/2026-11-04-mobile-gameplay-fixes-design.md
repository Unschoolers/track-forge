# Mobile gameplay fixes
User approved implementation of the six ranked gameplay points and committing the verified result to main on 2026-11-04. The accepted steering direction is floating horizontal thumb steering with an explicit separate brake.

## Global Constraints
- Keep Phaser 4, TypeScript 7, Capacitor 8.6.0 and the existing dependencies; add no packages.
- Preserve saved tracks, preferences, score formats, application origin and Android signing/distribution configuration.
- Keep automatic acceleration and keyboard driving. Brake cuts drive torque.
- A touch begins at neutral; relative horizontal motion steers with a small dead zone and visible feedback. A separate brake touch must work concurrently.
- Touch cancellation, capture loss, focus loss and scene transitions must release controls safely.
- Preserve direction-aware lap gates/rankings and safe forward/reverse recovery.
- Completed opponents retain finish times/results without blocking or damaging racers still driving.
- Use meaningful regression tests for the reported bugs. Do not weaken unrelated tests.
- Work only in this isolated branch, commit each task, and do not push; the coordinator publishes to main after review.

## Accepted scope
1. Replace fixed absolute-position mobile steering with a relative horizontal gesture, share the normalization between DOM/canvas as appropriate, update the visible knob and handle pointer ownership. Start with a 48 CSS-pixel full-lock distance and 0.08 dead zone; these are initial tuning values for phone feedback. Extra steering fingers must not implicitly brake; handoff/release must be deterministic. Add touch-action protection to the controls without disabling modal scrolling.
2. Intentional braking must not count as being stuck or cause an automatic reset. Genuine stuck recovery must still work.
3. Road selection at a crossing must retain the compatible route/height. Cars below an overpass stay below; deck cars stay on the deck. Ramps, off-road recovery, water and reverse races must remain valid.
4. AI emergency braking/following must use traffic actually blocking the route, accounting for lateral/height separation. Keep nearby nonblocking cars available to overtaking decisions.
5. Finished opponents cease participating in collision/traffic blocking and are cleared visually from the active race. Keep their recorded results.
6. Add an accessible mobile RECOVER action using the existing manual-reset behavior, available only during active unpaused racing, including keyboard/touch parity. Fit small portrait and landscape screens and keep steering/braking reachable.

7. Additional user request: the Android APK runs in immersive fullscreen, restoring hidden system bars on resume/focus and retaining temporary edge-swipe navigation. Preserve safe areas, text input and existing pause lifecycle behavior; use existing AndroidX APIs and keep orientation unrestricted.

## Decisions
No new time penalty, powerup system, control-selector screen, persistence format or broad physics retuning in this patch. Manual recovery retains current R-key semantics while refusing inactive/paused/finished races. Future handling and lap-target experiments need phone feedback after the six fixes. This accepted scope executes directly; no additional approval is needed for the already requested main commit.
