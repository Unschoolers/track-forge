import { describe, expect, it } from 'vitest'
import {
  asTrackId,
  type SurfaceId,
  type Track,
  type TrackPoint,
} from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { validateTrack as validateTrackWithGeometry } from '@/domain/track/trackValidation'
import { analyzeTrack as analyzeTrackWithGeometry } from '@/domain/track/trackDiagnostics'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import {
  createEditorState,
  reduceEditor,
} from '@/domain/editor/editorState'

function closedPoints(
  count = 9,
  surface: SurfaceId = 'street',
  radius = 180,
): TrackPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / (count - 1)) * Math.PI * 2
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      surface,
    }
  })
}

function track(points: TrackPoint[]): Track {
  return {
    id: asTrackId('track-test'),
    name: 'Test Circuit',
    version: 8,
    points,
    trees: [],
    terrain: EMPTY_TERRAIN,
    lighting: 'day',
    createdAt: 100,
    updatedAt: 100,
  }
}

const geometry = new TrackGeometryService()
const validateTrack = (candidate: Track) =>
  validateTrackWithGeometry(
    candidate,
    geometry.get(candidate).path.totalLength,
  )
const analyzeTrack = (candidate: Track) =>
  analyzeTrackWithGeometry(candidate, geometry.get(candidate))

describe('validateTrack', () => {
  it('rejects tracks with fewer than nine points', () => {
    expect(validateTrack(track(closedPoints(8)))).toMatchObject({
      ready: false,
      code: 'too-few-points',
    })
  })

  it('rejects a track whose ends are not within the closure threshold', () => {
    const points = closedPoints()
    points[points.length - 1] = { x: 500, y: 500, surface: 'street' }

    expect(validateTrack(track(points))).toMatchObject({
      ready: false,
      code: 'open-loop',
    })
  })

  it('rejects non-finite coordinates and unknown surfaces at runtime', () => {
    const invalidCoordinatePoints = closedPoints()
    invalidCoordinatePoints[3] = {
      x: Number.NaN,
      y: 1,
      surface: 'street',
    }
    const invalidSurfacePoints = closedPoints()
    invalidSurfacePoints[4] = {
      x: 1,
      y: 1,
      surface: 'lava' as SurfaceId,
    }

    expect(validateTrack(track(invalidCoordinatePoints)).code).toBe(
      'invalid-data',
    )
    expect(validateTrack(track(invalidSurfacePoints)).code).toBe('invalid-data')
  })

  it('rejects a closed circuit shorter than 900 world units', () => {
    expect(validateTrack(track(closedPoints(9, 'street', 100)))).toMatchObject({
      ready: false,
      code: 'too-short',
      message: 'Track is too short',
    })
  })

  it('accepts a finite closed track with recognized surfaces', () => {
    const points: TrackPoint[] = closedPoints().map((point, index) => ({
      ...point,
      surface: index === 2 ? 'dirt' : index === 5 ? 'ice' : point.surface,
    }))

    expect(validateTrack(track(points))).toEqual({
      ready: true,
      code: 'ready',
      message: 'Track ready',
    })
  })
})

describe('createStarterTrack', () => {
  it('creates the same race-ready circuit for a given id and time', () => {
    const id = asTrackId('track-starter')
    const first = createStarterTrack(id, 1234)
    const second = createStarterTrack(id, 1234)

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      id,
      name: 'Starter Circuit',
      version: 8,
      lighting: 'day',
      createdAt: 1234,
      updatedAt: 1234,
    })
    expect(first.points).toHaveLength(32)
    expect(validateTrack(first).ready).toBe(true)
  })
})

