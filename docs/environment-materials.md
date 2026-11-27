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

## Race material fidelity

Base ground swatches are already baked at 256 pixels per 256 world units.
Race-only sparse road, water, elevation and bridge tiles are baked directly at
their final atlas resolution (up to 510 pixels per 256 world units) within the
existing 128 MiB page budget, including gutters. Large tracks may still use a
lower resolution to stay within that cap. Editor and flyover retain their
existing native tile cache. No texture baking or eviction occurs while driving.
Race diagnostics record canvas backing dimensions, CSS dimensions and device
pixel ratio to distinguish source detail from display upscaling. High-DPI
canvas changes require separate camera, input and physical GPU validation.

## Race prop occlusion

Tree canopies and Cityscape house/building bodies use the tall-scenery depth above ground-level cars. Their contact/projected shadows, rocks, shrubs and other props retain the original ground layers. The existing bridge deck and elevated vehicle layers remain above this layer; this is a coarse presentation ordering, not new collision or per-prop height physics. Editor and flyover ordering are unchanged. Static tree GPU batches and cached scenery windows remain in use.

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

### Generated bitmap integration

The Meadow art now uses two locally bundled WebP atlases derived from the
generated concept artwork: a 192×192 atlas of four 96×96 materials and a
128×128 atlas of four 64×64 alpha sprites (mud, flowers, low shrub cluster,
overhead pine). These are intentionally small first-pass mobile assets, not
the final 512px production master. The source swatches were cropped without
lane paint, periodically blended at opposing edges, and compressed. Mud and
flowers have feathered alpha; shrubs and tree use the overhead sprite art.
Boot decodes both atlases before scene creation. A load or dimension error
reaches the existing retry screen instead of silently disabling the art.

The base texture repeats with identical phase across ground tiles, with
seeded transparent patch placements. Authored trees retain their existing
footprints and shadows. Road material sprites use canonical ribbon quads
and local along/across-road repeating patterns; markings remain on a
separate layer. Sand and foam bitmap bands are tinted from the dirt and ice
swatches and clipped to the existing water boundary stroke. Editor, race
and flyover use the same bitmap tile painter. Each bitmap layer has a
48-tile canvas cache and no more than 48 live GPU tiles, explicitly removed
when no longer visible or when scenes close. Extreme zoom/over-budget
views and live editor drawing gestures keep the established vector material
fallback. Large editor tracks retain raster caching with separate base and
decoration captures to preserve depth order.

Meadow is the reference environment; the other three supported themes
preserve their existing materials. A separate Beach environment is not
introduced. Individual scenery props beyond the authored pine remain vector.
Visual approval at driving zoom, day and night, and physical Android frame
pacing remain release verification requirements. Rollback is a
presentation-only revert; no serialized track changes.


### Layered water and mountain materials

Meadow now bundles a third generated bitmap atlas, `terrain.webp` (128×64,
two 64px repeatable swatches of painted water and mossy rock). The existing
bitmap cache renders water and hills together, not as additional GPU layers.
Sand is painted first; the opaque water material covers its inner half.
A deep navy translucent glaze and progressively brighter turquoise bands
(32, 21 and 11 world units inside the boundary) are clipped to the original
water components. A narrow contact highlight is also inside the water.
Land islands are not filled by the water mask. Narrow channels naturally
read as shallow water. These depths are visual, not new terrain levels.

Rocky slopes use the existing directional facet shading, with grass on
plateaus and the existing terrain shadow below. Water, hills and roads
retain their authored boundaries, elevation, recovery behavior and saves.
The existing vector overview and live-edit fallback remain available.
The other environments keep their current palette and textures until
they receive their own art passes. Day/night, in-game art approval and
physical Android frame pacing require verification.


### Desert visual identity

Desert is the second bitmap environment. The existing renderer consumes a
shared material contract and a data-driven terrain tint profile, rather than
assuming all slopes are mossy rock or all banks are green. A six-cell
144×96 WebP atlas (48px cells) is cropped from the generated Desert Canyon
concept sheet, seam-blended and locally bundled: stony sand, unmarked
asphalt, compacted dirt, ice, turquoise oasis water and softened dune sand.
The same dune swatch covers slope and plateau; warm directional shading
creates relief without introducing a rock cliff. Day/night water has a
deep blue core, luminous oasis shallows and warm sand banks. Road paint
remains geometry-driven. Existing authored cactus and rock props are
unchanged. Cityscape and Kids' Room retain their current art until their
own passes; this PR changes no terrain mechanics or track formats.


### Cityscape visual identity

