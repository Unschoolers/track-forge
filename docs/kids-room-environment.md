# Kids' Room environment

## Contract

Kids' Room is a visual environment ID, not a new road or terrain physics mode.

- **Ground:** royal-blue carpet with deterministic, pre-baked woven yarn loops, shaded pile and cross-weave. The editor, race and flyover use the same ground tiles, blue palette and existing maximum tile budgets.
- **Scenery:** six placeable toys (alphabet blocks, teddy bear, crayons, picture book, dinosaur, spinning top) using the existing scenery codec, selection, collision and culling pipelines.
- **Hills:** raised blue carpet folds with deeper navy slope shading using the existing slope and plateau mesh. Their authored height and road grade remain unchanged.
- **Water:** orange spilled juice with amber highlights, a wet edge and the existing water hazard/recovery rules. Saved terrain cells still use the normal water terrain kind; no schema migration.
- **Road skins:** street has stitched toy-road-mat seams; dirt shows cardboard fibers and panel seams; ice has directional shiny molded-plastic reflections. Decorative marks anchor to world path distance, not the camera or culling chunks, and use the same pure stroke generator for Phaser and flyover. Only color/marking materials change; speed, grip and AI still read the original physics.

The editor, race and flyover must present the same palette and the same deterministic toy silhouettes. Existing grass, city and desert styles are unchanged.

## Compatibility and rollback

Environment normalization accepts kids-room and continues to return grass for unknown or absent IDs. The standard track import/export codec preserves the new theme and toy prop kinds with no version bump. Older installations that cannot recognize this environment fall back to their known default until updated; avoid editing a Kids' Room track in an old client.

The implementation is additive. Reverting the feature restores previous styling without touching track geometry or racing records.

## Verification

Run the focused Kids' Room component tests, then the JavaScript gates:

- npm test -- tests/phaser/kidsRoomEnvironment.test.ts
- npm test
- npm run typecheck
- npm run lint
- npm run build

Visually compare editor, flyover and race at day/night, on both an empty carpet and a representative track with every toy, hills, juice, bridges and all three road surfaces. Check imported/exported tracks, 256-prop limit, scenery hitboxes, lane/checkpoint visibility, narrow mobile viewport, and large-track FPS before release.
