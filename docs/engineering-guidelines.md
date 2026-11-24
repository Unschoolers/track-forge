# Engineering guidelines

The north star is **clear behavior, a maintainable change surface, and predictable performance**—not maximizing abstraction, code reuse, or coverage numbers.

## Design rules

1. **Single responsibility:** a module owns one coherent reason to change. An orchestration class may coordinate but should delegate domain decisions. Do not split a stable 30-line function merely to satisfy a length heuristic.
2. **Open/closed:** use focused policies or data tables when adding a car, terrain or race variation would otherwise create repeated branches. Avoid prematurely building a plugin architecture for one case.
3. **Liskov:** adapters must honor their declared port, including failure, cleanup and ordering semantics. No `throw` or silent fallback in a variant that another variant never performs without documenting it.
4. **Interface segregation:** prefer narrow, consumer-oriented ports (storage, feedback, random, input) to a giant context/service object.
5. **Dependency inversion:** domain behavior must not require Phaser, Android, DOM, time or global randomness. Wire implementations in `main.ts`; prefer constructor parameters to globals.
6. **DRY means one source of truth, not avoiding every repeated line.** Share rules, algorithms, protocol constants, and scenario builders; tolerate a little repeated setup when it makes two tests or modules independently legible.
7. **KISS/YAGNI:** extend existing code where possible. Every new abstraction has a concrete user and a deletion path. Never invent a framework in response to a one-off need.

## TypeScript and module boundaries

- Respect strict `tsconfig.json`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, and typed imports. Avoid `any`, non-null assertions, and `as` on untrusted input.
- Prefer readonly domain data, small discriminated unions and exhaustive switches. Name types by business meaning (`RaceOutcome`, `TrackValidationResult`) rather than transport details.
- Keep the source of each invariant singular: `domain/config.ts` / `vehiclePhysicsConfig.ts` for tuning, `trackCodec.ts` for format normalization, `raceWire.ts` for packet layout, `styles/tokens.css` for reusable color/style tokens.
- Avoid circular imports and imports from UI/Phaser/infrastructure into domain. Existing exceptions are **refactor candidates**, not precedent.
- Separate calculations from side effects. Derive state first; dispatch/save/play sound as deliberate outer operations.
- Keep public functions small enough to reveal their contract; use helper extraction when it improves cohesion or isolates edge cases, not to conceal complexity.

## Errors, data and safety

- **Never swallow errors to make CI or user-facing failures disappear.** Boundary code may catch malformed input only to return an explicit invalid result or safely skip a *documented* legacy record; include a diagnostic where appropriate.
- Parse external JSON as `unknown`; validate type, range, sizes and referential consistency before creating costly paths, textures or allocations.
- Persist through repositories and the codec; do not write storage keys ad hoc in UI/Phaser.
- Make failed save/import/export, unsupported native capability and disconnected nearby peer observable and recoverable. Do not report success before an operation finishes.
- Keep diagnostics helpful but bounded. Do not log private track payloads or player-identifying data in routine telemetry.
- Protocol and storage migrations need explicit backwards-compatibility cases and safe rejection paths.
- Treat timing, packet sequence and native callbacks as untrusted: tests should cover duplicate, stale, out-of-order and late events.

## Gameplay, editor and graphics

- Prefer stable, deterministic domain calculations. Keep the 60 Hz physics contract independent of draw FPS and QA speedup.
- AI balancing is a behavioral problem: measure distance/progress, time, recovery and lane safety across cars, difficulties, reverse routes and varied track shapes. A selected course may be a **calibration fixture**, but must never be a production condition: no `track.name`, `track.id`, course-identity hash or fixed segment-number branches deciding driving behavior. Do not tune only to a screenshot or track. See [architecture invariants](architecture.md#shared-invariants-to-protect).
- Car control and effects must preserve simultaneous touch gestures and cancel/release behavior. Validate both auto-accelerate and manual pedal controls.
- Editor tools should provide feedback, stable camera behavior, reversible gestures, and no surprising mutations. Reject invalid geometry rather than silently repairing creator intent.
- Use change-aware rendering and cached geometry, bounded caches, culling and explicit teardown. Do not allocate large meshes, rescan complete paths or regenerate stable textures every frame.
- Prefer existing presentation components and CSS tokens over per-dialog copies. Keep labels visible, touch targets generous, focus states clear, and safe-area constraints respected.
- Ensure visuals are aligned with physics (e.g. bridge transitions, height, shadows, landing feedback); rendering must not invent physics or vice versa.

## Performance and build discipline

- Profile before optimizing. Capture a repeatable baseline with the same track, lighting, car, input, platform and warm/cold setup; compare p50/p95/p99 when meaningful. Follow [race-performance.md](race-performance.md).
- Separate **runtime performance**, **test runtime**, **web build**, and **Android compile**. Optimizing one must not regress another.
- Prefer preventing redundant work (cache invalidation, targeted suites, no duplicate startup) before adding concurrency or reducing assertions.
- Never weaken correctness gates for a faster CI screenshot. Do not bake host-specific timing/FPS thresholds into flaky CI assertions.
- Avoid unconditional heavy browser tests for a contract a cheap component test can prove.

## Review questions

Before approving code, ask: Is there only one behavioral authority? Are invalid data and lifecycle edges handled? Is the implementation simpler than the change it replaces? Are its tests about player-visible contracts? Is the expensive work bounded? Does the PR describe risk and rollback?

For test-specific decisions use [testing-guidelines.md](testing-guidelines.md); for delivery checks use [change-workflow.md](change-workflow.md).
