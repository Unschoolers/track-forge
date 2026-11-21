import { describe, expect, it } from 'vitest'
import type { EditorUiState } from '@/application/appState'
import { reduceEditorUi } from '@/application/editor/editorUiReducer'

const initial: EditorUiState = {
  tool: 'select', surface: 'street', structure: 'surface',
  terrainBrush: { mode: 'raise', radius: 48 },
  grid: true, cameraRequest: null,
  selectedCrossing: null, selectedPoint: null,
}

const edit = (
  state: EditorUiState, command: Parameters<typeof reduceEditorUi>[1],
) => reduceEditorUi(state, command, 'grass')

describe('editor chrome transitions', () => {
  it('keeps point and crossing selections mutually exclusive and clears both on tool switch', () => {
    const point = edit(initial, { type: 'select-editor-point', index: 7 })
    expect(point).toMatchObject({ selectedPoint: 7, selectedCrossing: null })
    const crossing = edit(point, { type: 'select-editor-crossing', key: 'bridge-1' })
    expect(crossing).toMatchObject({ selectedPoint: null, selectedCrossing: 'bridge-1' })
    expect(edit(crossing, { type: 'set-editor-tool', tool: 'select' })).toEqual(crossing)
    expect(edit(crossing, { type: 'set-editor-tool', tool: 'draw' }))
      .toMatchObject({ tool: 'draw', selectedPoint: null, selectedCrossing: null })
    expect(point).toMatchObject({ selectedPoint: 7, selectedCrossing: null })
  })

  it('preserves an existing point when deselecting crossings and vice versa', () => {
    const point = edit(initial, { type: 'select-editor-point', index: 3 })
    expect(edit(point, { type: 'select-editor-crossing', key: null }).selectedPoint).toBe(3)
    const crossing = edit(initial, { type: 'select-editor-crossing', key: 'ramp' })
    expect(edit(crossing, { type: 'select-editor-point', index: null }).selectedCrossing).toBe('ramp')
  })

  it('updates a terrain brush property without clobbering its partner and increments camera sequence', () => {
    const painted = edit(initial, { type: 'set-editor-terrain-mode', mode: 'water' })
    expect(painted.terrainBrush).toEqual({ mode: 'water', radius: 48 })
    const resized = edit(painted, { type: 'set-editor-terrain-radius', radius: 160 })
    expect(resized.terrainBrush).toEqual({ mode: 'water', radius: 160 })
    const first = edit(resized, { type: 'request-editor-camera', action: 'fit' })
    const second = edit(first, { type: 'request-editor-camera', action: 'zoom-out' })
    expect(first.cameraRequest).toEqual({ sequence: 1, action: 'fit' })
    expect(second.cameraRequest).toEqual({ sequence: 2, action: 'zoom-out' })
    expect(edit(initial, { type: 'toggle-editor-grid' }).grid).toBe(false)
  })

  it('preserves terrain and road selection when changing surface, structure or scenery', () => {
    const surface = edit(initial, { type: 'set-editor-surface', surface: 'dirt' })
    const bridge = edit(surface, { type: 'set-editor-structure', structure: 'overpass' })
    expect(bridge).toMatchObject({ surface: 'dirt', structure: 'overpass', grid: true })
    const invalid = reduceEditorUi(bridge, { type: 'set-editor-scenery', choice: 'desert-cactus' }, 'cityscape')
    expect(invalid.sceneryChoice).toBe('tree')
    const erase = reduceEditorUi(invalid, { type: 'set-editor-scenery', choice: 'erase-scenery' }, 'cityscape')
    expect(erase.sceneryChoice).toBe('erase-scenery')
  })
})
