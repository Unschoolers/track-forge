import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { buildRaceCameraHints, findNearestSafeTrackIndex, resetVehicleToTrack } from '@/domain/race/trackContext'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { stepAiVehicle } from '@/domain/race/ai/aiDriver'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { getTrafficState } from '@/domain/race/ai/traffic'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

const path = buildRoadPath([
  { id: 'a', x: 0, y: 0, surface: 'street' },
  { id: 'b', x: 400, y: 0, surface: 'street' },
  { id: 'c', x: 400, y: 400, surface: 'street' },
], EMPTY_TERRAIN, undefined, 'point-to-point')
const vehicle = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1 }).vehicles[0]!

describe('open route endpoints', () => {
  it('keeps the camera target within the remaining route at the finish', () => {
    const index = path.points.length - 1
    const point = path.points[index]!
    const hints = buildRaceCameraHints(path, { ...vehicle, x: point.x, y: point.y, pathIndex: index, speed: 100 })
    expect(hints.target.x).toBeCloseTo(point.x)
    expect(hints.target.y).toBeCloseTo(point.y)
  })

  it('keeps safe recovery at or before the requested bound', () => {
    const index = path.points.length - 1
    const point = path.points[index]!
    expect(findNearestSafeTrackIndex(path, { ...vehicle, x: point.x, y: point.y, pathIndex: index }, false, 4)).toBeLessThanOrEqual(4)
  })

  it('pursues the finish instead of wrapping to the start', () => {
    const index = path.points.length - 2
    const point = path.points[index]!
    const end = path.points[index + 1]!
    const angle = Math.atan2(end.y - point.y, end.x - point.x)
    const rival = { ...vehicle, player: false, lane: 0, ai: createAiDriverState(0), x: point.x, y: point.y, pathIndex: index, angle, speed: 60, vx: Math.cos(angle) * 60, vy: Math.sin(angle) * 60 }
    const result = stepAiVehicle(rival, path, getTrafficState(rival, [], path), 'normal', 0.05)
    expect(Math.abs(result.ai!.steer)).toBeLessThan(0.05)
  })

  it('faces forward when reset at the finish endpoint', () => {
    const index = path.points.length - 1
    const point = path.points[index]!
    const behind = path.points[index - 4]!
    const reset = resetVehicleToTrack(vehicle, path, { pathIndex: index })
    expect(reset.angle).toBeCloseTo(Math.atan2(point.y - behind.y, point.x - behind.x))
  })
})
