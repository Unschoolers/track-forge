import { describe, expect, it, vi } from 'vitest'
import {
  EditorInputController,
  type EditorCamera,
} from '@/phaser/input/editorInput'
import { createEditorState, reduceEditor } from '@/domain/editor/editorState'
import type { TerrainCellCoordinate } from '@/domain/terrain/terrainField'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { normalizeTerrain } from '@/domain/terrain/terrainField'
import { TERRAIN_LIMITS } from '@/domain/config'

describe('EditorInputController', () => {
  it('translates draw gestures into world-space editor commands', () => {
    const dispatch = vi.fn()
    const camera: EditorCamera = { x: 10, y: 20, zoom: 2 }
    const input = new EditorInputController({
      camera,
      tool: () => 'draw',
      surface: () => 'dirt',
      editor: () => createEditorState(),
      dispatch,
    })

    input.pointerDown({ id: 1, x: 30, y: 50 })
    input.pointerMove({ id: 1, x: 50, y: 70 })
    input.pointerUp({ id: 1, x: 50, y: 70 })

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'begin-gesture',
    })
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'add-point',
      point: { x: 25, y: 45, surface: 'dirt' },
    })
    expect(dispatch).toHaveBeenNthCalledWith(3, {
      type: 'add-point',
      point: { x: 35, y: 55, surface: 'dirt' },
    })
    expect(dispatch).toHaveBeenNthCalledWith(4, {
      type: 'finalize-draw',
      startIndex: 0,
      zoom: 2,
    })
    expect(dispatch).toHaveBeenNthCalledWith(5, {
      type: 'normalize-loop',
    })
    expect(dispatch).toHaveBeenNthCalledWith(6, {
      type: 'end-gesture',
    })
  })

  it('pans and clamps zoom without emitting editor mutations', () => {
    const dispatch = vi.fn()
    const camera: EditorCamera = { x: 0, y: 0, zoom: 1 }
    const input = new EditorInputController({
      camera,
      tool: () => 'pan',
      surface: () => 'street',
      editor: () => createEditorState(),
      dispatch,
    })

    input.pointerDown({ id: 2, x: 100, y: 100 })
    input.pointerMove({ id: 2, x: 130, y: 80 })
    input.zoomBy(100)
    input.pointerCancel(2)
    input.pointerMove({ id: 2, x: 200, y: 200 })

    expect(camera).toEqual({ x: -30, y: 20, zoom: 2.7 })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('pinches around the gesture midpoint without painting, then requires a fresh touch', () => {
    const dispatch = vi.fn()
    const camera: EditorCamera = { x: 0, y: 0, zoom: 1 }
    const input = new EditorInputController({
      camera,
      viewport: () => ({ width: 200, height: 200 }),
      tool: () => 'draw',
      surface: () => 'street',
      editor: () => createEditorState(),
      dispatch,
    })
    input.pointerDown({ id: 1, x: 60, y: 100 })
    input.pointerDown({ id: 2, x: 140, y: 100 })
    dispatch.mockClear()
    input.pointerMove({ id: 1, x: 40, y: 100 })
    input.pointerMove({ id: 2, x: 180, y: 100 })
    expect(camera.zoom).toBeGreaterThan(1)
    expect(dispatch).not.toHaveBeenCalled()
    const zoom = camera.zoom
    input.pointerUp({ id: 1, x: 40, y: 100 })
    input.pointerMove({ id: 2, x: 190, y: 100 })
    expect(camera.zoom).toBe(zoom)
    input.pointerUp({ id: 2, x: 180, y: 100 })
    expect(dispatch).not.toHaveBeenCalled()
    input.pointerDown({ id: 3, x: 50, y: 50 })
    input.pointerUp({ id: 3, x: 50, y: 50 })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'add-point' }))
  })

  it('moves, paints, and erases the nearest editor content', () => {
    const dispatch = vi.fn()
    const camera: EditorCamera = { x: 0, y: 0, zoom: 1 }
    let tool: 'select' | 'paint' | 'erase' = 'select'
    const editor = createEditorState(
      [
        { x: 10, y: 10, surface: 'street' },
        { x: 100, y: 10, surface: 'street' },
      ],
      [{ x: 60, y: 60 }],
    )
    const input = new EditorInputController({
      camera,
      tool: () => tool,
      surface: () => 'mixed',
      editor: () => editor,
      path: () =>
        new TrackGeometryService().get({
          points: editor.points,
          terrain: editor.terrain,
        }).path,
      dispatch,
    })

    input.pointerDown({ id: 1, x: 12, y: 12 })
    input.pointerMove({ id: 1, x: 25, y: 30 })
    input.pointerUp({ id: 1, x: 25, y: 30 })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'move-point',
      index: 0,
      point: { x: 25, y: 30 },
    })

    dispatch.mockClear()
    tool = 'paint'
    input.pointerDown({ id: 2, x: 70, y: 12 })
    input.pointerUp({ id: 2, x: 70, y: 12 })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'paint-point',
      index: 0,
      surface: 'street',
    })

    dispatch.mockClear()
    tool = 'erase'
    input.pointerDown({ id: 3, x: 60, y: 60 })
    input.pointerUp({ id: 3, x: 60, y: 60 })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'erase-tree',
      index: 0,
    })
  })

  it('selects a crossing context instead of an unrelated control point', () => {
    const dispatch = vi.fn()
    const onCrossingSelected = vi.fn()
    const editor = createEditorState([
      { x: -120, y: -100, surface: 'street' },
      { x: 120, y: 100, surface: 'street' },
      { x: -120, y: 100, surface: 'street' },
      { x: 120, y: -100, surface: 'street' },
      { x: -120, y: -100, surface: 'street' },
    ])
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'select',
      surface: () => 'street',
      editor: () => editor,
      path: () =>
        new TrackGeometryService().get({
          points: editor.points,
          terrain: editor.terrain,
        }).path,
      dispatch,
      onCrossingSelected,
    })

    input.pointerDown({ id: 9, x: 1, y: -2 })
    input.pointerUp({ id: 9, x: 1, y: -2 })

    expect(onCrossingSelected).toHaveBeenCalledWith('0:2')
    expect(input.selectedControlPoint()).toBe(-1)
  })

  it('paints the nearest authored section with the structure brush', () => {
    const dispatch = vi.fn()
    const editor = createEditorState([
      { x: 0, y: 0, surface: 'street' },
      { x: 100, y: 0, surface: 'street' },
      { x: 100, y: 100, surface: 'street' },
    ])
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'structure',
      surface: () => 'street',
      structure: () => 'overpass',
      editor: () => editor,
      dispatch,
    })

    input.pointerDown({ id: 4, x: 45, y: 3 })
    input.pointerUp({ id: 4, x: 45, y: 3 })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'paint-section-structure',
      index: 0,
      structure: 'overpass',
    })
  })

  it('previews world-space terrain cells independently of zoom', () => {
    const camera: EditorCamera = { x: 0, y: 0, zoom: 1 }
    const input = new EditorInputController({
      camera,
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'hill', radius: 48 }),
      editor: () => createEditorState(),
      dispatch: vi.fn(),
    })

    input.pointerDown({ id: 1, x: 16, y: 16 })
    const atOneX = input.terrainPreview()
    camera.zoom = 2
    input.pointerMove({ id: 1, x: 32, y: 32 })

    expect(input.terrainPreview()).toEqual(atOneX)
  })

  it('commits one deduplicated terrain batch before ending on pointer-up', () => {
    const dispatch = vi.fn()
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'water', radius: 48 }),
      editor: () => createEditorState(),
      dispatch,
    })

    input.pointerDown({ id: 1, x: 16, y: 16 })
    input.pointerMove({ id: 1, x: 16, y: 16 })
    input.pointerMove({ id: 1, x: 16, y: 16 })
    input.pointerUp({ id: 1, x: 16, y: 16 })

    const paint = dispatch.mock.calls.find(
      ([command]) => command.type === 'paint-terrain',
    )?.[0]
    expect(paint).toMatchObject({ type: 'paint-terrain', kind: 'water' })
    if (paint?.type !== 'paint-terrain') {
      throw new Error('Expected one terrain paint command')
    }
    const cells: readonly TerrainCellCoordinate[] = paint.cells
    expect(
      new Set(cells.map(({ column, row }) => `${column}:${row}`)).size,
    ).toBe(cells.length)
    expect(dispatch.mock.calls.map(([command]) => command.type)).toEqual([
      'begin-gesture',
      'paint-terrain',
      'end-gesture',
    ])
  })

  it('discards pending terrain painting on cancellation without an undo entry', () => {
    let editor = createEditorState()
    const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
      editor = reduceEditor(editor, command)
    })
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'hill', radius: 48 }),
      editor: () => editor,
      dispatch,
    })

    input.pointerDown({ id: 1, x: 16, y: 16 })
    input.pointerCancel(1)

    expect(input.terrainPreview()).toBeNull()
    expect(editor.terrain).toEqual(EMPTY_TERRAIN)
    expect(editor.history).toEqual([])
    expect(reduceEditor(editor, { type: 'undo' })).toBe(editor)
    expect(dispatch.mock.calls.map(([command]) => command.type)).toEqual([
      'begin-gesture',
      'end-gesture',
    ])
  })

  it('cancels pending terrain painting when a second pointer arrives', () => {
    let editor = createEditorState()
    const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
      editor = reduceEditor(editor, command)
    })
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'hill', radius: 96 }),
      editor: () => editor,
      dispatch,
    })

    input.pointerDown({ id: 1, x: 16, y: 16 })
    input.pointerDown({ id: 2, x: 48, y: 48 })

    expect(input.terrainPreview()).toBeNull()
    expect(editor.terrain).toEqual(EMPTY_TERRAIN)
    expect(editor.history).toEqual([])
    expect(reduceEditor(editor, { type: 'undo' })).toBe(editor)
    expect(dispatch.mock.calls.map(([command]) => command.type)).toEqual([
      'begin-gesture',
      'end-gesture',
    ])
  })

  it('cancels an active terrain gesture without a caller-managed pointer id', () => {
    let editor = createEditorState()
    const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
      editor = reduceEditor(editor, command)
    })
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'hill', radius: 48 }),
      editor: () => editor,
      dispatch,
    })

    input.pointerDown({ id: 7, x: 16, y: 16 })
    input.cancelActiveGesture()

    expect(input.terrainPreview()).toBeNull()
    expect(editor.gestureStart).toBeNull()
    expect(editor.terrain).toEqual(EMPTY_TERRAIN)
  })

  it('sweeps sparse pointer samples into one continuous terrain transaction', () => {
    let editor = createEditorState()
    const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
      editor = reduceEditor(editor, command)
    })
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'hill', radius: 48 }),
      editor: () => editor,
      dispatch,
    })

    input.pointerDown({ id: 1, x: 16, y: 16 })
    input.pointerMove({ id: 1, x: 336, y: 16 })
    const preview = input.terrainPreview()
    input.pointerUp({ id: 1, x: 336, y: 16 })

    const columns = new Set(
      editor.terrain.cells
        .filter(({ row }) => row === 0)
        .map(({ column }) => column),
    )
    for (let column = -1; column <= 11; column += 1) {
      expect(columns.has(column)).toBe(true)
    }
    expect(preview?.cells).toHaveLength(editor.terrain.cells.length)
    expect(preview?.terrain).toEqual(editor.terrain)
    expect(preview?.dirtyCells.length).toBeGreaterThan(0)
    expect(preview?.revision).toBeGreaterThan(1)
    expect(editor.history).toHaveLength(1)
  })

  it('keeps preview revisions monotonic across cancelled strokes', () => {
    let editor = createEditorState()
    const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
      editor = reduceEditor(editor, command)
    })
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'hill', radius: 48 }),
      editor: () => editor,
      dispatch,
    })

    input.pointerDown({ id: 1, x: 16, y: 16 })
    const firstRevision = input.terrainPreview()?.revision
    input.pointerCancel(1)
    input.pointerDown({ id: 2, x: 336, y: 16 })
    const secondRevision = input.terrainPreview()?.revision

    expect(firstRevision).toBeDefined()
    expect(secondRevision).toBeGreaterThan(firstRevision ?? 0)
  })

  it('rejects an edge-crossing terrain stroke without a partial command', () => {
    let editor = createEditorState()
    const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
      editor = reduceEditor(editor, command)
    })
    const onRejected = vi.fn()
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'hill', radius: 48 }),
      editor: () => editor,
      dispatch,
      onRejected,
    })
    const edge =
      TERRAIN_LIMITS.maximumCoordinate * EMPTY_TERRAIN.cellSize + 16

    input.pointerDown({ id: 1, x: edge, y: 16 })
    input.pointerUp({ id: 1, x: edge, y: 16 })

    expect(onRejected).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'terrain-coordinate-bounds' }),
    )
    expect(
      dispatch.mock.calls.some(([command]) => command.type === 'paint-terrain'),
    ).toBe(false)
    expect(editor.terrain).toBe(EMPTY_TERRAIN)
    expect(editor.history).toEqual([])
  })

  it('defers full candidate materialization until preview is consumed', () => {
    const terrain = normalizeTerrain({
      cells: Array.from({ length: 100 }, (_, index) => ({
        column: index % 10,
        row: Math.floor(index / 10),
        kind: 'hill',
      })),
    })
    let editor = createEditorState([], [], undefined, terrain)
    const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
      editor = reduceEditor(editor, command)
    })
    const iteration = vi.spyOn(terrain.cells, Symbol.iterator)
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'water', radius: 48 }),
      editor: () => editor,
      dispatch,
    })

    input.pointerDown({ id: 1, x: 16, y: 16 })
    iteration.mockClear()
    input.pointerMove({ id: 1, x: 48, y: 16 })

    expect(iteration).not.toHaveBeenCalled()
    input.terrainPreview()
    expect(iteration).toHaveBeenCalledTimes(1)
  })

  it('rejects an over-capacity stroke with feedback and no partial history', () => {
    const terrain = normalizeTerrain({
      cells: Array.from({ length: TERRAIN_LIMITS.maximumCells }, (_, index) => ({
        column: index % 200,
        row: Math.floor(index / 200),
        kind: 'hill',
      })),
    })
    let editor = createEditorState([], [], undefined, terrain)
    const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
      editor = reduceEditor(editor, command)
    })
    const onRejected = vi.fn()
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'terrain',
      surface: () => 'street',
      terrainBrush: () => ({ kind: 'water', radius: 48 }),
      editor: () => editor,
      dispatch,
      onRejected,
    })

    input.pointerDown({ id: 1, x: 16, y: 16 })
    input.pointerUp({ id: 1, x: 16, y: 16 })

    expect(onRejected).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'terrain-capacity' }),
    )
    expect(
      dispatch.mock.calls.some(([command]) => command.type === 'paint-terrain'),
    ).toBe(false)
    expect(editor.terrain).toBe(terrain)
    expect(editor.history).toEqual([])
  })

  it('rejects in-water tree input with feedback while allowing dry placement', () => {
    const terrain = normalizeTerrain({
      cells: [{ column: 0, row: 0, kind: 'water' }],
    })
    let editor = createEditorState([], [], undefined, terrain)
    const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
      editor = reduceEditor(editor, command)
    })
    const onRejected = vi.fn()
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'tree',
      surface: () => 'street',
      editor: () => editor,
      dispatch,
      onRejected,
    })

    input.pointerDown({ id: 1, x: 16, y: 16 })
    input.pointerUp({ id: 1, x: 16, y: 16 })
    input.pointerDown({ id: 2, x: 48, y: 16 })
    input.pointerUp({ id: 2, x: 48, y: 16 })

    expect(onRejected).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'tree-in-water' }),
    )
    expect(editor.trees).toEqual([{ x: 48, y: 16 }])
    expect(editor.history).toHaveLength(1)
  })
})
