# Tree Rendering Restoration Design

## Goal

Restore authored trees in both the editor and races with one consistent
day/night presentation.

## Root Cause

Tree data survives authoring, storage, migration, and track loading. The race
scene never consumes `track.trees`, so races cannot display scenery. The editor
draws only a small two-circle marker inside its control overlay, after the road,
which differs from the original tree silhouette and cannot be reused by races.

## Approach

Create `src/phaser/rendering/treeRenderer.ts` with:

- a pure `buildTreePresentation(trees, night)` function;
- typed shadow and canopy primitives;
- a thin `renderTrees(graphics, trees, night)` Phaser adapter.

Each tree uses a soft southeast ground shadow, a dark 15-unit canopy, and a
smaller offset highlight canopy. Night mode uses darker canopy colors and a
subtler shadow.

`EditorScene` and `RaceScene` each own a dedicated scenery graphics layer below
the road. The editor renderer stops drawing tree markers in the points overlay,
preventing duplicate and incorrectly ordered scenery.

## Alternatives

Copying the current editor loop into the race would restore visibility quickly
but duplicate styling and preserve the weaker marker. Phaser sprites would add
asset loading and lifecycle complexity without improving the current
code-native art direction. The shared renderer is the smallest maintainable
boundary.

## Testing

Pure presentation tests will prove:

- one tree produces one shadow and two canopy layers;
- positions and radii match the authored world coordinate;
- night colors differ from day colors;
- empty input produces no primitives.

Existing editor, race, rendering, strict TypeScript, lint, and production-build
gates must remain green.
