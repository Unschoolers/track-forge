import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'
import {
  buildRoadPath,
  nearestPathPoint,
} from '@/domain/track/pathBuilder'
import {
  buildCurbSegments,
  buildStartLineTiles,
} from '@/phaser/rendering/curbRenderer'
import { buildEditorGrid } from '@/phaser/rendering/editorRenderer'
import { buildCrossingPresentation } from '@/phaser/rendering/crossingRenderer'
import type { TrackPoint } from '@/domain/model'
import { buildRoadRibbon } from '@/domain/track/trackGeometry'
import { buildRoadRibbonQuads } from '@/phaser/rendering/roadRibbonRenderer'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { buildBridgePresentation } from '@/phaser/rendering/bridgeRenderer'
import {
  buildLampPosts,
  buildLampLights,
} from '@/phaser/rendering/lampPostRenderer'
import { buildTreePresentation } from '@/phaser/rendering/treeRenderer'
import {
  EMPTY_TERRAIN,
  paintTerrain,
} from '@/domain/terrain/terrainField'
import { compileTerrainSurface } from '@/domain/terrain/terrainSurface'
import { buildTerrainPresentation } from '@/phaser/rendering/terrainRenderer'

function terrainBlock(
  column: number,
  row: number,
  width: number,
  height: number,
): readonly { readonly column: number; readonly row: number }[] {
  return Array.from({ length: width * height }, (_, index) => ({
    column: column + (index % width),
    row: row + Math.floor(index / width),
  }))
}

function terrainRow(
  minimumColumn: number,
  maximumColumn: number,
  row: number,
): readonly { readonly column: number; readonly row: number }[] {
  return Array.from(
    { length: maximumColumn - minimumColumn + 1 },
    (_, index) => ({ column: minimumColumn + index, row }),
  )
}

