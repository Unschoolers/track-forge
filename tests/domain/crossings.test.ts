import { describe, expect, it } from 'vitest'
import type { TerrainCell, TrackPoint } from '@/domain/model'
import {
  EMPTY_TERRAIN,
  paintTerrain,
} from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import {
  crossingKey,
  detectTrackCrossings,
} from '@/domain/track/crossings'

const bowTie: readonly TrackPoint[] = [
  { x: -120, y: -100, surface: 'street' },
  { x: 120, y: 100, surface: 'street' },
  { x: -120, y: 100, surface: 'street' },
  { x: 120, y: -100, surface: 'street' },
  { x: -120, y: -100, surface: 'street' },
]

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

describe('track crossings', () => {
  it('derives one non-circular junction from non-adjacent branches', () => {
    const path = buildRoadPath(bowTie, EMPTY_TERRAIN)
    const crossing = detectTrackCrossings(path).find(
      (candidate) => candidate.key === crossingKey(0, 2),
    )

    expect(crossing).toBeDefined()
    expect(crossing?.upperSegment).toBeNull()
    expect(crossing?.polygon).toHaveLength(4)
    expect(Math.abs(crossing?.position.x ?? 99)).toBeLessThan(8)
    expect(Math.abs(crossing?.position.y ?? 99)).toBeLessThan(8)
  })

  it('classifies section elevation directly from both crossing heights', () => {
    const path = buildRoadPath(
      bowTie.map((point, index) =>
        index === 2
          ? { ...point, structure: 'overpass' as const }
          : point,
      ),
      EMPTY_TERRAIN,
    )
    const crossing = path.crossings.find(
      (candidate) => candidate.key === '0:2',
    )

    expect(crossing?.firstHeight).toBeCloseTo(0)
    expect(crossing?.secondHeight).toBeCloseTo(24)
    expect(crossing?.upperSegment).toBe(2)
    expect(crossing?.upperPathIndex).toBe(crossing?.secondPathIndex)
  })

  it('ignores ordinary joins and near-parallel overlaps', () => {
    const ordinary: readonly TrackPoint[] = [
      { x: 0, y: 0, surface: 'street' },
      { x: 100, y: 0, surface: 'street' },
      { x: 200, y: 2, surface: 'street' },
      { x: 300, y: 0, surface: 'street' },
    ]

    expect(
      detectTrackCrossings(buildRoadPath(ordinary, EMPTY_TERRAIN)),
    ).toEqual([])
  })

  it('compares absolute branch heights on a hill', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(-7, 6, -7, 6),
      'hill',
    )
    const path = buildRoadPath(
      bowTie.map((point, index) =>
        index === 2
          ? { ...point, structure: 'overpass' as const }
          : point,
      ),
      terrain,
    )
    const crossing = path.crossings.find(({ key }) => key === '0:2')

    expect(crossing?.firstHeight).toBeCloseTo(24)
    expect(crossing?.secondHeight).toBeCloseTo(48)
    expect(crossing?.upperSegment).toBe(2)
  })
})
