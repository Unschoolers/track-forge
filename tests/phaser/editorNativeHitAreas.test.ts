import { describe, expect, it, vi } from 'vitest'
import { EditorInputController } from '@/phaser/input/editorInput'
import { createEditorState } from '@/domain/editor/editorState'
import type { RoadPath } from '@/domain/track/pathBuilder'

describe('editor native hit area adapter', () => {
  it('keeps nearest crossing priority and delegates the polygon hit shape', () => {
    const editor = createEditorState([], [])
    const polygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }]
    const path = { crossings: [
      { key: 'far', position: { x: 50, y: 50 }, polygon },
      { key: 'near', position: { x: 10, y: 10 }, polygon },
    ] } as unknown as RoadPath
    const polygonContains = vi.fn(() => true)
    const selected = vi.fn()
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 }, tool: () => 'select', surface: () => 'street',
      editor: () => editor, path: () => path, dispatch: vi.fn(),
      polygonContains, onCrossingSelected: selected,
    })
    input.pointerDown({ id: 1, x: 12, y: 12 })
    expect(polygonContains).toHaveBeenCalledTimes(2)
    expect(selected).toHaveBeenCalledWith('near')
  })
})
