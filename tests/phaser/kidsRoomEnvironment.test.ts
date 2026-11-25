// @vitest-environment jsdom
import type Phaser from 'phaser'
import { describe, expect, it, vi } from 'vitest'
import { asTrackId } from '@/domain/model'
import { SURFACE_SPECS } from '@/domain/config'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { decodeTrack } from '@/domain/track/trackCodec'
import {
  SCENERY_KINDS_BY_ENVIRONMENT,
  normalizeTrackEnvironmentId,
  sceneryKindBelongsToEnvironment,
} from '@/domain/track/trackEnvironment'
import { getTrackEnvironment } from '@/presentation/environments'
import { roadColorsForEnvironment } from '@/presentation/environments/roadMaterials'
import { kidsRoomRoadStrokes } from '@/presentation/environments/kidsRoomRoadStrokes'
import { buildSceneryPresentation } from '@/presentation/environments/sceneryPresentation'
import { renderTerrainPrimitives } from '@/phaser/rendering/terrainRenderer'
import { getEnvironmentTileImage } from '@/presentation/environments/environmentTileImage'

describe("Kids' Room environment", () => {
  it('round-trips authored toys and keeps old or unknown environments safe', () => {
    const starter = createStarterTrack(asTrackId('bedroom-test'), 42)
    const input = {
      ...starter,
      environmentId: 'kids-room',
      scenery: [
        { kind: 'kids-teddy', x: 90, y: 80 },
        { kind: 'kids-book', x: -60, y: 120 },
        { kind: 'kids-crayons', x: Infinity, y: 70 },
        { kind: 'unknown-toy', x: 12, y: 34 },
      ],
    }
    const decoded = decodeTrack(input, 42)
    expect(decoded?.environmentId).toBe('kids-room')
    expect(decoded?.scenery).toEqual(input.scenery.slice(0, 2))
    expect(decodeTrack(decoded, 42)?.scenery).toEqual(decoded?.scenery)
    expect(normalizeTrackEnvironmentId('unrecognized')).toBe('grass')
    expect(normalizeTrackEnvironmentId(undefined)).toBe('grass')
    expect(sceneryKindBelongsToEnvironment('kids-teddy', 'cityscape')).toBe(false)
  })

  it('gives all six toys distinct, bounded day/night art with viewport culling', () => {
    const kinds = SCENERY_KINDS_BY_ENVIRONMENT['kids-room']
    const theme = getTrackEnvironment('kids-room')
    expect(kinds).toHaveLength(6)
    expect(new Set(kinds).size).toBe(kinds.length)
    const bounds = { left: -100, top: -100, right: 100, bottom: 100 }
    for (const kind of kinds) {
      const definition = theme.scenery[kind]
      expect(definition?.radius).toBeGreaterThan(5)
      expect(definition?.day.length).toBeGreaterThan(2)
      expect(definition?.night).toHaveLength(definition?.day.length ?? 0)
      const props = [{ kind, x: 0, y: 0 }, { kind, x: 2000, y: 2000 }]
      const day = buildSceneryPresentation('kids-room', props, 'day', bounds)
      const night = buildSceneryPresentation('kids-room', props, 'night', bounds)
      expect(day).toEqual(buildSceneryPresentation('kids-room', props.slice(0, 1), 'day', bounds))
      expect(day).not.toEqual(night)
    }
  })

  it('skins the three road materials without replacing shared physics specs', () => {
    for (const surface of ['street', 'dirt', 'ice'] as const) {
      expect(roadColorsForEnvironment(surface, 'grass')).toBe(SURFACE_SPECS[surface])
      expect(roadColorsForEnvironment(surface, 'kids-room').road).not.toBe(SURFACE_SPECS[surface].road)
      expect(roadColorsForEnvironment(surface, 'kids-room').nightRoad).not.toBe(SURFACE_SPECS[surface].nightRoad)
    }
  })

  it('renders a recognizable royal-blue carpet and contrasting foam mats in both lighting modes', () => {
    const day = getTrackEnvironment('kids-room').day
    const night = getTrackEnvironment('kids-room').night
    expect(day.raceGround).toBe('#2651b1')
    expect(day.editorGround).toBe(day.flyoverGround)
    expect(night.raceGround).toBe('#122858')
    expect(day.hillPlateau).toBe(0xdd579b)
    const fibers = getTrackEnvironment('kids-room').groundArt(2, false)
    expect(fibers.length).toBeGreaterThan(1000)
    expect(fibers).toEqual(getTrackEnvironment('kids-room').groundArt(2, false))
    expect(getTrackEnvironment('kids-room').groundArt(2, true)).not.toEqual(fibers)
  })

  it('has distance-anchored toy-mat stitches, cardboard grain and plastic reflections', () => {
    const from = { x: 0, y: 0, distance: 0 }
    const to = { x: 220, y: 0, distance: 220 }
    const mat = kidsRoomRoadStrokes('street', from, to, false)
    const cardboard = kidsRoomRoadStrokes('dirt', from, to, false)
    const plastic = kidsRoomRoadStrokes('ice', from, to, false)
    expect(mat.length).toBeGreaterThan(0)
    expect(cardboard.length).toBeGreaterThan(mat.length)
    expect(plastic.length).toBeGreaterThan(0)
    expect(mat).not.toEqual(cardboard)
    expect(cardboard).not.toEqual(plastic)
    expect(kidsRoomRoadStrokes('ice', from, to, true)).not.toEqual(plastic)
    // Chunk boundaries may bisect a segment; artwork must not shift or duplicate.
    const firstHalf = { x: 110, y: 0, distance: 110 }
    expect([
      ...kidsRoomRoadStrokes('ice', from, firstHalf, false),
      ...kidsRoomRoadStrokes('ice', firstHalf, to, false),
    ]).toEqual(plastic)
    expect(kidsRoomRoadStrokes('ice', to, from, false)).toEqual([])
  })

  it('bakes stable carpet fibers once per tile variant and lighting', () => {
    const context = {
      beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), closePath: vi.fn(),
      set fillStyle(_value: string) {},
      set globalAlpha(_value: number) {},
    }
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D)
    try {
      const day = getEnvironmentTileImage('kids-room', 1, false)
      expect(day.width).toBe(384)
      expect(getEnvironmentTileImage('kids-room', 1, false)).toBe(day)
      expect(getEnvironmentTileImage('kids-room', 2, false)).not.toBe(day)
      expect(getEnvironmentTileImage('kids-room', 1, true)).not.toBe(day)
      expect(context.fill).toHaveBeenCalled()
    } finally {
      getContext.mockRestore()
    }
  })

  it('renders toy-pool water and foam hills through the shared terrain primitives', () => {
    const palette = getTrackEnvironment('kids-room').day
    const fills: number[] = []
    const strokes: number[] = []
    const graphics = {
      fillStyle: vi.fn((color: number) => { fills.push(color) }),
      lineStyle: vi.fn((_width: number, color: number) => { strokes.push(color) }),
      fillTriangle: vi.fn(), lineBetween: vi.fn(),
    } as unknown as Phaser.GameObjects.Graphics
    renderTerrainPrimitives(graphics, [
      { kind: 'water', height: 0, triangles: [], texture: [] },
      { kind: 'shoreline', height: 0, rings: [] },
      { kind: 'hill-slope', height: 24, triangles: [], facets: [] },
      { kind: 'hill-plateau', height: 24, triangles: [] },
    ], false, palette)
    expect(fills).toContain(palette.waterFill)
    expect(fills).toContain(palette.hillPlateau)
    expect(strokes).toContain(palette.waterRipple)
    expect(strokes).toContain(palette.waterShoreline)
    expect(palette.flyoverWater).toBe('#168bc4')
    expect(getTrackEnvironment('kids-room').night.waterFill).not.toBe(palette.waterFill)
  })
})
