import { describe, expect, it } from 'vitest'
import {
  advanceRaceCamera,
  createRaceCamera,
} from '@/phaser/camera/raceCamera'

describe('race camera', () => {
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
})
