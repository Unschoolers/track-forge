import { describe, expect, it } from 'vitest'
import {
  advanceRaceCamera,
  createRaceCamera,
} from '@/phaser/camera/raceCamera'
import { createRace } from '@/domain/race/raceFactory'
import { buildRaceCameraHints } from '@/domain/race/trackContext'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'

describe('race camera', () => {
  it('caps camera rotation on abrupt route-heading discontinuities', () => {
    const camera = createRaceCamera({ x: 0, y: 0, angle: 0 })
    const next = advanceRaceCamera(
      camera,
      { target: { x: 100, y: 0 }, roadAngle: Math.PI, upcomingCurve: 1, speed: 250, shake: 0 },
      { dynamicZoom: true, steering: 1 },
      1 / 60,
    )
    expect(Math.abs(next.angle)).toBeLessThanOrEqual(2.3 / 60 + 0.00001)
  })

  it('starts close enough for the player car to remain readable', () => {
    expect(createRaceCamera({ x: 0, y: 0, angle: 0 }).zoom).toBe(1.2)
  })

  it('smoothly follows position and rotates toward curved road headings', () => {
    const camera = createRaceCamera({ x: 0, y: 0, angle: 0 })
    const next = advanceRaceCamera(
      camera,
      {
        target: { x: 100, y: 50 },
        roadAngle: Math.PI / 2,
        upcomingCurve: 0.32,
        speed: 180,
        shake: 0,
      },
      { dynamicZoom: true, steering: 0.8 },
      0.1,
    )

    expect(next.x).toBeGreaterThan(0)
    expect(next.x).toBeLessThan(100)
    expect(next.angle).toBeGreaterThan(0)
    expect(next.angle).toBeLessThan(Math.PI / 2)
    expect(next.zoom).toBeGreaterThan(0.98)
  })

  it('uses a stable fixed zoom when dynamic zoom is disabled', () => {
    const camera = { ...createRaceCamera({ x: 0, y: 0, angle: 0 }), zoom: 0.9 }
    const next = advanceRaceCamera(
      camera,
      {
        target: { x: 0, y: 0 },
        roadAngle: 0,
        upcomingCurve: 0,
        speed: 300,
        shake: 0,
      },
      { dynamicZoom: false, steering: 0 },
      1,
    )

    expect(next.zoom).toBeCloseTo(1.18, 2)
    expect(next.angle).toBe(0)
  })

  it('keeps the car readable on a high-speed straight', () => {
    let camera = createRaceCamera({ x: 0, y: 0, angle: 0 })
    for (let frame = 0; frame < 12; frame += 1) {
      camera = advanceRaceCamera(
        camera,
        {
          target: { x: 0, y: 0 },
          roadAngle: 0,
          upcomingCurve: 0,
          speed: 300,
          shake: 0,
        },
        { dynamicZoom: true, steering: 0 },
        0.5,
      )
    }

    expect(camera.zoom).toBeGreaterThanOrEqual(1.15)
  })

  it('moves closer for corners without losing the closer straight framing', () => {
    let straight = createRaceCamera({ x: 0, y: 0, angle: 0 })
    let corner = createRaceCamera({ x: 0, y: 0, angle: 0 })
    for (let frame = 0; frame < 20; frame += 1) {
      straight = advanceRaceCamera(
        straight,
        {
          target: { x: 0, y: 0 },
          roadAngle: 0,
          upcomingCurve: 0,
          speed: 220,
          shake: 0,
        },
        { dynamicZoom: true, steering: 0 },
        0.25,
      )
      corner = advanceRaceCamera(
        corner,
        {
          target: { x: 0, y: 0 },
          roadAngle: 0.35,
          upcomingCurve: 0.4,
          speed: 220,
          shake: 0,
        },
        { dynamicZoom: true, steering: 0.5 },
        0.25,
      )
    }

    expect(straight.zoom).toBeGreaterThanOrEqual(1.16)
    expect(corner.zoom).toBeGreaterThan(straight.zoom)
    expect(corner.zoom).toBeGreaterThanOrEqual(1.24)
  })

  it('frames the side of a fast approach where the road turns on a narrow phone', () => {
    const path = buildRoadPath([
      { x: -300, y: 0, surface: 'street', curve: 'corner' },
      { x: 110, y: 0, surface: 'street', curve: 'corner' },
      { x: 110, y: 380, surface: 'street', curve: 'corner' },
    ], EMPTY_TERRAIN)
    const player = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1 }).vehicles[0]
    const approach = nearestPathPoint(path, { x: 70, y: 0 })
    if (!player || !approach) throw new Error('Missing corner approach fixture')
    const car = {
      ...player, x: 70, y: 0, speed: 300, angle: 0,
      pathIndex: approach.index, pathDistance: approach.point.distance,
    }
    const hints = buildRaceCameraHints(path, car)
    const options = { dynamicZoom: true, steering: 0 }
    const camera = createRaceCamera(car)
    const phone = advanceRaceCamera(camera, hints, {
      ...options, viewport: { width: 320, height: 640 },
    }, 1)
    const wide = advanceRaceCamera(camera, hints, {
      ...options, viewport: { width: 800, height: 640 },
    }, 1)

    expect(phone.y).toBeGreaterThan(40)
    expect(phone.zoom).toBeLessThan(wide.zoom)
    expect(phone.zoom).toBeGreaterThan(1)
  })
})
