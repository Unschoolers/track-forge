import { describe, expect, it } from 'vitest'
import {
  createEditorState,
  reduceEditor,
} from '@/domain/editor/editorState'
import {
  EMPTY_TERRAIN,
  normalizeTerrain,
  paintTerrain,
} from '@/domain/terrain/terrainField'
import { TERRAIN_LIMITS } from '@/domain/config'

describe('terrain editor transactions', () => {
  it('accepts terrain as the fourth create-state argument', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      [{ column: -1, row: 2 }],
      'water',
    )

    expect(createEditorState([], [], undefined, terrain).terrain).toBe(terrain)
  })

  it('commits a dragged terrain stroke as one undo step', () => {
    let state = reduceEditor(
      createEditorState([], [], undefined, EMPTY_TERRAIN),
      { type: 'begin-gesture' },
    )
    state = reduceEditor(state, {
      type: 'paint-terrain',
      cells: [
        { column: 0, row: 0 },
        { column: 1, row: 0 },
      ],
      kind: 'hill',
    })
    state = reduceEditor(state, { type: 'end-gesture' })

    expect(state.terrain.cells).toHaveLength(2)
    expect(state.history).toHaveLength(1)
    expect(reduceEditor(state, { type: 'undo' }).terrain).toEqual(EMPTY_TERRAIN)
    expect(reduceEditor(state, { type: 'redo' }).terrain.cells).toHaveLength(2)
  })

  it('keeps a terrain no-op as the original editor state', () => {
    const state = createEditorState([], [], undefined, EMPTY_TERRAIN)

    expect(
      reduceEditor(state, {
        type: 'paint-terrain',
        cells: [{ column: 0, row: 0 }],
        kind: 'ground',
      }),
    ).toBe(state)
  })

  it('clears terrain and restores it through undo', () => {
    const painted = reduceEditor(
      createEditorState([], [], undefined, EMPTY_TERRAIN),
      {
        type: 'paint-terrain',
        cells: [{ column: 3, row: -2 }],
        kind: 'water',
      },
    )
    const cleared = reduceEditor(painted, { type: 'clear' })

    expect(cleared.terrain).toEqual(EMPTY_TERRAIN)
    expect(reduceEditor(cleared, { type: 'undo' }).terrain).toEqual(
      painted.terrain,
    )
  })

  it('expands terrain with the editable world and undoes it atomically', () => {
    const terrain = normalizeTerrain({
      cells: [{ column: 0, row: 0, kind: 'hill' }],
    })
    const state = createEditorState(
      [
        { x: 0, y: 0, surface: 'street' as const },
        { x: 128, y: 0, surface: 'street' as const },
        { x: 128, y: 128, surface: 'street' as const },
        { x: 0, y: 128, surface: 'street' as const },
      ],
      [],
      undefined,
      terrain,
    )
    const expanded = reduceEditor(state, { type: 'expand', factor: 2 })

    expect(expanded.terrain.cells).toEqual([
      { column: -2, row: -2, kind: 'hill' },
      { column: -1, row: -2, kind: 'hill' },
      { column: -2, row: -1, kind: 'hill' },
      { column: -1, row: -1, kind: 'hill' },
    ])
    expect(reduceEditor(expanded, { type: 'undo' }).terrain).toEqual(terrain)
  })

  it('refuses expansion atomically when transformed terrain exceeds bounds', () => {
    const terrain = normalizeTerrain({
      cells: [{ column: TERRAIN_LIMITS.maximumCoordinate, row: 0, kind: 'hill' }],
    })
    const state = createEditorState(
      [
        { x: -32, y: 0, surface: 'street' as const },
        { x: 32, y: 0, surface: 'street' as const },
      ],
      [],
      undefined,
      terrain,
    )

    const expanded = reduceEditor(state, { type: 'expand', factor: 2 })

    expect(expanded).toBe(state)
    expect(expanded.history).toEqual([])
  })

  it('refuses expansion atomically when rasterization exceeds capacity', () => {
    const terrain = normalizeTerrain({
      cells: Array.from({ length: 71 * 71 }, (_, index) => ({
        column: (index % 71) - 35,
        row: Math.floor(index / 71) - 35,
        kind: 'hill',
      })),
    })
    const state = createEditorState(
      [
        { x: -2_000, y: -2_000, surface: 'street' as const },
        { x: 2_000, y: 2_000, surface: 'street' as const },
      ],
      [],
      undefined,
      terrain,
    )

    const expanded = reduceEditor(state, { type: 'expand', factor: 2 })

    expect(expanded).toBe(state)
    expect(expanded.terrain).toBe(terrain)
    expect(expanded.history).toEqual([])
  })
})
