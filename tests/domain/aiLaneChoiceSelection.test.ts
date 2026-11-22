import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { choosePassingLane, scorePassingLane } from '@/domain/race/ai/lanePlanner'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { createRace } from '@/domain/race/raceFactory'
import { buildRoadPath } from '@/domain/track/pathBuilder'

const track = createStarterTrack(asTrackId('lane-choice'), 1)
const race = createRace({ path: buildRoadPath(track.points, track.terrain), playerCar: 'blue', difficulty: 'normal', laps: 2 })
const vehicle = race.vehicles[1]
if (!vehicle) throw new Error('Missing rival vehicle fixture')

describe('passing lane candidate evaluation', () => {
  it('chooses the same highest-score lane when candidates are equally clear', () => {
    const traffic = { ahead: null, nearby: [] }
    const candidates = ROAD_GEOMETRY.lanes.filter(lane => lane !== vehicle.lane)
    const preferredSide = 1
    const expected = candidates.reduce((best, lane) =>
      scorePassingLane(lane, traffic, 'normal') + preferredSide * lane * 0.01 >
      scorePassingLane(best, traffic, 'normal') + preferredSide * best * 0.01 ? lane : best,
      candidates[0] ?? vehicle.lane)
    expect(choosePassingLane(vehicle, traffic, 'normal', preferredSide)).toBe(expected)
  })

  it('keeps current lane when every alternative is blocked', () => {
    const traffic = { ahead: null, nearby: ROAD_GEOMETRY.lanes.map(lane => ({
      vehicle: { ...vehicle, id: 'other-' + lane, lane },
      signedDistance: 0, distance: 0, laneGap: 0, relativeSpeed: 0, timeToCollision: 0,
    })) }
    expect(choosePassingLane(vehicle, traffic, 'normal', 0, true)).toBe(vehicle.lane)
  })
})
