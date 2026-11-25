# Visual polish: water, terrain, ground and bridges

Player screenshots show repeated low-resolution water, circular ground
color blobs, stepped hill and shore outlines, and flat bridge faces.

- Native 256px periodic water material, with environment-specific colors,
  multiscale wave grain and fine caustics, baked lazily per environment and
  lighting in the existing terrain tile painter. One source canvas per
  active art/lighting (256 KiB RGBA each), not one per world tile. No new
  GPU layers or per-frame generation. Existing water masks, islands,
  shoreline widths and harbor oil slicks remain.
- Graded, low-opacity rounded shoreline bands and hill contact shading
  soften the appearance of the grid. Hill interior bands are clipped to
  the existing elevation triangles. This intentionally does not round or
  relocate the physical contour; at close zoom the authored steps can
  still be visible. True geometric rounding needs separate consideration
  of visual/physical alignment.
- Replace the broad gradient ground blobs with deterministic clusters of
  fine texture marks, preserving the high-resolution base and the existing
  day/night patch placement. Meadow bitmap patches remain unchanged.
- Themed bridge fascias get inset highlight/shadow bands; deck rails get
  subtle contact shadow and depth, using the same vector and canvas
  commands and canonical geometry. No deck-height or occlusion changes.

Tests: periodic water wrap, theme colors and deterministic output;
bounded bridge fascia bands. Existing terrain and organic placement tests
remain relevant. CI and visual/device frame pacing review required.
Rollback is presentation-only; no track format or physical changes.
