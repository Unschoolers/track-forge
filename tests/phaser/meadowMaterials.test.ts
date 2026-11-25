import { describe, expect, it } from 'vitest'
import { meadowGroundPatches } from '@/presentation/environments/meadowGroundPatches'
import { MEADOW_ROAD_TILE_LENGTH, meadowRoadTileStrokes } from '@/presentation/environments/meadowRoadTile'
import { GROUND_TILE_SIZE } from '@/presentation/environments/groundTexture'
import { GRASS_ENVIRONMENT } from '@/presentation/environments/grass'
import { MAX_SHORELINE_HALF_WIDTH, shorelineBands } from '@/presentation/environments/shorelineMaterials'
import { chunkRaceTerrain } from '@/phaser/rendering/raceTerrainChunks'
import { buildRoadRibbonQuads } from '@/phaser/rendering/roadRibbonRenderer'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

const at = (distance: number) => ({ x: distance, y: 0, distance })

describe('Meadow layered materials', () => {
  it('generates repeatable organic patches, distinct variants and day/night art inside tile padding', () => {
    for (let variant = 0; variant < 8; variant++) {
      const day = meadowGroundPatches(variant, false)
      const night = meadowGroundPatches(variant, true)
      expect(day).toEqual(meadowGroundPatches(variant, false))
      expect(day).not.toEqual(meadowGroundPatches(variant + 1, false))
      expect(day).not.toEqual(night)
      expect(day.length).toBeGreaterThan(200)
      expect(day.length).toBeLessThan(400)
      for (const mark of day) {
        expect(mark.x - mark.radiusX).toBeGreaterThanOrEqual(-64)
        expect(mark.y - mark.radiusY).toBeGreaterThanOrEqual(-64)
        expect(mark.x + mark.radiusX).toBeLessThanOrEqual(GROUND_TILE_SIZE + 64)
        expect(mark.y + mark.radiusY).toBeLessThanOrEqual(GROUND_TILE_SIZE + 64)
      }
    }
  })

  it.each(['street', 'dirt', 'ice'] as const)('repeats the %s tile in path coordinates without chunk resets', surface => {
    const length = MEADOW_ROAD_TILE_LENGTH
    const first = meadowRoadTileStrokes(surface, at(0), at(length), false)
    const second = meadowRoadTileStrokes(surface, at(length), at(length * 2), false)
    const shift = (strokes: typeof first) => strokes.map(stroke => ({
      ...stroke,
      start: { ...stroke.start, x: stroke.start.x - length },
      end: { ...stroke.end, x: stroke.end.x - length },
    }))
    expect(first).toHaveLength(40)
    expect(shift(second)).toEqual(first)
    expect([
      ...meadowRoadTileStrokes(surface, at(0), at(67), false),
      ...meadowRoadTileStrokes(surface, at(67), at(length), false),
    ].map(stroke => ({ ...stroke, start: { ...stroke.start, x: Math.round(stroke.start.x * 1e6) / 1e6 },
      end: { ...stroke.end, x: Math.round(stroke.end.x * 1e6) / 1e6 } }))).toEqual(first)
    expect(meadowRoadTileStrokes(surface, at(0), at(length), true)).not.toEqual(first)
    expect(meadowRoadTileStrokes(surface, at(50), at(50), false)).toEqual([])
  })

  it('fits complete texture repeats to a closed lap and carries the final ribbon distance', () => {
    const loopLength = 1000
    const strokes = meadowRoadTileStrokes('street', at(975), at(loopLength), false, loopLength)
    expect(strokes).toHaveLength(5)
    expect(strokes[0]?.start.x).toBeCloseTo(loopLength - 5)
    const geometry = buildTrackGeometry({
      points: [
        { x: 0, y: 0, surface: 'street' },
        { x: 300, y: 0, surface: 'street' },
        { x: 300, y: 300, surface: 'street' },
        { x: 0, y: 300, surface: 'street' },
        { x: 0, y: 0, surface: 'street' },
      ],
      terrain: EMPTY_TERRAIN,
    })
    expect(geometry.path.closed).toBe(true)
    expect(buildRoadRibbonQuads(geometry.path, geometry.ribbon).at(-1)?.to.distance).toBe(geometry.path.totalLength)
  })

  it('keeps bank bands day/night distinct and includes their full stroke in terrain culling', () => {
    const day = shorelineBands(GRASS_ENVIRONMENT.day, false)
    const night = shorelineBands(GRASS_ENVIRONMENT.night, true)
    expect(day.map(band => band.width)).toEqual([18, 12, 6, 1.6])
    expect(night).not.toEqual(day)
    const chunks = chunkRaceTerrain([{ kind: 'shoreline', height: 0, rings: [[
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ]] }])
    expect(chunks[0]?.bounds.left).toBeLessThanOrEqual(-MAX_SHORELINE_HALF_WIDTH)
    expect(chunks[0]?.bounds.right).toBeGreaterThanOrEqual(10 + MAX_SHORELINE_HALF_WIDTH)
  })
})
