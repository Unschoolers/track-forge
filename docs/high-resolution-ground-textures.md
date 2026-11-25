# High-resolution base ground textures

All four base-ground materials now use separate generated 256 × 256 WebP
swatches rather than the 48–96px ground cells in the original material
atlases. The source art is regenerated at higher resolution, not upscaled.
Opposite edge bands are blended offline to reduce wrapping seams. The
four compressed assets total 132,302 bytes.

The bitmap painter maps the full source to one existing 256-world-unit
tile instead of stamping four identical 128-unit subtiles. This preserves
native baked resolution, doubles the repeat distance and keeps existing
padding and the eight cached tile variants. Meadow decorative patches
remain intact. Day/night is still derived once at startup using the same
lighting treatment, including the new already-blue carpet. Cityscape's
raised cobblestone plateau reuses its new ground swatch; the Kids' Room
bank uses the existing tint operation on the new carpet.

Road, water and dedicated elevation swatches, prop assets, physics,
track formats and GPU tile limits are unchanged. The separate organic
ground overlay work remains compatible with this painter. The goal is a
sharper base surface; it does not yet upgrade every other material.
Physical Android appearance and frame pacing remain release checks.
