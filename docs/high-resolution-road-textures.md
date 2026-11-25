# High-resolution themed road materials

Four locally bundled 768 × 256 WebP atlases provide three individually
cropped 256 × 256 surfaces each: standard street, mud (the existing dirt
surface ID), and ice. Meadow and Desert standard asphalt use independently
generated unmarked art; the remaining cells derive from the matching
environment's generated panels. Lane paint, scenery and toy borders were
removed by cropping/feathering. Kids' Room textures are oriented along the
road tangent. Opposite edge bands are blended offline. Compressed source
size is 212,152 bytes.

Each surface retains the existing three longitudinal variants and
canonical path-distance phase. The day strip is generated once and
night derives from the finished strip. Road paint, bridges and the
48-tile bitmap cache remain geometry driven. The higher-resolution
source canvases do use more decoded memory; actual device validation
is necessary. The physical surfaces, steering, AI, authored tracks
and terrain swatches are unchanged.

Kids' Room road shoulders use independent, distance-anchored red,
yellow and blue plastic brick fragments and small embossed studs on
the actual ribbon edge. The bitmap painter caches them together with
the road, so editor, race and flyover share the appearance without a
new GPU layer. Ordinary apex curbs keep their shape and contrasting
colors, now red/yellow for the toy environment. At extreme zoom the
existing inexpensive vector fallback remains; bridge decks use their
existing themed rails rather than the shoulder studs. Visual quality
and frame pacing on physical Android remain release checks.