Cityscape uses its own generated 144×96 WebP atlas: cobblestones,
weathered asphalt with fine branching cracks, dusty construction dirt,
ice, harbor water and mossy quay masonry. The cracks are baked inside the
road swatch, away from its edges, so they add age without changing grip or
interfering with procedural lane paint. Elevated terrain looks like raised
stone plazas rather than natural hills. Harbor banks use masonry, with
muted blue-green depth bands. Deterministic translucent black oil slicks
have faint iridescent fringes and overlap world-tile boundaries consistently;
the existing water clip keeps them off land. No new physical surfaces,
hazards, serialized data or GPU layers are introduced. Authored city props
are unchanged. Kids' Room remains the next separate art pass.


### Kids' Room visual identity

The fourth environment uses the generated Cozy Carpet World concept.
A seam-blended six-cell 144×96 WebP atlas supplies carpet pile, navy
woven road, textured dirt, shiny ice, berry juice (recolored from the
painted water swatch), and red plaid comforter fabric. The generated pile
is colorized once to preserve the existing royal-blue carpet identity.
Hills use the comforter material for both sides and top, with the existing
terrain gradient supplying fabric-fold shading. Juice uses a tinted carpet
stain rather than sand, narrow translucent liquid shelves and a glossy
contact edge. The vector overview palette is updated to the same identity.
No terrain or collision rules change, and authored toys remain intact.
All four current environments now use the same bitmap material interface.


### Elevation-specific bitmap materials

The bitmap material contract now owns a contiguous elevation material
table starting at level 0. Each entry supplies a plateau texture, a slope
texture (for the transition up to that level), directional shade colors
and strengths, and a plateau glaze. All four environments currently
author exactly two entries: normal ground and the first elevated terrain.
Their existing day/night art and colors are preserved. The material
selector intentionally reuses the highest authored entry if future
geometry requests a higher level. Invalid nominal heights are rejected.
Water, groundcover and roads are independent materials.

Ground tiles select level 0. Terrain bitmap faces derive their integer
level from the canonical mesh primitive's nominal top height divided by
the existing level height (not from individual ramp samples). The tile
painter groups faces by actual level, then draws low to high with each
level's slope shading and plateau material. The bounded tile cache and
vector overview fallback are unchanged. The latter still supports only
the existing two physical levels; extending vector rendering, editor
commands, terrain storage, surface meshes and physics for additional
levels is deliberately out of scope. No new height is authorable or
persisted by this change.

### Organic ground variation across environments

The other three bitmap environments now use the Meadow layering principle:
a seamless base texture with broad, feathered, irregular tonal patches
and small themed surface details. Desert has sand nap, gravel and dry
grass; Cityscape has worn pavement, hairline cracks and moss; Kids' Room
has carpet nap, faint stains and lint. Six bounded patches per tile are
seeded by the existing tile variant. Day/night share the exact same
placement geometry with different colors. The edge of every tile retains
the original base bitmap phase to avoid visible seams. Meadow's existing
generated patch art is unchanged.

The shared ground bitmap painter bakes the overlays into the existing
eight cached tile variants per environment and lighting, not a new layer
or live scenery. Editor, race and flyover share this painter. No extra GPU
textures beyond the existing tile budget, collision objects, physics
changes or save data. The underlying swatches are reused; the procedural
color overlays provide broad variation without new asset downloads.
Physical-device art and frame-pacing review remains required.


### Road texture variation

All four environments bake three longitudinal variants from each of their
street, dirt and ice swatches at boot. Mirroring, periodic offsets and a
quieter blended variant preserve material direction and palette while
breaking the prominent repeating features. Smooth joins also blend the
last variant into the first. A full strip repeats roughly every 288 world
units rather than 96; closed circuits fit an integral number of strips.
The canonical path distance anchors the same pattern in editor, flyover
and race. Existing lane paint, curbs, terrain textures, physical surfaces
and the 48-tile cache budget stay unchanged. These are derived variants,
not new independent paintings; visual approval at driving zoom remains
required.

### Generated scenery sprites

A single locally bundled 256×320 alpha WebP atlas (27,990 bytes) contains
19 independently generated props in 64px cells, with one unused cell.
The original high-resolution AI art is cropped to each silhouette, scaled
proportionally, centered with transparent padding, and compressed for
mobile use. Every existing scenery kind has an explicit atlas index:
four Meadow props, four Desert props, four Cityscape props, six Kids'
Room toys and the shared tree. Boot validates the atlas dimensions and
decodes day/night cells once. A load error reaches the existing startup
retry screen rather than silently hiding artwork.

