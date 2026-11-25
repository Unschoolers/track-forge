# Environment materials — Grass, Desert and Cityscape

## Design intent

Each environment should be identifiable from its material treatment at **driving zoom**, not only from props or a background color. This is presentation only; authored points, surfaces, grip, acceleration, AI, terrain elevations, water hazards and saved-track versions are unchanged.

| Setting | Ground | Road materials | Terrain treatment |
| --- | --- | --- | --- |
| Grass | Layered meadow patches, short green blades and occasional seed heads | Asphalt aggregate/repairs, wheel-rutted dirt, icy scuffs | Green earth mounds and natural water |
| Desert | Dune nap, paired wind ripples and coarse sand grains | Dusty heat-weathered asphalt, wind-rippled sand, pale slick salt/ice | Sandstone slopes and turquoise oasis with sand-colored shoreline |
| Cityscape | Concrete slab seams, side-lit bevels, fine aggregate and chips | Tar repairs, construction gravel, reflective frozen pavement | Concrete embankments and blue-gray canal water |
| Kids' Room | Royal-blue woven carpet | Toy-road stitches, cardboard fibers, glossy plastic | Carpet folds and spilled juice |

## One visual authority

- Use `getTrackEnvironment(id)` for ground palettes, deterministic tile art, terrain colors and props.
- `roadColorsForEnvironment(id)` supplies visual road colors without modifying the authoritative `SURFACE_SPECS` physics records.
- `environmentRoadStrokes()` is the single source of distance-anchored road markings shared by Phaser editor/race rendering and Canvas flyover. The previous `kidsRoomRoadStrokes()` implementation remains the Kids' Room specialization.
- `createGroundTileRandom(variant, salt)` generates repeatable world-tile grain. Material tiles are baked once per environment, lighting and variant, rather than generated on every rendered frame.
- Editor, race and flyover use the same base ground color. Preview/flyover retains its simplified hill rectangles; the race uses the authoritative terrain mesh and shading.

## Performance and compatibility

- Do not allocate material textures or strokes during physics steps or editor pointer movement.
- Keep 256-world-unit ground tiles, eight shared cached variants and day/night materials. Compact/mobile windows retain the 64-visible-tile limit. Desktop-size viewports (at least 1 megapixel) can draw up to 768 **reused sprites** to keep grass/sand/concrete/carpet visible from HD through 5K; this does not create 768 new canvas textures.
- The conservative tile budget uses the largest *rotated* bounding rectangle rather than the diagonal squared. This keeps the material visible when driving, panning and rotating, and only falls back to the base terrain color at extreme overview scales (such as 8K full screen or zooming far out in the editor). Physics and race-camera zoom are unchanged. Validate frame pacing on low-end desktop GPUs before expanding the limit further.
- Road mesh preserves the painter order across direct and batched renderers: edge, road fill, then subtle detail. Large tracks are capped at 64 ribbon batches with independently culled material layers.
- The flyover precomputes the decorative road strokes once per preview session and only paints visible sections per frame.
- Marks are sparse and limited to 32 repeat intervals per segment, including malformed/degenerate segment handling. They stay within road width.
- No schema migration, texture asset downloads, new gameplay properties or extra per-frame physics operations.

## Verification

Automated: `tests/phaser/environmentMaterials.test.ts`, `tests/phaser/raceRoadRibbonCulling.test.ts`, `tests/phaser/environmentPresentation.test.ts`, and `tests/ui/raceFlyoverRenderer.test.ts`.

Manual/device review: race, editor, and flyover for all three environments by day and night, both zoomed in and out, and representative large tracks. Check especially tiled-ground seams, corners/intersections, overpasses, road-surface readability, screen contrast, night light visibility and Android frame pacing. A green browser CI run alone does not certify physical Android GPU frame time.

Rollback: revert the presentation changes. Serialized tracks and physics need no conversion.

## Meadow visual proof of concept (2026-11-24)

The first three presentation phases are deliberately independent of the domain:

1. **Repeatable materials**: the existing baked grass canvas tile and bounded
   cache remain the base. Meadow's road material is a 192-unit procedural
   vector tile (eight 24-unit cells), mapped into along/across-road space.
   Closed circuits fit an integral number of repeats; lane markings and
   curbs remain separate. No new GPU texture or rasterization per frame.
2. **Organic groundcover**: automatically compose low vegetation, wildflower
   clusters, moss and exposed soil from deterministic padded-tile art.
   Decorative patches are not obstacles, road surfaces or save-file entries.
   Solid trees and manually placed props retain their current authoring and
   physics. This avoids visually misleading newly generated collision hazards.
3. **Water transitions**: four nested sand/damp-bank/contact-highlight bands
   share the actual water contours. The flyover uses the same contour rings
   and even-odd water fill, including islands. Bounds include the wider bank.
   The centerline still marks the physical water boundary.

The current implementation is procedural vector art, not the generated concept
sheet or an imported bitmap atlas. Meadow is the reference environment; the
other three supported themes preserve their existing materials. A separate
Beach environment is not introduced. Visual approval at driving zoom, day
and night, and Android frame pacing remain release verification requirements.
Rollback is a presentation-only revert; no serialized track changes.
