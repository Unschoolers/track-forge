import { describe, expect, it } from 'vitest'
import { SURFACE_SPECS } from '@/domain/config'
import type { SurfaceId } from '@/domain/model'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { getGrassTexture, GRASS_ENVIRONMENT } from '@/presentation/environments/grass'
import { getTrackEnvironment } from '@/presentation/environments'
import { environmentRoadStrokes } from '@/presentation/environments/environmentRoadStrokes'
import { roadColorsForEnvironment } from '@/presentation/environments/roadMaterials'
import { kidsRoomRoadStrokes } from '@/presentation/environments/kidsRoomRoadStrokes'

const settings = ['grass', 'desert', 'cityscape'] as const satisfies readonly TrackEnvironmentId[]
const surfaces = ['street', 'dirt', 'ice'] as const satisfies readonly SurfaceId[]
const from = { x: 0, y: 0, distance: 0 }
const middle = { x: 144, y: 0, distance: 144 }
const to = { x: 288, y: 0, distance: 288 }

function roundStrokes(strokes: ReturnType<typeof environmentRoadStrokes>) {
  return strokes.map((stroke) => ({
    ...stroke,
    start: { x: +stroke.start.x.toFixed(5), y: +stroke.start.y.toFixed(5) },
    end: { x: +stroke.end.x.toFixed(5), y: +stroke.end.y.toFixed(5) },
  }))
}

describe('environment material contracts', () => {
  it('gives each non-bedroom environment stable, distinctive ground grain across variants and lighting', () => {
    for (const environment of settings) {
      if (environment === 'grass') {
        const day = getGrassTexture(2, false)
        expect(day.length).toBeGreaterThan(250)
        expect(day).toBe(getGrassTexture(2, false))
        expect(day).not.toEqual(getGrassTexture(3, false))
        expect(day).not.toEqual(getGrassTexture(2, true))
      } else {
        const theme = getTrackEnvironment(environment)
        const day = theme.groundArt(2, false)
        expect(day.length).toBeGreaterThan(250)
        expect(day).toEqual(theme.groundArt(2, false))
        expect(day).not.toEqual(theme.groundArt(3, false))
        expect(day).not.toEqual(theme.groundArt(2, true))
        expect(new Set(day.map((mark) => mark.color)).size).toBeGreaterThan(2)
      }
    }
  })

  it('keeps editor, race and flyover ground colors aligned at both times of day', () => {
    for (const environment of settings) {
      const definition = getTrackEnvironment(environment)
      for (const lighting of ['day', 'night'] as const) {
        const palette = definition[lighting]
        expect(palette.editorGround).toBe(palette.raceGround)
        expect(palette.flyoverGround).toBe(palette.raceGround)
      }
    }
    expect(GRASS_ENVIRONMENT.day.raceGround).not.toBe(getTrackEnvironment('desert').day.raceGround)
  })

  it('draws distinct world-distance anchored materials for every road surface and theme', () => {
    for (const environment of settings) {
      const perSurface = surfaces.map((surface) => {
        const strokes = environmentRoadStrokes(environment, surface, from, to, false)
        const combined = [
          ...environmentRoadStrokes(environment, surface, from, middle, false),
          ...environmentRoadStrokes(environment, surface, middle, to, false),
        ]
        expect(strokes.length).toBeGreaterThan(3)
        expect(roundStrokes(combined)).toEqual(roundStrokes(strokes))
        expect(environmentRoadStrokes(environment, surface, from, to, true)).not.toEqual(strokes)
        for (const stroke of strokes) {
          expect(stroke.start.y).toBeGreaterThanOrEqual(-35)
          expect(stroke.start.y).toBeLessThanOrEqual(35)
          expect(stroke.end.y).toBeGreaterThanOrEqual(-35)
          expect(stroke.end.y).toBeLessThanOrEqual(35)
        }
        return strokes
      })
      expect(perSurface[0]).not.toEqual(perSurface[1])
      expect(perSurface[1]).not.toEqual(perSurface[2])
    }
  })

  it('leaves physics authority untouched and keeps malformed segments inert', () => {
    for (const surface of surfaces) {
      expect(roadColorsForEnvironment(surface, 'grass')).toBe(SURFACE_SPECS[surface])
      expect(roadColorsForEnvironment(surface, 'cityscape')).not.toBe(SURFACE_SPECS[surface])
      expect(roadColorsForEnvironment(surface, 'desert')).not.toBe(SURFACE_SPECS[surface])
    }
    expect(environmentRoadStrokes('cityscape', 'ice', to, from, false)).toEqual([])
    expect(environmentRoadStrokes('grass', 'street', from, from, false)).toEqual([])
    expect(environmentRoadStrokes('desert', 'dirt', from,
      { ...to, distance: Number.POSITIVE_INFINITY }, false)).toEqual([])
  })

  it('preserves the Kids Room generator exactly', () => {
    expect(environmentRoadStrokes('kids-room', 'ice', from, to, false))
      .toEqual(kidsRoomRoadStrokes('ice', from, to, false))
  })
})
