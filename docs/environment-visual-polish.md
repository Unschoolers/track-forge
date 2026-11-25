# Visual polish: generated environment materials

The four locally bundled 512 × 512 alpha WebP atlases each contain four
256 × 256 cells: water, elevated material, transparent ground patch
and bridge structure. Source is the four separate user-supplied 1536 × 1536 environment sheets,
cropped to usable material regions, resized to the target resolution and
edge-blended offline for the opaque swatches. The ground patches have
irregular feathered alpha masks. All four files total 269,002 bytes.
Some source crops are smaller than 256 px; the final cells are 256 px,
not a claim that each original crop had 256 native pixels.

The shared loader validates dimensions and decodes day/night canvases
once. Generated artwork replaces the earlier procedural water and
gradient/particle ground overlays. Existing base ground and road artwork
remain untouched. Meadow retains its existing three smaller decorative
patches plus a new generated patch; Desert and City Port place six
instances of their themed transparent patch. Kids’ Room places two smaller
woven star motifs to avoid clutter. All use stable scale, rotation and
placement and matching day/night geometry. No new collision objects.

Graded shoreline bands and contact shadows soften the visible terrain
edges. The opaque water and hill footprints remain aligned with canonical
physics geometry; the authored staircase contours can still be visible.
Island holes and harbor oil slicks remain. True geometric rounding is
outside this pass.

Bridge materials use the canonical road quad: textured timber (Meadow and Desert),
steel (City Port), or toy timber (Kids’ Room) shoulders, with a subtle material glaze on standard
elevated decks only. Mud and ice retain their original road material.
Existing fascia relief, rail highlights, markings, ramps, shadows and
occlusion remain. The shared bitmap tiles render in editor, race and
flyover. Extreme overview retains existing vector fallback.

Cache counts and GPU layers are unchanged. The larger decoded source
canvases use extra CPU memory; physical Android startup and frame pacing
require measurement. Tests cover atlas dimensions, deterministic patch
placement, actual bitmap draws and bounded fascia bands. No physics,
AI, save data, terrain height or hazard footprint changes. Rollback is
presentation-only.

The supplied Kids’ Room reference replaces berry-colored liquid and quilt
with blue toy-pool water and colorful interlocking foam-mat material.
The final cleaner Kids’ Room sheet has no floating toys in the water;
its woven yellow star is extracted with transparent alpha and the wooden
bridge cell excludes the surrounding background. Bitmap and vector
fallback palettes follow that art direction; the original royal-blue
carpet, road materials, LEGO-style shoulders and authored toys stay intact.
Crops avoid large baked objects where practical; the artwork is decorative,
not collision geometry. The source composition of cliffs and puzzle mats is
not reconstructed as new terrain geometry in this pass.
