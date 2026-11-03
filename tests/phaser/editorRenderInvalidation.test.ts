import { describe, expect, it } from 'vitest'
import {
  editorPointerRenderChanges,
  editorSnapshotRenderChanges,
  terrainPreviewCompileRequired,
  type EditorRenderState,
} from '@/phaser/rendering/editorRenderInvalidation'

function state(
  overrides: Partial<EditorRenderState> = {},
): EditorRenderState {
  return {
    points: [],
    terrain: {},
    trees: [],
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
      grid: false,
      overlay: true,
      preview: false,
    })
  })

  it('limits camera and raw pointer updates to their dirty layers', () => {
    const current = state()

    expect(editorSnapshotRenderChanges(current, current, true)).toEqual({
      world: false,
      grid: true,
      overlay: false,
      preview: false,
    })
    expect(editorPointerRenderChanges('terrain')).toEqual({
      world: false,
      grid: false,
      overlay: false,
      preview: true,
    })
    expect(editorPointerRenderChanges('pan')).toEqual({
      world: false,
      grid: false,
      overlay: false,
      preview: false,
    })
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
