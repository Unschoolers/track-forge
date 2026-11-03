import { describe, expect, it } from 'vitest'
import {
  applyEditorCommand,
  createEditorState,
  patchEditorState,
  reduceEditor,
} from '@/domain/editor/editorState'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import type { TrackPoint } from '@/domain/model'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { paintTerrain } from '@/domain/terrain/terrainField'

const square: TrackPoint[] = [
  { x: 0, y: 0, surface: 'street' },
  { x: 100, y: 0, surface: 'street' },
  { x: 100, y: 100, surface: 'dirt' },
  { x: 0, y: 100, surface: 'ice' },
  { x: 0, y: 0, surface: 'street' },
]

describe('buildRoadPath', () => {
  it('samples a closed path with finite cumulative distance', () => {
    const path = buildRoadPath(square, EMPTY_TERRAIN)
    expect(path.points.length).toBeGreaterThan(square.length)
    expect(path.totalLength).toBeGreaterThan(300)
    expect(path.points.every((point) => Number.isFinite(point.distance))).toBe(
      true,
    )
    const nearest = nearestPathPoint(path, { x: 50, y: 4 })
    expect(nearest?.distance).toBeLessThan(18)
    expect(nearest?.point.x).toBeCloseTo(50, -1)
  })

  it('keeps clustered corner samples finite without reversing tangents', () => {
    const clustered: readonly TrackPoint[] = [
      { x: 0, y: 0, surface: 'street' },
      { x: 180, y: 0, surface: 'street' },
      { x: 188, y: 1, surface: 'street' },
      { x: 190, y: 12, surface: 'street' },
      { x: 190, y: 190, surface: 'street' },
    ]
    const path = buildRoadPath(clustered, EMPTY_TERRAIN)

    expect(path.points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    )).toBe(true)
    for (let index = 1; index < path.points.length; index += 1) {
      const previous = path.points[index - 1]
      const current = path.points[index]
      if (!previous || !current) continue
      const source = clustered[current.segment]
      const target = clustered[current.segment + 1]
      if (!source || !target) continue
      const sampleX = current.x - previous.x
      const sampleY = current.y - previous.y
      const chordX = target.x - source.x
      const chordY = target.y - source.y
      expect(sampleX * chordX + sampleY * chordY).toBeGreaterThanOrEqual(-0.01)
    }
    const headings: number[] = []
    for (let index = 1; index < path.points.length; index += 1) {
      const previous = path.points[index - 1]
      const current = path.points[index]
      if (!previous || !current) continue
      headings.push(Math.atan2(current.y - previous.y, current.x - previous.x))
    }
    const largestHeadingStep = headings.slice(1).reduce(
      (largest, heading, index) => {
        const previous = headings[index] ?? heading
        const difference = Math.abs(
          Math.atan2(
            Math.sin(heading - previous),
            Math.cos(heading - previous),
          ),
        )
        return Math.max(largest, difference)
      },
      0,
    )
    expect(largestHeadingStep).toBeLessThan(0.24)
  })
})

