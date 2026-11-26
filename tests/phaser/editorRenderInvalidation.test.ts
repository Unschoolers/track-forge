import { describe, expect, it } from 'vitest'
import {
  editorPointerRenderChanges,
  editorSnapshotRenderChanges,
  editorTreeRenderRequired,
  editorTerrainRenderRequired,
  treePreviewRenderRequired,
  terrainPreviewCompileRequired,
  type EditorRenderState,
} from '@/phaser/rendering/editorRenderInvalidation'

function state(
  overrides: Partial<EditorRenderState> = {},
): EditorRenderState {
  return {
    routeKind: 'circuit',
    points: [],
    terrain: {},
    trees: [],
    scenery: [],
    environmentId: 'grass',
    start: undefined,
    night: false,
    grid: true,
    selectedPoint: null,
    selectedCrossing: null,
    tool: 'terrain',
    terrainMode: 'raise',
    terrainRadius: 48,
    ...overrides,
  }
}

describe('editor render invalidation', () => {
  it('does not redraw immutable world data for gesture-only snapshots', () => {
    const current = state()

    expect(editorSnapshotRenderChanges(current, { ...current }, false)).toEqual({
      world: false,
      appearance: false,
      grid: false,
      overlay: false,
      preview: false,
    })
  })

  it('redraws world and overlay when authored terrain identity changes', () => {
    const previous = state()

    expect(
      editorSnapshotRenderChanges(
        previous,
        { ...previous, terrain: {} },
        false,
      ),
    ).toEqual({
      world: true,
      appearance: false,
      grid: false,
      overlay: true,
      preview: false,
    })
  })

  it('retains terrain during a road drag and refreshes it when the edit commits', () => {
    const rendered = state()
    const first = { ...rendered, points: [], roadDrag: true }
    const last = { ...first, points: [] }
    expect(editorTerrainRenderRequired(rendered, first, false)).toBe(false)
    expect(editorTerrainRenderRequired(rendered, last, true)).toBe(false)
    expect(editorTerrainRenderRequired(rendered, { ...last, terrain: {} }, false)).toBe(true)
    expect(editorTerrainRenderRequired(rendered, { ...last, environmentId: 'desert' }, false)).toBe(true)
    expect(editorTerrainRenderRequired(rendered, { ...last, night: true }, false)).toBe(true)
    const committed = { ...last, roadDrag: false }
    expect(editorSnapshotRenderChanges(last, committed, false).world).toBe(true)
    expect(editorTerrainRenderRequired(rendered, committed, false)).toBe(true)
    expect(editorTerrainRenderRequired(committed, committed, false)).toBe(false)
    const cancelled = { ...rendered, roadDrag: false }
    expect(editorSnapshotRenderChanges(last, cancelled, false).world).toBe(true)
    expect(editorTerrainRenderRequired(rendered, cancelled, false)).toBe(false)
    expect(editorTerrainRenderRequired(rendered, cancelled, true)).toBe(true)
  })

  it('limits camera and raw pointer updates to their dirty layers', () => {
    const current = state()

    expect(editorSnapshotRenderChanges(current, current, true)).toEqual({
      world: false,
      appearance: false,
      grid: true,
      overlay: true,
      preview: false,
    })
    expect(editorPointerRenderChanges('terrain')).toEqual({
      world: false,
      appearance: false,
      grid: false,
      overlay: false,
      preview: true,
    })
    expect(editorPointerRenderChanges('pan')).toEqual({
      world: false,
      appearance: false,
      grid: false,
      overlay: false,
      preview: false,
    })
  })

  it('refreshes scenery alone but redraws road and bridge artwork on theme changes', () => {
    const previous = state()
    expect(editorSnapshotRenderChanges(previous, { ...previous, scenery: [] }, false)).toMatchObject({ world: false, appearance: true })
    expect(editorSnapshotRenderChanges(previous, { ...previous, environmentId: 'desert' }, false)).toMatchObject({ world: true, appearance: true })
  })

  it('redraws trees only for tree, terrain, lighting, or tree-preview changes', () => {
    const previous = state()
    expect(editorTreeRenderRequired(previous, { ...previous, scenery: [] })).toBe(false)
    expect(editorTreeRenderRequired(previous, { ...previous, points: [] })).toBe(false)
    expect(editorTreeRenderRequired(previous, { ...previous, trees: [] })).toBe(true)
    expect(editorTreeRenderRequired(previous, { ...previous, terrain: {} })).toBe(true)
    expect(editorTreeRenderRequired(previous, { ...previous, night: true })).toBe(true)
    const tree = { type: 'tree' as const, index: 0, position: { x: 10, y: 20 } }
    const prop = { type: 'prop' as const, index: 0, position: { x: 10, y: 20 } }
    expect(treePreviewRenderRequired(null, prop)).toBe(false)
    expect(treePreviewRenderRequired(prop, { ...prop, position: { x: 20, y: 20 } })).toBe(false)
    expect(treePreviewRenderRequired(null, tree)).toBe(true)
    expect(treePreviewRenderRequired(tree, { ...tree, position: { x: 20, y: 20 } })).toBe(true)
    expect(treePreviewRenderRequired(tree, null)).toBe(true)
  })

  it('compiles candidate impact only for a new non-empty preview revision', () => {
    expect(terrainPreviewCompileRequired(undefined, null)).toBe(false)
    expect(
      terrainPreviewCompileRequired(undefined, {
        revision: 2,
        dirtyCells: [{}],
      }),
    ).toBe(true)
    expect(
      terrainPreviewCompileRequired(2, {
        revision: 2,
        dirtyCells: [{}],
      }),
    ).toBe(false)
    expect(
      terrainPreviewCompileRequired(2, {
        revision: 3,
        dirtyCells: [],
      }),
    ).toBe(false)
  })
})
