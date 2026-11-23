import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { interpolateRaceCameraHints, interpolateRaceVehicles } from '@/phaser/rendering/raceInterpolation'

const path = buildRoadPath([
  { x: 0, y: 0, surface: 'street', curve: 'corner' },
  { x: 200, y: 0, surface: 'street', curve: 'corner' },
  { x: 200, y: 200, surface: 'street', curve: 'corner' },
], EMPTY_TERRAIN)

function player() {
  const vehicle = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1 }).vehicles
    .find((entry) => entry.player)
  if (!vehicle) throw new Error('Missing player fixture')
  return vehicle
}

describe('race presentation interpolation', () => {
  it('blends position, height and rotation along the short angular path without changing physics fields', () => {
    const previous = { ...player(), x: 10, y: 30, z: 5, angle: Math.PI - 0.1,
      suspensionCompression: 0, landingIntensity: 0, speed: 120, lap: 1 }
    const current = { ...previous, x: 20, y: 50, z: 15, angle: -Math.PI + 0.1,
      suspensionCompression: 0.4, landingIntensity: 0.6, speed: 180, lap: 2 }
    const [visual] = interpolateRaceVehicles([previous], [current], 0.5, new Set())
    expect(visual?.x).toBe(15)
    expect(visual?.y).toBe(40)
    expect(visual?.z).toBe(10)
    expect(Math.cos(visual?.angle ?? 0)).toBeCloseTo(-1, 5)
    expect(visual?.suspensionCompression).toBeCloseTo(0.2)
    expect(visual?.landingIntensity).toBeCloseTo(0.3)
    // Domain values must remain the current authoritative tick, never a blend.
    expect(visual?.speed).toBe(180)
    expect(visual?.lap).toBe(2)
    expect(current.x).toBe(20)
  })

  it('snaps instead of sliding through recoveries, teleports or different bridge decks', () => {
    const previous = { ...player(), x: 0, y: 0 }
    const jumped = { ...previous, x: 500, y: 600 }
    expect(interpolateRaceVehicles([previous], [jumped], 0.5, new Set())[0]).toBe(jumped)
    const recovered = { ...previous, x: 5 }
    expect(interpolateRaceVehicles([previous], [recovered], 0.5,
      new Set([previous.id]))[0]).toBe(recovered)
    const bridge = { ...previous, structureRunId: 'overpass' }
    expect(interpolateRaceVehicles([previous], [bridge], 0.5, new Set())[0]).toBe(bridge)
    expect(interpolateRaceVehicles([], [bridge], 0.5, new Set())[0]).toBe(bridge)
  })

  it('does not extrapolate beyond the current tick or interpolate invalid alpha', () => {
    const previous = { ...player(), x: 0 }
    const current = { ...previous, x: 10 }
    for (const alpha of [1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(interpolateRaceVehicles([previous], [current], alpha, new Set())).toBe([current])
    }
    expect(interpolateRaceVehicles([previous], [current], -1, new Set())[0]?.x).toBe(0)
  })

  it('interpolates the camera target and first preview point with the car timeline', () => {
    const previous = {
      target: { x: 0, y: 10 }, preview: [{ x: 5, y: 15 }, { x: 100, y: 50 }],
      roadAngle: Math.PI - 0.1, upcomingCurve: 0, speed: 100, shake: 0,
    }
    const current = {
      target: { x: 20, y: 30 }, preview: [{ x: 25, y: 35 }, { x: 100, y: 50 }],
      roadAngle: -Math.PI + 0.1, upcomingCurve: 0.5, speed: 200, shake: 2,
    }
    const visual = interpolateRaceCameraHints(previous, current, 0.5, false)
    expect(visual.target).toEqual({ x: 10, y: 20 })
    expect(visual.preview?.[0]).toEqual({ x: 15, y: 25 })
    expect(Math.cos(visual.roadAngle)).toBeCloseTo(-1, 5)
    expect(visual.speed).toBe(150)
    expect(visual.shake).toBe(1)
    expect(interpolateRaceCameraHints(previous, current, 0.5, true)).toBe(current)
  })
})