describe('reduceEditor', () => {
  it('merges partial editor patches through one history path', () => {
    const initial = createEditorState(
      square,
      [{ x: 50, y: 150 }],
      { ratio: 0.25, reversed: true },
    )
    const points = initial.points.map((point, index) =>
      index === 0 ? { ...point, x: 12 } : point,
    )

    const next = patchEditorState(initial, { points })

    expect(next.points).toBe(points)
    expect(next.trees).toBe(initial.trees)
    expect(next.start).toBe(initial.start)
    expect(next.history).toHaveLength(1)
  })

  it('applies edits immutably and supports undo and redo', () => {
    const initial = createEditorState(square)
    const drawn = reduceEditor(initial, {
      type: 'add-point',
      point: { x: 20, y: 20, surface: 'street' },
    })
    const painted = reduceEditor(drawn, {
      type: 'paint-point',
      index: 0,
      surface: 'ice',
    })
    const undone = reduceEditor(painted, { type: 'undo' })
    const redone = reduceEditor(undone, { type: 'redo' })

    expect(initial.points).toHaveLength(5)
    expect(drawn.points).toHaveLength(6)
    expect(painted.points[0]?.surface).toBe('ice')
    expect(undone.points[0]?.surface).toBe('street')
    expect(redone.points[0]?.surface).toBe('ice')
  })

  it('caps history and safely ignores invalid indices', () => {
    let state = createEditorState(square)
    for (let index = 0; index < 60; index += 1) {
      state = reduceEditor(state, {
        type: 'add-tree',
        tree: { x: index, y: index },
      })
    }
    const unchanged = reduceEditor(state, {
      type: 'move-point',
      index: 999,
      point: { x: 1, y: 1 },
    })

    expect(state.history).toHaveLength(50)
    expect(unchanged).toBe(state)
  })

  it('rejects non-finite and in-water tree placement at the domain boundary', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      [{ column: 0, row: 0 }],
      'water',
    )
    const initial = createEditorState([], [], undefined, terrain)

    expect(
      reduceEditor(initial, {
        type: 'add-tree',
        tree: { x: Number.NaN, y: 16 },
      }),
    ).toBe(initial)
    expect(
      reduceEditor(initial, {
        type: 'add-tree',
        tree: { x: 16, y: 16 },
      }),
    ).toBe(initial)

    const dry = reduceEditor(initial, {
      type: 'add-tree',
      tree: { x: 48, y: 16 },
    })
    expect(dry.trees).toEqual([{ x: 48, y: 16 }])
    expect(dry.history).toHaveLength(1)
  })

  it('reports out-of-bounds terrain paint without changing editor state', () => {
    const initial = createEditorState()
    const result = applyEditorCommand(initial, {
      type: 'paint-terrain',
      cells: [{ column: 2_049, row: 0 }],
      kind: 'hill',
    })

    expect(result).toEqual({
      state: initial,
      rejection: expect.objectContaining({
        code: 'terrain-coordinate-bounds',
      }),
    })
  })

  it('records a multi-sample gesture as one undo step', () => {
    let state = reduceEditor(createEditorState(), {
      type: 'begin-gesture',
    })
    for (let index = 0; index < 20; index += 1) {
      state = reduceEditor(state, {
        type: 'add-point',
        point: { x: index * 30, y: 0, surface: 'street' },
      })
    }
    state = reduceEditor(state, { type: 'end-gesture' })

    expect(state.points).toHaveLength(20)
    expect(state.history).toHaveLength(1)
    expect(reduceEditor(state, { type: 'undo' }).points).toEqual([])
  })

  it('undoes and redoes an interrupted in-flight gesture', () => {
    const initial = createEditorState(square)
    const editing = reduceEditor(
      reduceEditor(initial, { type: 'begin-gesture' }),
      {
        type: 'move-point',
        index: 0,
        point: { x: 55, y: 66 },
      },
    )

    const undone = reduceEditor(editing, { type: 'undo' })
    const redone = reduceEditor(undone, { type: 'redo' })

    expect(undone.points).toEqual(square)
    expect(undone.gestureStart).toBeNull()
    expect(redone.points[0]).toMatchObject({ x: 55, y: 66 })
  })

  it('finalizes a draw gesture inside the same undo transaction', () => {
    let state = reduceEditor(createEditorState(), { type: 'begin-gesture' })
    for (let index = 0; index < 40; index += 1) {
      state = reduceEditor(state, {
        type: 'add-point',
        point: {
          x: index * 10,
          y: Math.sin(index) * 2,
          surface: 'street',
        },
      })
    }
    state = reduceEditor(state, {
      type: 'finalize-draw',
      startIndex: 0,
      zoom: 1,
    })
    state = reduceEditor(state, { type: 'end-gesture' })

    expect(state.points.length).toBeLessThanOrEqual(5)
    expect(state.history).toHaveLength(1)
    expect(reduceEditor(state, { type: 'undo' }).points).toEqual([])
  })

  it('does not add history for a gesture that changes nothing', () => {
    let state = reduceEditor(createEditorState(square), {
      type: 'begin-gesture',
    })
    state = reduceEditor(state, {
      type: 'move-point',
      index: 999,
      point: { x: 4, y: 5 },
    })
    state = reduceEditor(state, { type: 'end-gesture' })

    expect(state.history).toEqual([])
  })

  it('expands the editable world and undoes it atomically', () => {
    const initial = createEditorState(square, [{ x: 50, y: 150 }])
    const expanded = reduceEditor(initial, {
      type: 'expand',
      factor: 2,
    })

    expect(expanded.points[0]).toEqual({ x: -50, y: -75, surface: 'street' })
    expect(expanded.trees[0]).toEqual({ x: 50, y: 225 })
    expect(reduceEditor(expanded, { type: 'undo' }).points).toEqual(square)
  })

  it('paints several elevated sections as one undoable gesture', () => {
    let state = reduceEditor(createEditorState(square), {
      type: 'begin-gesture',
    })
    state = reduceEditor(state, {
      type: 'paint-section-structure',
      index: 0,
      structure: 'overpass',
    })
    state = reduceEditor(state, {
      type: 'paint-section-structure',
      index: 1,
      structure: 'overpass',
    })
    state = reduceEditor(state, { type: 'end-gesture' })

    expect(state.points.slice(0, 2).map((point) => point.structure)).toEqual([
      'overpass',
      'overpass',
    ])
    expect(reduceEditor(state, { type: 'undo' }).points).toEqual(square)
  })

  it('raises stable section ids in one repair snapshot and ignores repeats', () => {
    const points = square.map((point, index) => ({
      ...point,
      id: `section-${index}`,
    }))
    const initial = createEditorState(points)
    const repaired = reduceEditor(initial, {
      type: 'apply-track-repair',
      repair: {
        type: 'raise-road-sections',
        sectionIds: ['section-0', 'section-1'],
      },
    })
    const repeated = reduceEditor(repaired, {
      type: 'apply-track-repair',
      repair: {
        type: 'raise-road-sections',
        sectionIds: ['section-0', 'section-1'],
      },
    })

    expect(repaired.points.slice(0, 2).map(({ structure }) => structure))
      .toEqual(['overpass', 'overpass'])
    expect(repaired.history).toHaveLength(1)
    expect(repeated).toBe(repaired)
  })

  it('uses crossing shortcuts to paint the selected branch sections', () => {
    const raised = reduceEditor(createEditorState(square), {
      type: 'set-crossing-sections',
      firstSegment: 0,
      secondSegment: 2,
      upperSegment: 2,
    })
    const flat = reduceEditor(raised, {
      type: 'set-crossing-sections',
      firstSegment: 0,
      secondSegment: 2,
      upperSegment: null,
    })

    expect(raised.points[0]?.structure).toBe('surface')
    expect(raised.points[2]?.structure).toBe('overpass')
    expect(flat.points[2]?.structure).toBe('surface')
  })

  it('edits curve intent and clamps point tension', () => {
    const initial = createEditorState(square)
    const corner = reduceEditor(initial, {
      type: 'set-point-curve',
      index: 1,
      curve: 'corner',
    })
    const tensioned = reduceEditor(corner, {
      type: 'set-point-tension',
      index: 1,
      tension: 2,
    })

    expect(tensioned.points[1]).toMatchObject({
      curve: 'corner',
      tension: 1,
    })
    expect(reduceEditor(tensioned, { type: 'undo' }).points[1]?.curve).toBe(
      'corner',
    )
  })
})
