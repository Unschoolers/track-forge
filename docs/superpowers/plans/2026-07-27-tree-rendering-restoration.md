# Tree Rendering Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render authored trees consistently in both editor and race scenes.

**Architecture:** A pure presentation builder creates shadow and canopy primitives from tree coordinates and lighting mode. A thin Phaser adapter draws them, while dedicated scene layers place scenery below roads and the editor overlay remains responsible only for editing controls.

**Tech Stack:** TypeScript 7 strict mode, Vitest, Phaser 4, Vite 7, Biome

## Global Constraints

- Preserve tree model, storage, commands, and diagnostics.
- Use one shared renderer for editor and race scenes.
- Render scenery below road ribbons.
- Support distinct day and night colors without new bitmap assets.

---

### Task 1: Build and integrate shared tree presentation

**Files:**
- Create: `src/phaser/rendering/treeRenderer.ts`
- Modify: `src/phaser/rendering/editorRenderer.ts`
- Modify: `src/phaser/scenes/EditorScene.ts`
- Modify: `src/phaser/scenes/RaceScene.ts`
- Modify: `tests/phaser/trackPresentation.test.ts`
- Modify: `docs/refactorplan.md`

**Interfaces:**
- Produces: `TreePrimitive`, `TreePresentation`
- Produces: `buildTreePresentation(trees, night)`
- Produces: `renderTrees(graphics, trees, night)`

- [ ] **Step 1: Add the failing pure-presentation test**

```ts
const day = buildTreePresentation([{ x: 20, y: 30 }], false)
const night = buildTreePresentation([{ x: 20, y: 30 }], true)

expect(day).toHaveLength(3)
expect(day.map(({ layer }) => layer)).toEqual([
  'shadow',
  'canopy',
  'highlight',
])
expect(day[1]).toMatchObject({ x: 20, y: 30, radiusX: 15, radiusY: 15 })
expect(night[1]?.color).not.toBe(day[1]?.color)
expect(buildTreePresentation([], false)).toEqual([])
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test -- tests/phaser/trackPresentation.test.ts`

Expected: FAIL because `treeRenderer.ts` does not exist.

- [ ] **Step 3: Implement the pure builder and draw adapter**

Create typed primitives:

```ts
export interface TreePrimitive {
  readonly layer: 'shadow' | 'canopy' | 'highlight'
  readonly x: number
  readonly y: number
  readonly radiusX: number
  readonly radiusY: number
  readonly color: number
  readonly alpha: number
}
```

Emit a southeast elliptical shadow at `(x + 5, y + 8)`, a radius-15 canopy at
the authored coordinate, and a radius-10 highlight at `(x - 4, y - 5)`.
`renderTrees` draws each primitive with `fillEllipse`.

- [ ] **Step 4: Integrate dedicated scene layers**

In `EditorScene`, create `sceneryGraphics` after the grid and before the track,
clear it during presentation, and call:

```ts
renderTrees(sceneryGraphics, snapshot.editor.trees, night)
```

Remove tree drawing from `renderEditorOverlay`.

In `RaceScene`, add a depth `-1` scenery graphics object and call:

```ts
renderTrees(sceneryGraphics, track.trees, night)
```

before rendering the track.

- [ ] **Step 5: Verify focused and complete behavior**

Run: `npm run test -- tests/phaser/trackPresentation.test.ts tests/phaser/renderingContracts.test.ts`

Expected: PASS.

Run: `npm run verify`

Expected: all tests, strict TypeScript, Biome, and Vite build pass.

- [ ] **Step 6: Check patch hygiene**

Run: `git diff --check`

Expected: exit code 0; Windows line-ending notices are acceptable.
