import { describe, expect, it } from 'vitest'
import { asTrackId, type TerrainCell, type Track } from '@/domain/model'
import {
  EMPTY_TERRAIN,
  paintTerrain,
} from '@/domain/terrain/terrainField'
import {
  buildTrackGeometry,
  type TrackGeometry,
} from '@/domain/track/trackGeometry'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { buildRoadPath } from '@/domain/track/pathBuilder'

function square(): Track {
  return {
    id: asTrackId('geometry-square'),
    name: 'Geometry Square',
    version: 8,
    points: [
      { id: 'a', x: 0, y: 0, surface: 'street' },
      { id: 'b', x: 300, y: 0, surface: 'street' },
      { id: 'c', x: 300, y: 300, surface: 'street' },
      { id: 'd', x: 0, y: 300, surface: 'street' },
      { id: 'a-close', x: 0, y: 0, surface: 'street' },
    ],
    trees: [],
    terrain: EMPTY_TERRAIN,
    start: { ratio: 0.125, reversed: false },
    lighting: 'day',
    createdAt: 1,
    updatedAt: 1,
  }
}

function expectContinuousRibbon(geometry: TrackGeometry): void {
  expect(geometry.ribbon.length).toBe(geometry.path.points.length)
  for (const sample of geometry.ribbon) {
    expect(Number.isFinite(sample.left.x)).toBe(true)
    expect(Number.isFinite(sample.right.y)).toBe(true)
    expect(Math.hypot(sample.normal.x, sample.normal.y)).toBeCloseTo(1, 4)
  }
}

function rectangle(
  minimumColumn: number,
  maximumColumn: number,
  minimumRow: number,
  maximumRow: number,
): readonly Pick<TerrainCell, 'column' | 'row'>[] {
  const cells: Pick<TerrainCell, 'column' | 'row'>[] = []
  for (let row = minimumRow; row <= maximumRow; row += 1) {
    for (let column = minimumColumn; column <= maximumColumn; column += 1) {
      cells.push({ column, row })
    }
  }
  return cells
}

