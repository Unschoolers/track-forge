# Vehicle artwork contract

The four vehicles are the same gameplay cars. This is strictly a visual redesign:
no physics, collision bounds, car ratings, AI, replay format or multiplayer
protocol changes.

- `src/presentation/vehicleArtwork.ts` owns the four silhouette and paint-layer
  definitions, palettes and fixture locations. Blue is a low sports coupe, red
  a broad-shouldered muscle car, green a rally hatch, yellow an open-bed pickup.
- `src/phaser/rendering/vehicleRenderer.ts` paints those layers in the race,
  with existing landing, bridge, ghost, topper, shadow and light behavior.
- `src/ui/components/raceFlyoverRenderer.ts` paints the **same layers** through
  Canvas 2D in the race-setup flyover. The car picker uses the same polygons
  and colors through tiny inline SVGs. No separately redrawn preview art.
- Artwork data is built once at module initialization, not allocated per frame.
  New details should remain readable at small mobile zoom levels and bounded
  inside the existing visual envelope. Fixtures follow the forward (+X) nose.

## Check and rollback

Compare all four cars in the picker, day/night flyover, day/night race, nearby
race and elevated bridge segments. The truck bed and red/blue/green silhouettes
should remain distinct without color alone. Run focused component tests and
`npm run verify`; check mobile performance for drawing overhead. Roll back
this single visual PR if frame pacing or visibility regresses; no migration.
