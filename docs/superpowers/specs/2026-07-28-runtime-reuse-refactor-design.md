# Runtime Reuse Refactor Design

## Goal

Reduce production code while preserving TrackForge behavior. Code reuse is the
primary constraint: this pass removes parallel runtime representations and
rendering paths instead of compressing syntax.

The measured baseline is 11,986 lines across 94 files under `src/`. The pass
must finish below that baseline, with a target reduction of at least 250
production lines.

## Problem

Track version 7 stores bridge authoring on road sections through
`TrackPoint.elevation`. The repository already migrates older crossing-local
`TrackElevation` records into that representation and clears the legacy array.
Despite that boundary migration, the rest of the application still carries the
legacy array through:

- the public `Track` model;
- editor snapshots, history, and almost every reducer command;
- application controller state construction and persistence;
- path and crossing detection;
- editor input and UI rendering;
- a second crossing-local bridge renderer.

This creates two authorities for bridge presentation. Continuous section
bridges use `bridgeRenderer`, while legacy crossing elevations use
`crossingRenderer`. `trackRenderer` draws both. The duplicate runtime model also
causes most editor commands to repeat unchanged `points`, `trees`, and
`elevations` fields.

## Considered Approaches

### Syntax compression

Shorten expressions, combine branches, and reduce formatting. This can reduce
line count quickly but creates no reusable boundary and harms maintenance. It
is rejected.

### Broad controller and dependency-injection rewrite

Introduce a larger state service or command graph and migrate the controller at
the same time. This may improve structure later, but it expands scope and would
probably increase code before it reduces it. It is rejected for this pass.

### Canonical-path consolidation

Keep legacy decoding at the storage boundary, make v7 section elevation the
only runtime bridge model, make `bridgeRenderer` the only bridge renderer, and
make editor mutations reusable partial patches. This removes the root
duplication with a contained compatibility boundary. This is the selected
approach.

## Design

### Storage compatibility boundary

`trackRepository` continues to decode version 5/6 `elevations` arrays. During
decode it marks the referenced source sections as `overhead`, returns a version
7 track, and does not expose legacy elevation records.

The legacy elevation shape becomes private to the repository decoder. It is
not part of `Track`, editor state, application state, path construction, or
rendering.

### Canonical runtime model

`Track.points[].elevation` is the sole authored elevation value. Removing
`Track.elevations` simplifies:

- `Track` and editor snapshot types;
- `createEditorState`;
- controller construction and persistence;
- geometry caching and path building;
- crossing detection;
- editor input and presentation call sites.

Crossing detection derives which road is above from the section elevation
profile only.

### One bridge renderer

`crossingRenderer` retains only at-grade junction presentation. Elevated
crossings require no special local bridge primitives because the elevated road
section is already drawn continuously by `bridgeRenderer`.

`trackRenderer` stops stacking crossing-local bridge decks and walls over the
continuous bridge. The existing render order remains:

1. continuous bridge underlay and shadows;
2. ground road ribbon, curbs, markings, start line, and at-grade junction fill;
3. continuous bridge deck;
4. continuous bridge walls;
5. lamp posts.

This preserves at-grade X crossings while giving every elevated run the same
ramps, shadows, supports, walls, and physics path.

### Reusable editor patches

The reducer's mutation helper accepts `Partial<EditorSnapshot>`. It merges the
patch over the current snapshot before applying the existing history/gesture
rules.

Commands provide only changed fields:

- point edits patch `points`;
- tree edits patch `trees`;
- start edits patch `start`;
- clear patches both collections.

The reusable helper preserves untouched collection identities. Undo, redo,
gesture coalescing, and the 50-entry history cap remain unchanged.

The obsolete `set-crossing-elevation` command is removed. The live
`set-crossing-sections` command remains and writes section elevation directly.

## Error Handling and Compatibility

- Malformed legacy elevation records remain ignored at the repository
  boundary.
- Invalid editor indices and non-finite values continue to return the existing
  state.
- Existing saved version 5/6 tracks still migrate when listed or loaded.
- Version 7 saves no longer serialize an unused `elevations` property.
- No gameplay, bridge-physics, lighting, camera, audio, or vehicle tuning
  behavior is changed.

## Verification

The implementation will:

1. add or update focused tests for legacy storage migration, section-elevation
   crossing detection, junction presentation, continuous bridge presentation,
   and partial editor patches;
2. run the smallest affected suites during each slice;
3. run `npm run verify`;
4. run `git diff --check`;
5. recount `src/` lines with the same baseline command and require a net
   reduction, targeting at least 250 lines.