describe('TrackGeometry', () => {
  it('derives a continuous ribbon, start line, and ordered sectors', () => {
    const geometry = buildTrackGeometry(square())

    expectContinuousRibbon(geometry)
    expect(geometry.start.distance).toBeCloseTo(
      geometry.path.totalLength * 0.125,
      4,
    )
    expect(geometry.sectors.map((sector) => sector.order)).toEqual([1, 2, 3])
  })

  it('caches unchanged shapes and invalidates geometry changes', () => {
    const service = new TrackGeometryService()
    const track = square()
    const first = service.get(track)

    expect(service.get({ ...track, updatedAt: 99 })).toBe(first)
    expect(
      service.get({
        ...track,
        points: track.points.map((point, index) =>
          index === 1 ? { ...point, x: point.x + 1 } : point,
        ),
      }),
    ).not.toBe(first)
  })

  it('carries stable authored section elevation through path resampling', () => {
    const track = square()
    const path = buildRoadPath(
      track.points.map((point, index) =>
        index === 1 ? { ...point, structure: 'overpass' as const } : point,
      ),
      track.terrain,
    )
    const overhead = path.points.filter((point) => point.segment === 1)
    const ground = path.points.filter((point) => point.segment === 0)

    expect(overhead.length).toBeGreaterThan(0)
    expect(
      overhead.every(
        (point) =>
          point.sectionId === 'b' && point.structure === 'overpass',
      ),
    ).toBe(true)
    expect(ground.every((point) => point.structure === 'surface')).toBe(true)
  })

  it('derives one continuous run with automatic eased ramps', () => {
    const track = square()
    const path = buildRoadPath(
      track.points.map((point, index) =>
        index === 1 || index === 2
          ? { ...point, structure: 'overpass' as const }
          : point,
      ),
      track.terrain,
    )
    const samples = path.points.map((_, index) => path.roadSurface.at(index))
    const raised = samples.filter(
      ({ structureRunId }) => structureRunId !== null,
    )

    expect(new Set(raised.map(({ structureRunId }) => structureRunId))).toEqual(
      new Set(['bridge:b|c']),
    )
    expect(raised[0]?.structureHeight).toBeCloseTo(0)
    expect(Math.max(...raised.map(({ structureHeight }) => structureHeight))).toBe(
      24,
    )
    expect(samples.at(-1)?.structureHeight).toBe(0)
  })

  it('merges overhead sections across the closed-loop seam', () => {
    const track = square()
    const path = buildRoadPath(
      track.points.map((point, index) =>
        index === 0 || index === 3
          ? { ...point, structure: 'overpass' as const }
          : point,
      ),
      track.terrain,
    )

    const firstRun = path.roadSurface.at(0).structureRunId
    expect(firstRun).not.toBeNull()
    expect(path.roadSurface.at(path.points.length - 1).structureRunId).toBe(
      firstRun,
    )
  })

  it('keeps an all-overpass closed loop level through the seam', () => {
    const track = square()
    const path = buildRoadPath(
      track.points.map((point) => ({
        ...point,
        structure: 'overpass' as const,
      })),
      track.terrain,
    )
    const samples = path.points.map((_, index) => path.roadSurface.at(index))

    expect(samples.every(({ structureHeight }) => structureHeight === 24)).toBe(
      true,
    )
    expect(path.points.every((_, index) => path.roadSurface.gradeAt(index) === 0)).toBe(
      true,
    )
    expect(new Set(samples.map(({ structureRunId }) => structureRunId)).size).toBe(
      1,
    )
  })

  it('composes ground, hill, and relative overpass into three absolute levels', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(0, 24, 0, 10),
      'hill',
    )
    const geometry = buildTrackGeometry({
      points: [
        { x: -300, y: 160, surface: 'street', structure: 'overpass' },
        { x: 160, y: 160, surface: 'street', structure: 'overpass' },
        { x: 400, y: 160, surface: 'street', structure: 'surface' },
        { x: 700, y: 160, surface: 'street', structure: 'surface' },
      ],
      terrain,
    })
    const sampleNear = (x: number) => {
      const index = geometry.path.points.findIndex((point) => point.x >= x)
      return geometry.path.roadSurface.at(index)
    }

    expect(sampleNear(-150).height).toBe(24)
    expect(sampleNear(160).terrainHeight).toBe(24)
    expect(sampleNear(160).height).toBe(48)
    expect(sampleNear(520).height).toBe(24)
  })

  it('invalidates cached geometry when terrain changes', () => {
    const service = new TrackGeometryService()
    const track = square()
    const first = service.get(track)
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      [{ column: 0, row: 0 }],
      'hill',
    )

    expect(service.get({ ...track, terrain })).not.toBe(first)
  })

  it('uses immutable points and terrain identity before allocating a signature', () => {
    const service = new TrackGeometryService()
    const track = square()
    let terrainSignatureReads = 0
    const cells = new Proxy(track.terrain.cells, {
      get(target, property, receiver) {
        if (property === 'map') terrainSignatureReads += 1
        return Reflect.get(target, property, receiver)
      },
    })
    const input = {
      points: track.points,
      terrain: { ...track.terrain, cells },
      ...(track.start ? { start: track.start } : {}),
    }
    const first = service.get(input)
    const readsAfterFirstBuild = terrainSignatureReads

    expect(service.get({ ...input })).toBe(first)
    expect(terrainSignatureReads).toBe(readsAfterFirstBuild)
  })

  it('resolves immutable identity hits with constant input reads', () => {
    const service = new TrackGeometryService()
    const inputs = Array.from({ length: 24 }, (_, variant) => {
      const candidate = square()
      return {
        ...candidate,
        points: candidate.points.map((point, index) =>
          index === 1 ? { ...point, x: point.x + variant } : point,
        ),
      }
    })
    for (const input of inputs) service.get(input)
    const targetInput = inputs.at(-1)
    if (!targetInput) throw new Error('Expected an identity target')
    const targetStart = targetInput.start
    if (!targetStart) throw new Error('Expected a start configuration')
    let inputReads = 0
    const measuredInput = {
      get points() {
        inputReads += 1
        return targetInput.points
      },
      get terrain() {
        inputReads += 1
        return targetInput.terrain
      },
      get start() {
        inputReads += 1
        return targetStart
      },
    }

    expect(service.get(measuredInput)).toBe(service.get(targetInput))
    inputReads = 0
    service.get(measuredInput)

    expect(inputReads).toBeLessThanOrEqual(4)
  })

  it('evicts before retaining three worst-case terrain geometries', () => {
    const service = new TrackGeometryService()
    const baseCells = rectangle(0, 199, 0, 99).map((cell) => ({
      ...cell,
      kind: 'hill' as const,
    }))
    const inputs = [0, 1, 2].map((variant) => ({
      points: [] as const,
      terrain: {
        cellSize: 32,
        cells: baseCells.map((cell, index) =>
          index === variant
            ? { ...cell, kind: 'water' as const }
            : cell,
        ),
      },
    }))
    const firstInput = inputs[0]
    if (!firstInput) throw new Error('Expected a first cache input')
    const first = service.get(firstInput)
    for (const input of inputs.slice(1)) service.get(input)

    expect(service.get(firstInput)).not.toBe(first)
  })
})
