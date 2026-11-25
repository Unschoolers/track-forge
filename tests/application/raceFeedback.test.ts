import { expect, it, vi } from 'vitest'
import type { FeedbackPort } from '@/application/ports/feedback'
import { routeRaceFeedback } from '@/application/race/raceFeedback'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'

it('routes one ignition cue when the fixed-step session detects a player activation', () => {
  const track = createStarterTrack(asTrackId('boost-feedback'), 1)
  const state = createRace({
    path: buildRoadPath(track.points, track.terrain),
    playerCar: 'red', difficulty: 'normal', laps: 1,
  })
  const player = state.vehicles.find(vehicle => vehicle.player)
  if (!player) throw new Error('Missing player fixture')
  const feedback: FeedbackPort = {
    unlock: vi.fn(), setEnabled: vi.fn(), handle: vi.fn(),
    silenceContinuous: vi.fn(), destroy: vi.fn(),
  }

  routeRaceFeedback(feedback, state, [], { steering: 0, throttle: 0, braking: false }, 0, true)

  expect(feedback.handle).toHaveBeenCalledWith({ type: 'boost-ignition' })
  expect(vi.mocked(feedback.handle).mock.calls.filter(([event]) => event.type === 'boost-ignition')).toHaveLength(1)
})
