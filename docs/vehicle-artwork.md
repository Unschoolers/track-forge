# Vehicle artwork contract

The four vehicles are the same gameplay cars. This is strictly a visual redesign:
no physics, collision bounds, car ratings, AI, replay format or multiplayer
protocol changes. The shared race and flyover artwork renders at 88% of its
authored size. Existing light, shadow, topper and ghost geometry is retained.

- `src/assets/vehicles/` contains four individually generated, transparent,
  cropped WebP images (768 px wide, approximately 255 KiB combined). The blue
  coupe has silver shoulder swooshes rather than the red muscle car's center
  stripes. The rally hatch and open-bed pickup have distinct silhouettes.
- `src/presentation/vehicleBitmapArt.ts` owns the asset URLs, dimensions and
  local bounds; +X faces forward. The original body lengths are preserved,
  with heights derived from each image's aspect ratio. Startup validates and
  decodes all four assets once; failed loading is surfaced by the existing
  retry screen.
- `src/phaser/rendering/vehicleSpriteRenderer.ts` registers four shared GPU
  textures and reuses a scene-owned image pool. The race textures are
  downsampled to 96 px wide with smoothing at registration, so fine highlights
  and silhouettes hold up at race zoom. The four uploaded RGBA textures use
  about 71 KiB of base pixel data combined, down from 4.4 MiB. Bodies keep the same landing
  scale and bridge classification, with player-last ordering, shadows below
  and brake lights/topper/boost effects above. Scene teardown destroys images,
  not the reusable textures.
- The setup flyover and car picker use the same bitmap URLs and proportions.
  `vehicleArtwork.ts` retains the existing visual geometry for fixtures,
  covered-player outlines, translucent replay ghosts and pre-boot component
  tests. No generated textures or per-car canvas allocation in the render loop.

## Check and rollback

Compare all four cars in the picker, day/night flyover, day/night race, nearby
race and elevated bridge segments. Run focused component tests and
`npm run verify`; check physical Android frame pacing and lamp alignment.
The new images have natural proportions; Blue is slightly wider than the old
vector shape without affecting collision. Roll back this visual PR if pacing
or visibility regresses; no migration.
