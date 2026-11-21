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