describe('track presentation geometry', () => {
  const track = createStarterTrack(asTrackId('presentation'), 1)
  const path = buildRoadPath(track.points, track.terrain)

  it('builds complete day and night tree silhouettes', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      terrainBlock(0, 0, 6, 6),
      'hill',
    )
    const terrainSurface = compileTerrainSurface(terrain, [])
    const day = buildTreePresentation(
      [{ x: 80, y: 80 }],
      false,
      terrainSurface,
    )
    const night = buildTreePresentation(
      [{ x: 80, y: 80 }],
      true,
      terrainSurface,
    )

    expect(day).toHaveLength(3)
    expect(day.map(({ layer }) => layer)).toEqual([
      'shadow',
      'canopy',
      'highlight',
    ])
    expect(day[1]).toMatchObject({
      x: 80,
      y: 80,
      radiusX: 15,
      radiusY: 15,
      baseHeight: WORLD_ELEVATION.levelHeight,
    })
    expect(night[1]?.color).not.toBe(day[1]?.color)
    expect(buildTreePresentation([], false, terrainSurface)).toEqual([])
  })

  it('builds cached merged terrain presentation without grid-cell borders', () => {
    const water = paintTerrain(
      EMPTY_TERRAIN,
      terrainBlock(0, 0, 4, 4),
      'water',
    )
    const terrain = paintTerrain(
      water,
      terrainBlock(7, 0, 6, 6),
      'hill',
    )
    const terrainSurface = compileTerrainSurface(terrain, [])
    const first = buildTerrainPresentation(terrainSurface)
    const second = buildTerrainPresentation(terrainSurface)
    const kinds = first.map(({ kind }) => kind)

    expect(second).toBe(first)
    expect(kinds).toEqual(expect.arrayContaining([
      'water',
      'shoreline',
      'hill-shadow',
      'hill-slope',
      'hill-plateau',
    ]))
    expect(first.some(
      (primitive) => primitive.kind === ('cell-outline' as never),
    )).toBe(false)
    expect(first.find(({ kind }) => kind === 'water')).toMatchObject({
      height: WORLD_ELEVATION.baseHeight,
    })
    expect(
      first.some(
        (primitive) =>
          primitive.kind === 'water' && primitive.texture.length > 0,
      ),
    ).toBe(true)
  })

  it('generates alternating curbs for eligible street corners', () => {
    const curbs = buildCurbSegments(path)

    expect(curbs.length).toBeGreaterThan(4)
    expect(new Set(curbs.map((curb) => curb.color))).toEqual(
      new Set(['red', 'white']),
    )
    expect(curbs.every((curb) => curb.width > 0)).toBe(true)
  })

  it('keeps the complete curb strip inside the asphalt edge', () => {
    const surfaceHalfWidth = ROAD_GEOMETRY.surfaceWidth / 2

    for (const curb of buildCurbSegments(path)) {
      const center = {
        x: (curb.start.x + curb.end.x) / 2,
        y: (curb.start.y + curb.end.y) / 2,
      }
      const nearest = nearestPathPoint(path, center)

      expect(nearest).toBeDefined()
      expect((nearest?.distance ?? Infinity) + curb.width / 2)
        .toBeLessThanOrEqual(surfaceHalfWidth + 0.01)
    }
  })

  it('places corner curbs on the inside of each turn', () => {
    for (const curb of buildCurbSegments(path)) {
      const center = {
        x: (curb.start.x + curb.end.x) / 2,
        y: (curb.start.y + curb.end.y) / 2,
      }
      const nearest = nearestPathPoint(path, center)
      const index = nearest?.index ?? -1
      const previous =
        path.points[(index - 2 + path.points.length) % path.points.length]
      const current = path.points[index]
      const next = path.points[(index + 2) % path.points.length]
      expect(previous && current && next).toBeDefined()
      if (!previous || !current || !next) continue

      const incoming = Math.atan2(
        current.y - previous.y,
        current.x - previous.x,
      )
      const outgoing = Math.atan2(next.y - current.y, next.x - current.x)
      const turn = Math.atan2(
        Math.sin(outgoing - incoming),
        Math.cos(outgoing - incoming),
      )
      const tangent = {
        x: next.x - previous.x,
        y: next.y - previous.y,
      }
      const offset = {
        x: center.x - current.x,
        y: center.y - current.y,
      }
      const curbSide = tangent.x * offset.y - tangent.y * offset.x

      expect(turn * curbSide).toBeGreaterThan(0)
    }
  })

  it('builds a continuous filled road ribbon', () => {
    const ribbon = buildRoadRibbon(path)
    const quads = buildRoadRibbonQuads(path, ribbon)

    expect(quads).toHaveLength(path.points.length)
    expect(quads[0]?.road[1]).toEqual(quads[1]?.road[0])
    expect(quads[0]?.road[2]).toEqual(quads[1]?.road[3])
  })

  it('generates a checkered start line across a closed road', () => {
    const tiles = buildStartLineTiles(path)

    expect(tiles).toHaveLength(8)
    expect(tiles.filter((tile) => tile.color === 'light')).toHaveLength(4)
    expect(tiles.filter((tile) => tile.color === 'dark')).toHaveLength(4)
  })

  it('bounds editor grid work to visible world coordinates', () => {
    const grid = buildEditorGrid(
      { left: -110, top: -60, right: 140, bottom: 120 },
      50,
    )

    expect(grid.vertical.map((line) => line.position)).toEqual([
      -100, -50, 0, 50, 100,
    ])
    expect(grid.horizontal.map((line) => line.position)).toEqual([
      -50, 0, 50, 100,
    ])
  })

  it('builds a polygonal at-grade junction without circular geometry', () => {
    const crossingPoints: readonly TrackPoint[] = [
      { x: -120, y: -100, surface: 'street' },
      { x: 120, y: 100, surface: 'street' },
      { x: -120, y: 100, surface: 'street' },
      { x: 120, y: -100, surface: 'street' },
      { x: -120, y: -100, surface: 'street' },
    ]
    const presentation = buildCrossingPresentation(
      buildRoadPath(crossingPoints, EMPTY_TERRAIN),
    )

    expect(presentation).toHaveLength(1)
    expect(presentation[0]).toMatchObject({ kind: 'junction' })
    expect(
      presentation[0]?.kind === 'junction'
        ? presentation[0].polygon
        : [],
    ).toHaveLength(4)
  })

  it('leaves elevated crossings to the continuous bridge renderer', () => {
    const crossingPoints: readonly TrackPoint[] = [
      { x: -120, y: -100, surface: 'street' },
      { x: 120, y: 100, surface: 'street' },
      { x: -120, y: 100, surface: 'street' },
      { x: 120, y: -100, surface: 'street' },
      { x: -120, y: -100, surface: 'street' },
    ]
    const elevatedPoints = crossingPoints.map((point, index) =>
      index === 2
        ? { ...point, structure: 'overpass' as const }
        : point,
    )

    expect(
      buildCrossingPresentation(
        buildRoadPath(elevatedPoints, EMPTY_TERRAIN),
      ),
    ).toEqual([])
    expect(
      buildBridgePresentation(
        buildTrackGeometry({
          ...track,
          points: elevatedPoints,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'surface' }),
      ]),
    )
  })

  it('builds a continuous curved bridge across adjacent elevated sections', () => {
    const bridgeTrack = {
      ...track,
      points: track.points.map((point, index) =>
        index >= 1 && index <= 3
          ? { ...point, structure: 'overpass' as const }
          : point,
      ),
    }
    const primitives = buildBridgePresentation(
      buildTrackGeometry(bridgeTrack),
    )
    const kinds = primitives.map((primitive) => primitive.kind)

    expect(
      kinds.filter((kind) => kind === 'shadow-soft').length,
    ).toBeGreaterThan(2)
    expect(
      kinds.filter((kind) => kind === 'shadow-core').length,
    ).toBeGreaterThan(2)
    expect(kinds).toContain('side-face')
    expect(kinds).toContain('pillar')
    expect(kinds.filter((kind) => kind === 'wall').length).toBeGreaterThan(2)
    expect(kinds.indexOf('shadow-soft')).toBeLessThan(
      kinds.indexOf('shadow-core'),
    )
    expect(kinds.indexOf('shadow-core')).toBeLessThan(
      kinds.indexOf('pillar'),
    )
    expect(kinds.indexOf('pillar')).toBeLessThan(kinds.indexOf('surface'))
    expect(kinds.indexOf('surface')).toBeLessThan(kinds.indexOf('wall'))

    const shadows = primitives.filter(
      (primitive) => primitive.kind === 'shadow-core',
    )
    const distances = shadows.map((shadow) => shadow.projectedDistance)
    expect(Math.max(...distances)).toBeGreaterThan(Math.min(...distances))
  })

  it('terminates solid overpass faces and pillars at local hill terrain', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      terrainBlock(0, 0, 20, 20),
      'hill',
    )
    const points: readonly TrackPoint[] = [
      {
        x: 64,
        y: 320,
        surface: 'street',
        structure: 'overpass',
      },
      {
        x: 320,
        y: 320,
        surface: 'street',
        structure: 'overpass',
      },
      {
        x: 576,
        y: 320,
        surface: 'street',
        structure: 'overpass',
      },
    ]
    const primitives = buildBridgePresentation(
      buildTrackGeometry({
        points,
        terrain,
        start: { ratio: 0, reversed: false },
      }),
    )
    const groundPrimitives = buildBridgePresentation(
      buildTrackGeometry({
        points,
        terrain: EMPTY_TERRAIN,
        start: { ratio: 0, reversed: false },
      }),
    )
    const deck = primitives.find(
      (primitive) =>
        primitive.kind === 'surface' &&
        primitive.deckHeights.every(
          (height) => height === WORLD_ELEVATION.levelHeight * 2,
        ),
    )
    const face = primitives.find(
      (primitive) =>
        primitive.kind === 'side-face' &&
        primitive.terrainHeights.every(
          (height) => height === WORLD_ELEVATION.levelHeight,
        ),
    )
    const pillar = primitives.find(
      (primitive) =>
        primitive.kind === 'pillar' &&
        primitive.deckHeight === WORLD_ELEVATION.levelHeight * 2,
    )
    const groundDeck = groundPrimitives.find(
      (primitive) =>
        primitive.kind === 'surface' &&
        primitive.deckHeights.every(
          (height) => height === WORLD_ELEVATION.levelHeight,
        ),
    )

    expect(deck).toMatchObject({
      deckHeights: [
        WORLD_ELEVATION.levelHeight * 2,
        WORLD_ELEVATION.levelHeight * 2,
      ],
    })
    expect(face).toMatchObject({
      terrainHeights: [
        WORLD_ELEVATION.levelHeight,
        WORLD_ELEVATION.levelHeight,
      ],
    })
    expect(pillar).toMatchObject({
      deckHeight: WORLD_ELEVATION.levelHeight * 2,
      terrainHeight: WORLD_ELEVATION.levelHeight,
    })
    expect(groundDeck).toMatchObject({
      deckHeights: [
        WORLD_ELEVATION.levelHeight,
        WORLD_ELEVATION.levelHeight,
      ],
    })
  })

  it('filters pillars by receiving material across grass and water', () => {
    const points: readonly TrackPoint[] = [
      {
        x: -320,
        y: 16,
        surface: 'street',
        structure: 'overpass',
      },
      {
        x: 0,
        y: 16,
        surface: 'street',
        structure: 'overpass',
      },
      {
        x: 320,
        y: 16,
        surface: 'street',
        structure: 'overpass',
      },
    ]
    const grassToWater = paintTerrain(
      EMPTY_TERRAIN,
      terrainRow(-20, 20, 1),
      'water',
    )
    const waterToGrass = paintTerrain(
      EMPTY_TERRAIN,
      terrainRow(-20, 20, 0),
      'water',
    )
    const pillars = (terrain: typeof grassToWater) =>
      buildBridgePresentation(
        buildTrackGeometry({
          points,
          terrain,
          start: { ratio: 0, reversed: false },
        }),
      ).filter(({ kind }) => kind === 'pillar')

    expect(pillars(grassToWater)).toEqual([])
    expect(pillars(waterToGrass).length).toBeGreaterThan(0)
  })

  it('generates deterministic, denser bridge lighting beyond the road edge', () => {
    const litTrack = {
      ...track,
      points: track.points.map((point, index) =>
        index >= 1 && index <= 3
          ? { ...point, structure: 'overpass' as const }
          : point,
      ),
    }
    const geometry = buildTrackGeometry(litTrack)
    const first = buildLampPosts(geometry)
    const second = buildLampPosts(geometry)

    expect(second).toEqual(first)
    expect(first.some(({ bridge }) => bridge)).toBe(true)
    expect(first.some(({ bridge }) => !bridge)).toBe(true)
    expect(
      first.every(({ position }) =>
        (nearestPathPoint(geometry.path, position)?.distance ?? 0) >
        ROAD_GEOMETRY.edgeWidth / 2,
      ),
    ).toBe(true)
    expect(
      first
        .filter(({ bridge }) => bridge)
        .every(({ spacing }) => spacing === 90),
    ).toBe(true)
    expect(
      first
        .filter(({ bridge }) => !bridge)
        .every(({ spacing }) => spacing === 150),
    ).toBe(true)
    expect(
      first.every(({ pathDistance }) => {
        const direct = Math.abs(pathDistance - geometry.start.distance)
        const wrapped = geometry.path.totalLength - direct
        return Math.min(direct, wrapped) >= 72
      }),
    ).toBe(true)

    const lights = buildLampLights(first)
    expect(lights).toHaveLength(first.length)
    expect(lights.every(({ radius, intensity }) =>
      radius > 0 && intensity > 0,
    )).toBe(true)
  })
})
