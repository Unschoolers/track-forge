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
  it('adds just one point on a road tap, not on drag or off-road tap; undo restores the road', () => {
    const points = [
      { x: 0, y: 0, surface: 'dirt' as const },
      { x: 200, y: 0, surface: 'street' as const },
      { x: 200, y: 200, surface: 'street' as const },
    ]
    let editor = createEditorState(points, [], undefined, undefined, { routeKind: 'point-to-point' })
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 }, tool: () => 'insert', surface: () => 'street',
      editor: () => editor, dispatch: command => { editor = reduceEditor(editor, command) },
    })
    input.pointerDown({ id: 1, x: 70, y: 12 })
    input.pointerMove({ id: 1, x: 110, y: 12 })
    input.pointerUp({ id: 1, x: 110, y: 12 })
    expect(editor.points).toHaveLength(4)
    expect(editor.points[1]).toMatchObject({ x: 70, y: 0, surface: 'dirt' })
    expect(editor.history).toHaveLength(1)
    input.pointerDown({ id: 2, x: 70, y: 120 })
    input.pointerUp({ id: 2, x: 70, y: 120 })
    expect(editor.points).toHaveLength(4)
    editor = reduceEditor(editor, { type: 'undo' })
    expect(editor.points).toEqual(points)
  })

  it('cancels a pending insertion when a second finger starts navigation', () => {
    const points = [
      { x: 0, y: 0, surface: 'street' as const },
      { x: 200, y: 0, surface: 'street' as const },
    ]
    let editor = createEditorState(points, [], undefined, undefined, { routeKind: 'point-to-point' })
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 }, tool: () => 'insert', surface: () => 'street',
      editor: () => editor, dispatch: command => { editor = reduceEditor(editor, command) },
    })
    input.pointerDown({ id: 1, x: 80, y: 0 })
    expect(editor.points).toHaveLength(3)
    input.pointerDown({ id: 2, x: 140, y: 0 })
    input.pointerUp({ id: 1, x: 80, y: 0 })
    input.pointerUp({ id: 2, x: 140, y: 0 })
    expect(editor.points).toEqual(points)
    expect(editor.history).toHaveLength(0)
  })

  it('places and removes a Checkpoint on the road with a tap', () => {
    const points = [{ x: 0, y: 0, surface: 'street' as const }, { x: 1_200, y: 0, surface: 'street' as const }]
    let editor = createEditorState(points, [], undefined, undefined, { routeKind: 'point-to-point' })
    const geometry = new TrackGeometryService()
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 }, tool: () => 'checkpoint', surface: () => 'street',
      editor: () => editor, path: () => geometry.get(editor).path,
      dispatch: command => { editor = reduceEditor(editor, command) },
    })
    const tap = { id: 1, x: 300, y: 0 }
    input.pointerDown(tap)
    input.pointerUp(tap)
    expect(editor.recoveryCheckpoints).toEqual([0.25])
    input.pointerDown(tap)
    input.pointerUp(tap)
    expect(editor.recoveryCheckpoints).toEqual([])
    expect(reduceEditor(editor, { type: 'undo' }).recoveryCheckpoints).toEqual([0.25])
  })

  it('previews and commits a scenery drag at the final pointer position with its grab offset', () => {
    let editor = createEditorState([], [], undefined, undefined, { environmentId: 'desert', scenery: [{ kind: 'desert-cactus', x: 100, y: 100 }] })
    const input = new EditorInputController({ camera: { x: 0, y: 0, zoom: 1 }, tool: () => 'tree', surface: () => 'street', sceneryChoice: () => 'desert-cactus', editor: () => editor, dispatch: command => { editor = reduceEditor(editor, command) } })
    input.pointerDown({ id: 1, x: 105, y: 103 })
    input.pointerMove({ id: 1, x: 135, y: 133 })
    expect(input.sceneryPreview()).toEqual({ type: 'prop', index: 0, position: { x: 130, y: 130 } })
    input.pointerUp({ id: 1, x: 155, y: 153 })
    expect(editor.scenery).toEqual([{ kind: 'desert-cactus', x: 150, y: 150 }])
    expect(editor.history).toHaveLength(1)
    expect(reduceEditor(editor, { type: 'undo' }).scenery[0]).toEqual({ kind: 'desert-cactus', x: 100, y: 100 })
  })

  it('cancels a scenery move on pinch', () => {
    let editor = createEditorState([], [], undefined, undefined, { environmentId: 'desert', scenery: [{ kind: 'desert-cactus', x: 100, y: 100 }] })
    const input = new EditorInputController({ camera: { x: 0, y: 0, zoom: 1 }, tool: () => 'tree', surface: () => 'street', sceneryChoice: () => 'desert-cactus', editor: () => editor, dispatch: command => { editor = reduceEditor(editor, command) } })
    input.pointerDown({ id: 1, x: 100, y: 100 })
    input.pointerMove({ id: 1, x: 140, y: 140 })
    input.pointerDown({ id: 2, x: 160, y: 140 })
    expect(input.sceneryPreview()).toBeNull()
    expect(editor.scenery[0]).toEqual({ kind: 'desert-cactus', x: 100, y: 100 })
    expect(editor.history).toHaveLength(0)
  })

  it('moves trees and cancels invalid drops without adding history', () => {
    const terrain = normalizeTerrain({ cells: [{ column: 4, row: 4, kind: 'water' }] })
    let editor = createEditorState([], [{ x: 50, y: 50 }], undefined, terrain)
    const input = new EditorInputController({ camera: { x: 0, y: 0, zoom: 1 }, tool: () => 'tree', surface: () => 'street', sceneryChoice: () => 'tree', editor: () => editor, dispatch: command => { editor = reduceEditor(editor, command) } })
    input.pointerDown({ id: 1, x: 50, y: 50 })
    input.pointerMove({ id: 1, x: 80, y: 80 })
    expect(input.sceneryPreview()).toEqual({ type: 'tree', index: 0, position: { x: 80, y: 80 } })
    input.pointerUp({ id: 1, x: 144, y: 144 })
    expect(editor.trees).toEqual([{ x: 50, y: 50 }])
    expect(editor.history).toHaveLength(0)
    input.pointerDown({ id: 2, x: 50, y: 50 })
    input.pointerMove({ id: 2, x: 80, y: 80 })
    input.pointerUp({ id: 2, x: 90, y: 90 })
    expect(editor.trees).toEqual([{ x: 90, y: 90 }])
    expect(reduceEditor(editor, { type: 'undo' }).trees).toEqual([{ x: 50, y: 50 }])
  })

  it('erases only visible scenery and places on empty ground', () => {
    let choice: 'erase-scenery' | 'desert-cactus' = 'erase-scenery'
    let editor = createEditorState([], [], undefined, undefined, { environmentId: 'desert', scenery: [{ kind: 'city-house', x: 100, y: 100 }, { kind: 'desert-cactus', x: 200, y: 200 }] })
    const input = new EditorInputController({ camera: { x: 0, y: 0, zoom: 1 }, tool: () => 'tree', surface: () => 'street', sceneryChoice: () => choice, editor: () => editor, dispatch: command => { editor = reduceEditor(editor, command) } })
    input.pointerDown({ id: 1, x: 100, y: 100 }); input.pointerUp({ id: 1, x: 100, y: 100 })
    expect(editor.scenery).toHaveLength(2)
    input.pointerDown({ id: 2, x: 200, y: 200 }); input.pointerUp({ id: 2, x: 200, y: 200 })
    expect(editor.scenery).toEqual([{ kind: 'city-house', x: 100, y: 100 }])
    choice = 'desert-cactus'
    input.pointerDown({ id: 3, x: 300, y: 300 }); input.pointerUp({ id: 3, x: 300, y: 300 })
    expect(editor.scenery[1]).toEqual({ kind: 'desert-cactus', x: 300, y: 300 })
  })

  it('discards a move when its source changes during the gesture', () => {
    let editor = createEditorState([], [], undefined, undefined, { environmentId: 'desert', scenery: [{ kind: 'desert-cactus', x: 100, y: 100 }] })
    const input = new EditorInputController({ camera: { x: 0, y: 0, zoom: 1 }, tool: () => 'tree', surface: () => 'street', sceneryChoice: () => 'desert-cactus', editor: () => editor, dispatch: command => { editor = reduceEditor(editor, command) } })
    input.pointerDown({ id: 1, x: 100, y: 100 })
    input.pointerMove({ id: 1, x: 140, y: 140 })
    editor = { ...editor, scenery: [{ kind: 'desert-cactus', x: 200, y: 200 }], gestureStart: null }
    input.pointerUp({ id: 1, x: 150, y: 150 })
    expect(editor.scenery[0]).toEqual({ kind: 'desert-cactus', x: 200, y: 200 })
  })
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

  it('clamps wheel and pinch zoom-out to the same road-budget floor', () => {
    const viewport = { width: 390, height: 844 }
    const floor = 844 / 15_000
    const camera: EditorCamera = { x: 0, y: 0, zoom: 0.08 }
    const input = new EditorInputController({
      camera,
      viewport: () => viewport,
      tool: () => 'pan',
      surface: () => 'street',
      editor: () => createEditorState(),
      dispatch: vi.fn(),
    })
    input.zoomBy(-10)
    expect(camera.zoom).toBeCloseTo(floor)
    camera.zoom = 0.08
    input.pointerDown({ id: 1, x: 50, y: 200 })
    input.pointerDown({ id: 2, x: 250, y: 200 })
    input.pointerMove({ id: 2, x: 100, y: 200 })
    expect(camera.zoom).toBeCloseTo(floor)
    input.pointerMove({ id: 2, x: 80, y: 200 })
    expect(camera.zoom).toBeCloseTo(floor)
    input.pointerUp({ id: 1, x: 50, y: 200 })
    input.pointerUp({ id: 2, x: 80, y: 200 })
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
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'add-point' }))
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

  it.each(['draw', 'tree'] as const)(
    'rolls back a one-finger %s edit when a second finger starts navigation',
    (tool) => {
      let editor = createEditorState()
      const dispatch = vi.fn((command: Parameters<typeof reduceEditor>[1]) => {
        editor = reduceEditor(editor, command)
      })
      const input = new EditorInputController({
        camera: { x: 0, y: 0, zoom: 1 },
        viewport: () => ({ width: 300, height: 300 }),
        tool: () => tool,
        surface: () => 'street',
        editor: () => editor,
        dispatch,
      })
      const original = editor
      input.pointerDown({ id: 1, x: 50, y: 50 })
      if (tool === 'draw') {
        input.pointerMove({ id: 1, x: 110, y: 50 })
      }
      expect(editor.points.length + editor.trees.length).toBeGreaterThan(0)
      input.pointerDown({ id: 2, x: 180, y: 50 })
      input.pointerMove({ id: 1, x: 30, y: 50 })
      input.pointerUp({ id: 1, x: 30, y: 50 })
      input.pointerUp({ id: 2, x: 180, y: 50 })
      expect(editor.points).toEqual(original.points)
      expect(editor.trees).toEqual(original.trees)
      expect(editor.history).toEqual(original.history)
      expect(editor.gestureStart).toBeNull()
      expect(dispatch).toHaveBeenCalledWith({ type: 'cancel-gesture' })
    },
  )

  it('preserves prior redo entries if a drawing touch turns into a pinch', () => {
    let editor = reduceEditor(createEditorState(), {
      type: 'add-point',
      point: { x: 10, y: 10, surface: 'street' },
    })
    editor = reduceEditor(editor, { type: 'undo' })
    expect(editor.future).toHaveLength(1)
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'draw',
      surface: () => 'street',
      editor: () => editor,
      dispatch: (command) => { editor = reduceEditor(editor, command) },
    })
    input.pointerDown({ id: 1, x: 50, y: 50 })
    expect(reduceEditor(editor, { type: 'redo' })).toBe(editor)
    input.pointerDown({ id: 2, x: 90, y: 50 })
    expect(editor.points).toHaveLength(0)
    expect(editor.history).toHaveLength(0)
    expect(editor.future).toHaveLength(1)
    expect(reduceEditor(editor, { type: 'redo' }).points).toHaveLength(1)
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

  it('selects through finger jitter without moving a point, and allows selection after a deliberate drag', () => {
    let editor = createEditorState([
      { x: 0, y: 0, surface: 'street' },
      { x: 120, y: 0, surface: 'street' },
      { x: 120, y: 120, surface: 'street' },
    ])
    const onPointSelected = vi.fn()
    const input = new EditorInputController({
      camera: { x: 0, y: 0, zoom: 1 },
      tool: () => 'select',
      surface: () => 'street',
      editor: () => editor,
      dispatch: command => { editor = reduceEditor(editor, command) },
      onPointSelected,
    })

    // A tap near the control point can wobble without starting a move.
    input.pointerDown({ id: 1, x: 35, y: 0 })
    input.pointerMove({ id: 1, x: 39, y: 2 })
    input.pointerUp({ id: 1, x: 39, y: 2 })
    expect(editor.points[0]).toMatchObject({ x: 0, y: 0 })
    expect(editor.history).toHaveLength(0)
    expect(onPointSelected).toHaveBeenLastCalledWith(0)

    // Intentional movement still edits exactly once in the undo history.
    input.pointerDown({ id: 2, x: 0, y: 0 })
    input.pointerMove({ id: 2, x: 5, y: 2 })
    expect(editor.points[0]).toMatchObject({ x: 0, y: 0 })
    input.pointerMove({ id: 2, x: 20, y: 4 })
    input.pointerUp({ id: 2, x: 20, y: 4 })
    expect(editor.points[0]).toMatchObject({ x: 20, y: 4 })
    expect(editor.history).toHaveLength(1)
    expect(onPointSelected).toHaveBeenLastCalledWith(null)

    input.pointerDown({ id: 3, x: 20, y: 4 })
    input.pointerUp({ id: 3, x: 20, y: 4 })
    expect(onPointSelected).toHaveBeenLastCalledWith(0)
    expect(editor.history).toHaveLength(1)
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
      'cancel-gesture',
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
      'cancel-gesture',
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
