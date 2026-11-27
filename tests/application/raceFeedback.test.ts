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

it('routes only the local jump cue and silences tire contact while airborne', () => {
  const track = createStarterTrack(asTrackId('jump-feedback'), 1)
  const state = createRace({ path: buildRoadPath(track.points, track.terrain), playerCar: 'red', difficulty: 'normal', laps: 1 })
  const player = state.vehicles.find(vehicle => vehicle.player)
  if (!player) throw new Error('Missing player fixture')
  const feedback: FeedbackPort = { unlock: vi.fn(), setEnabled: vi.fn(), handle: vi.fn(), silenceContinuous: vi.fn(), destroy: vi.fn() }
  const input = { steering: 0, throttle: 1, braking: false }
  const flight = { ...state, vehicles: [{ ...player, jumpFlight: true, grounded: false, speed: 180, slip: 40 }] }
  routeRaceFeedback(feedback, flight, [
    { type: 'vehicle-jumped', vehicleId: 'rival', speed: 180, x: 0, y: 0 },
    { type: 'vehicle-jumped', vehicleId: player.id, speed: 180, x: 0, y: 0 },
  ], input, 0)
  expect(vi.mocked(feedback.handle).mock.calls.filter(([event]) => event.type === 'jump-takeoff')).toHaveLength(1)
  expect(feedback.handle).toHaveBeenCalledWith({ type: 'surface', surface: player.currentSurface, speedRatio: 0 })
  expect(feedback.handle).toHaveBeenCalledWith({ type: 'tire-slip', surface: player.currentSurface, speedRatio: 0, strength: 0 })
})
