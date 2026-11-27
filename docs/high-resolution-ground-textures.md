# High-resolution base ground textures

Meadow, Desert, Cityscape and Kids' Room now use the four generated
1024 × 1024 WebP base swatches. Each source was resized from its native
1254 × 1254 art, and opposite edge bands were feathered before encoding.
The four compressed assets total 1,660,788 bytes.

World tiles are still 256 × 256 units. A shared full-resolution base
is drawn below the existing transparent decorative variants, giving four
texels per world unit without baking eight copies of each HD texture.
The editor, race and Canvas flyover share this layout; race preparation
registers the base alongside the existing decorative variant cache.
The existing visible tile budget and overview fallback are unchanged.
The base uses a second pooled sprite per visible tile in Phaser.

Day and night artwork is still decoded and prepared at startup. Each
1024² RGBA base occupies 4 MiB before GPU overhead; eight day/night
bases together are 32 MiB in CPU canvases, plus GPU copies as used.
The existing 256px material swatch is derived from the HD image to
preserve the world repeat scale on elevated ground and shoreline.
The existing procedural/bitmap decorations and fallback are retained.

Low graphics quality uses the derived 256px base composited with the
existing decorative variants in the original padded tile cache. It does
not register or draw the HD base; Medium and High use the 1024px pass.
The same choice is used in the editor, race, prewarm and flyover.
HD CPU canvases remain eagerly prepared at startup; GPU textures from
previous HD sessions may remain cached until the game is destroyed.

This slice changes base ground only, not road resolution, props,
terrain physics or track formats.
Physical Android frame pacing, startup memory and visual seam checks
are required before merging. Lazy loading and cache eviction are follow-ups if needed.