Editor, race and flyover share the same visible-scenery render plan.
Authored props and trees paint above the road surface and lane stripes, so
foliage can overlap the shoulder naturally. Vehicles and raised bridge
structures retain their foreground ordering; physics and placement are unchanged.
Existing placement radius, stable identifiers, day/night contact shadows,
selection/drag/undo semantics and terrain physics are preserved. The
shared tree retains the existing canopy size and terrain-projected shadow.
Phaser registers a bounded texture per kind and lighting and reuses live
visible sprite objects; departing props and scene shutdown release
objects. Canvas flyover draws the same cells with the same size. Vector
art is retained for pre-boot/component-test presentation. The scenery
picker continues using its existing labels/icons. No new prop types or
serialized fields are introduced. Actual in-game art review and Android
frame pacing remain validation requirements.


### Themed bridge materials

All four environments share the canonical bridge geometry and its
existing terrain/local-ground shadow modes. Meadow has timber rails and
mossy stone supports, Desert has warm sandstone parapets, Cityscape has
steel rails and concrete supports, and Kids' Room has colorful toy-block
rails and supports. Thin distance-anchored deck seams and railing hardware
add character without modifying the selected street/dirt/ice surface.
Day/night palettes affect only presentation.

The elevated deck now uses the very same generated road texture strip,
variation count, world width and canonical path-distance phase as the
ordinary road. A sparse bitmap overlay paints the road surface, seams,
lane markings and rails. Two optional bounded tile caches separate shallow
ramp approaches (below ground vehicles) from the higher deck (above them).
Each reuses the existing 48-tile limit; tracks without bridges allocate
neither. The original vector artwork remains as a themed fallback when
zoomed out or during editing. Rails are included in the bitmap overlay
to preserve their appearance even when the editor combines vector
decorations into its static raster. The race keeps its existing wall
and upper-car depth ordering. The flyover uses the same geometry and
material commands and overlays. Its existing simplified all-cars-on-top
preview behavior is unchanged. Environment switches invalidate editor
world artwork, but not the underlying geometry contract.

No bridge heights, grip, clearance, collision, recovery, track formats or
authored points are modified. Visual/device verification remains required.

### Race-speed road cues

Race and flyover road ribbons add repeated material-specific edge slashes where
the authored surface changes, and paired amber bars with endpoint studs on the
ground approaches at overpass entry and exit. Each ground cue includes an arrow
pointing toward the raised section. The marks follow the sampled road gate
tangent and stay inside the driving surface. Night uses brighter contrast; the
geometry is baked into the existing bounded static marking batches. In race,
only the player's next authoritative timing
gate is emphasized; other recovery markers remain subdued. The active marker
updates when the gate changes, not on every draw frame. No implicit gate,
physics or track data is introduced.

### Organic shoreline geometry (first slice)

The authored terrain grid remains the save and editor representation. The
compiled terrain surface now bevels eligible water/grass corners by up to
45% of a cell. Single-cell rings, diagonal contacts and junctions touching
hills retain their original boundaries. The same corner cuts are used by
material lookup and the contour consumed by the vector, bitmap and flyover
renderers; there is no separate visual-only water hazard.

The shared terrain tessellator now fills angled scanline trapezoids rather
than midpoint rectangles. It still emits the original bounded quads for
orthogonal hills and retains bitmap spatial indexing, cache and LOD limits.
No new textures, per-frame mesh generation, save fields or dependencies
are introduced. Existing saved tracks may have slightly different water
hazard boundaries at grass corners; existing record validity and Android
frame pacing must be assessed before release.

Hills and their elevation sampling are unchanged in this slice. Native
Phaser Earcut, curved (rather than beveled) shoreline segments and hill
smoothing remain follow-ups: the shared bitmap painter needs bounded
triangles, and importing the full Phaser runtime into headless geometry
tests would break the separation of responsibilities. Revert this slice
to restore the original terrain geometry without a save migration.

### Editor terrain cache ownership

Water and hills now have independent scene-lifetime bitmap owners. Road edits
and live road gestures preserve unchanged water canvases, GPU textures and
pending uploads. Hill art is invalidated only when authored terrain or
appearance changes, or the sequence of road segments potentially influencing
hill slope blending changes. A conservative spatial corridor test includes
added, moved and removed segments and the closing edge of a circuit.
Road surface and bridge metadata do not influence that hill field.

Road and bridge presentation keep their existing committed-geometry rebuild
and vector gesture preview. The vector terrain underlay shares the same
hill-influence invalidation rule. Editing near hills can still rebuild the
entire hill pass; finer per-region invalidation is a separate optimization.
The original 48-tile combined terrain cache budget remains: mixed terrain
allocates 24 tiles to water and 24 to hills, which may cause earlier vector
fallback at wide zooms. Race and flyover bitmap composition are unchanged.

No save or physics changes. Component tests cover cache retention, real
terrain changes and hill influence; Android profiling remains required.
