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

Kids' Room uses ordinary road shoulders. Only existing apex curb segments
receive red/yellow molded plastic bricks with embossed studs. The shared
Phaser curb renderer preserves the original turn detection and footprint
in editor and race. No continuous brick border, changes to road material,
or extra bitmap cache layers. Bridge rails remain separate.
Physical Android visual validation remains necessary.
