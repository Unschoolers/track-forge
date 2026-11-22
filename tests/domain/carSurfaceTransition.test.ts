import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { decodeTrack } from '@/domain/track/trackCodec'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { validateTrack } from '@/domain/track/trackValidation'

// Keep the creator's exported straight untouched. Its two-point "circuit"
// cannot race or encode a transition: the final control inherits the first
// segment's surface. Add an intermediate control only in this scenario.
const exported: unknown = JSON.parse(readFileSync('tests/fixtures/speed.trackforge.json', 'utf8'))
if (!exported || typeof exported !== 'object' || !('track' in exported)) {
  throw new Error('Speed fixture must be a Track Forge export')
}
const original = decodeTrack(exported.track, 1)
if (!original) throw new Error('Invalid Speed fixture')
const first = original.points[0]
const last = original.points[1]
if (!first || !last) throw new Error('Expected the original two-point straight')
const midpoint = {
  x: (first.x + last.x) / 2,
  y: (first.y + last.y) / 2,
  surface: 'dirt' as const,
}
const scenario = {
  ...original,
  routeKind: 'point-to-point' as const,
  points: [first, midpoint, last],
}
const path = buildRoadPath(scenario.points, scenario.terrain, Infinity, scenario.routeKind)
const dirtIndex = path.points.findIndex(point => point.surface === 'dirt')
const before = path.points[dirtIndex - 18]
const after = path.points[dirtIndex + 18]
const dt = 1 / 60

describe('actual street-to-dirt driving on the creator Speed straight', () => {
  it('builds a race-ready open scenario with a genuine surface boundary', () => {
    expect(validateTrack(scenario, path.totalLength).ready).toBe(true)
    expect(path.closed).toBe(false)
    expect(dirtIndex).toBeGreaterThan(18)
    expect(before?.surface).toBe('street')
    expect(after?.surface).toBe('dirt')
  })

  it.each(['simulation', 'arcade'] as const)(
    '%s follows the path and applies dirt traction after physically crossing its boundary',
    handling => {
      if (!before || !after) throw new Error('Missing surface transition samples')
      const startIndex = dirtIndex - 18
      const directionLength = Math.hypot(last.x - first.x, last.y - first.y)
      const direction = {
        x: (last.x - first.x) / directionLength,
        y: (last.y - first.y) / directionLength,
      }
      const starter = createRace({
        path, routeKind: scenario.routeKind,
        playerCar: 'blue', difficulty: 'normal', laps: 1, handling,
      }).vehicles[0]
      if (!starter) throw new Error('Missing blue race vehicle')
      let vehicle = {
        ...starter,
        x: before.x,
        y: before.y,
        angle: Math.atan2(direction.y, direction.x),
        vx: direction.x * 140,
        vy: direction.y * 140,
        speed: 140,
        pathIndex: startIndex,
        currentSurface: 'street' as const,
        surfaceGrip: 1,
      }
      const witnessed = new Set<string>()
      let sawBoundary = false
      let dirtGrip = 1
      for (let frame = 0; frame < 120; frame += 1) {
        const context = getVehicleStepContext(path, vehicle)
        expect(context.onRoad, `road departure on frame ${frame}`).toBe(true)
        witnessed.add(context.surface)
        vehicle = {
          ...stepVehicle(
            vehicle,
            { steering: 0, throttle: 0, braking: false },
            context,
            dt,
            handling,
          ),
          pathIndex: context.nearest.index,
        }
        if (context.surface === 'dirt') {
          sawBoundary = true
          dirtGrip = vehicle.surfaceGrip ?? 1
        }
      }
      expect(sawBoundary).toBe(true)
      expect(witnessed).toEqual(new Set(['street', 'dirt']))
      expect(dirtGrip).toBeLessThan(0.85)
      expect(vehicle.currentSurface).toBe('dirt')
      expect(vehicle.pathIndex).toBeGreaterThan(dirtIndex)
    },
  )
})