describe('track diagnostics', () => {
  it('reports scenery on the road with an explicit repair', () => {
    const candidate = createStarterTrack(asTrackId('diagnostic'), 1)
    const point = candidate.points[5]
    if (!point) throw new Error('Expected starter point')

    expect(
      analyzeTrack({ ...candidate, trees: [{ x: point.x, y: point.y }] }),
    ).toContainEqual(
      expect.objectContaining({
        id: 'tree-on-road:0',
        repair: { type: 'remove-tree', index: 0 },
      }),
    )
  })

  it('reports authored surface road and trees in water without mutating them', () => {
    const points: TrackPoint[] = [
      { id: 'water-road', x: -200, y: 16, surface: 'street' },
      { id: 'east', x: 200, y: 16, surface: 'street' },
      { id: 'south-east', x: 200, y: 216, surface: 'street' },
      { id: 'south-west', x: -200, y: 216, surface: 'street' },
      { id: 'close', x: -200, y: 16, surface: 'street' },
    ]
    const candidate: Track = {
      ...track(points),
      trees: [{ x: 16, y: 16 }],
      terrain: {
        cellSize: 32,
        cells: [{ column: 0, row: 0, kind: 'water' }],
      },
    }

    const diagnostics = analyzeTrack(candidate)

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        id: 'surface-road-in-water:water-road',
        repair: {
          type: 'raise-road-sections',
          sectionIds: ['water-road'],
        },
      }),
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        id: 'tree-in-water:0',
        repair: { type: 'remove-tree', index: 0 },
      }),
    )
    expect(candidate.points[0]?.structure).toBeUndefined()
    expect(candidate.trees).toHaveLength(1)
  })

  it('repairs all diagnosed water-road sections in one undo transaction', () => {
    const points: TrackPoint[] = [
      { id: 'water-a', x: -200, y: 16, surface: 'street' },
      { id: 'water-b', x: 64, y: 16, surface: 'street' },
      { id: 'east', x: 200, y: 16, surface: 'street' },
      { id: 'south-east', x: 200, y: 216, surface: 'street' },
      { id: 'south-west', x: -200, y: 216, surface: 'street' },
      { id: 'close', x: -200, y: 16, surface: 'street' },
    ]
    const candidate: Track = {
      ...track(points),
      terrain: {
        cellSize: 32,
        cells: [
          { column: -1, row: 0, kind: 'water' },
          { column: 0, row: 0, kind: 'water' },
          { column: 1, row: 0, kind: 'water' },
          { column: 2, row: 0, kind: 'water' },
        ],
      },
    }
    const diagnostic = analyzeTrack(candidate).find(({ id }) =>
      id.startsWith('surface-road-in-water:'),
    )
    if (!diagnostic) throw new Error('Expected a water-road diagnostic')
    const initial = createEditorState(
      candidate.points,
      candidate.trees,
      candidate.start,
      candidate.terrain,
    )

    const repaired = reduceEditor(initial, {
      type: 'apply-track-repair',
      repair: diagnostic.repair,
    })
    const undone = reduceEditor(repaired, { type: 'undo' })

    expect(
      repaired.points
        .filter(({ id }) => id === 'water-a' || id === 'water-b')
        .map(({ structure }) => structure),
    ).toEqual(['overpass', 'overpass'])
    expect(repaired.history).toHaveLength(1)
    expect(undone.points).toEqual(initial.points)
  })

  it('reports water touching only the road footprint edge', () => {
    const points: TrackPoint[] = [
      { id: 'edge-water', x: -200, y: 48, surface: 'street' },
      { id: 'east', x: 200, y: 48, surface: 'street' },
      { id: 'south-east', x: 200, y: 248, surface: 'street' },
      { id: 'south-west', x: -200, y: 248, surface: 'street' },
      { id: 'close', x: -200, y: 48, surface: 'street' },
    ]
    const candidate: Track = {
      ...track(points),
      terrain: {
        cellSize: 32,
        cells: [{ column: 0, row: 0, kind: 'water' }],
      },
    }

    expect(analyzeTrack(candidate)).toContainEqual(
      expect.objectContaining({
        id: 'surface-road-in-water:edge-water',
        repair: {
          type: 'raise-road-sections',
          sectionIds: ['edge-water'],
        },
      }),
    )
  })

  it('maps an open path final endpoint exposure to its incoming section', () => {
    const points: TrackPoint[] = [
      { id: 'incoming', x: 11, y: 16, surface: 'street' },
      { id: 'endpoint', x: 16, y: 16, surface: 'street' },
    ]
    const candidate: Track = {
      ...track(points),
      terrain: {
        cellSize: 32,
        cells: [{ column: 0, row: 0, kind: 'water' }],
      },
    }
    const diagnostic = analyzeTrack(candidate).find(({ id }) =>
      id.startsWith('surface-road-in-water:'),
    )

    expect(diagnostic?.repair).toEqual({
      type: 'raise-road-sections',
      sectionIds: ['incoming'],
    })

    const initial = createEditorState(
      candidate.points,
      candidate.trees,
      candidate.start,
      candidate.terrain,
    )
    const repaired = diagnostic
      ? reduceEditor(initial, {
          type: 'apply-track-repair',
          repair: diagnostic.repair,
        })
      : initial
    expect(repaired.points[0]).toMatchObject({
      id: 'incoming',
      structure: 'overpass',
    })
    expect(repaired.points[1]?.structure).toBeUndefined()
  })

  it('groups closed-loop water exposure across the authored seam', () => {
    const points: TrackPoint[] = [
      { id: 'first', x: 16, y: 16, surface: 'street' },
      { id: 'east', x: 220, y: 16, surface: 'street' },
      { id: 'south-east', x: 220, y: 220, surface: 'street' },
      { id: 'last', x: 16, y: 220, surface: 'street' },
      { id: 'close', x: 16, y: 16, surface: 'street' },
    ]
    const candidate: Track = {
      ...track(points),
      terrain: {
        cellSize: 32,
        cells: [{ column: 0, row: 0, kind: 'water' }],
      },
    }
    const waterDiagnostics = analyzeTrack(candidate).filter(({ id }) =>
      id.startsWith('surface-road-in-water:'),
    )

    expect(waterDiagnostics).toHaveLength(1)
    expect(waterDiagnostics[0]?.repair).toEqual({
      type: 'raise-road-sections',
      sectionIds: ['last', 'first'],
    })
  })
})
