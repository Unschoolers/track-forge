# Night lighting presentation

The flyover is the visual reference for gameplay. Both already render night-tinted
terrain, environment tiles, scenery and roads. A fullscreen 66%-black race-only
shade darkened these assets **again**, including cars and checkpoints.

## Rendering contract

- **No global shade in a night race.** Use existing night palettes. Night must
  remain visibly darker than day without making the road or opponents illegible.
- **Exactly one soft cone per visible racing car.** The shared, lazily created
  canvas raster in `src/presentation/nightLighting.ts` is used by the flyover
  directly and by the Phaser race through a single cached texture and pooled image
  per car. Fixtures and brake lights are separate small highlights, not cones.
- **No new per-frame gradient, mesh, canvas or texture creation.** Phaser images
  are reused across frames and hidden when a car leaves the visible set. The
  existing lamp culling and path geometry cache remain in place.
- **Race exposure tuning only.** The flyover's shared headlight bitmap is left
  unchanged; the race's additive sprites receive reduced alpha and scale once
  when created, with a scaled source offset to keep the lamps aligned through
  turns. Small car-fixture and roadside halos are subdued separately.
- **Physics and data stay unchanged.** No track schema changes or changes to
  AI, collision, controls, multiplayer wire protocol or race timing.

## Validation and rollback

Check City Harbor at night with four cars, comparing the five-second flyover
against a real race at the same location. Verify road and opponents are legible,
one beam follows each car under turns, no ghost cones remain after finished cars
disappear, and day mode is unchanged. Run the contract tests and compare the
first-run and warm-run race performance on the same device as described in
[race-performance.md](race-performance.md). A reduced draw-command count is not
a measured GPU/FPS result. Revert the single lighting PR if device performance
regresses; no track migration is needed.

## P1: WebGL race lamp submission and atlas batching

The race uses one cached 416 × 256 additive glow atlas with separate tightly
fitted road and fixture frames for ordinary and bridge lamps. Two sprites per
lamp replace five translucent vector circles; each lamp has independent padded
visibility bounds. The Canvas renderer retains the original vector batches.
Existing headlight/vehicle fixture rendering, night exposure, depth order and
texture density settings are unchanged. The atlas lives for the texture
manager's lifetime; the scene owns the sprites. Same-depth race material tiles
are grouped by texture page within their existing layer (no cross-depth sort).

Face 2 ecaF night capture, build 2063.1, is the motivating baseline: render
submission averaged about 5.4 ms with 7.9 ms p95. This change targets vector
submission, overlapping halo passes and avoidable texture-page alternation.
Actual draw-call counts and GPU/frame-time gains are unverified. The lamp
batch diagnostic now counts individual visible WebGL glow groups rather than
eight-lamp vector chunks; do not compare that counter directly across builds.
Compare equivalent day/night captures, including bridge occlusion and lighting
appearance; revert this PR if appearance or performance regresses.
