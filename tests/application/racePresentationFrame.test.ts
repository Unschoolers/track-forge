import { describe, expect, it, vi } from 'vitest'
import { RaceSession } from '@/application/race/raceSession'
import type { ScoreStore } from '@/application/ports/storage'
import type { FeedbackPort } from '@/application/ports/feedback'
import type { RaceStep } from '@/domain/race/raceEngine'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'

const track = createStarterTrack(asTrackId('presentation-frame'), 1)
const setup = { car: 'blue' as const, difficulty: 'normal' as const, laps: 2 }
const input = { steering: 0, throttle: 0, braking: false }
const scoreStore: ScoreStore = {
  forTrack: () => [],
  record: () => true,
  removeTrack: () => true,
}
const feedback: FeedbackPort = {
  unlock: vi.fn(),
  setEnabled: vi.fn(),
  handle: vi.fn(),
  silenceContinuous: vi.fn(),
  destroy: vi.fn(),
}

describe('race presentation timing', () => {
  it('keeps physics authoritative while exposing the unconsumed half-tick for rendering', () => {
    const session = new RaceSession({
      scoreStore, feedback, random: { next: () => 0.5 },
      step: ((state) => ({
        state: { ...state, tick: state.tick + 1,
          elapsed: state.elapsed + 1 / 60,
          vehicles: state.vehicles.map((vehicle) => ({ ...vehicle, x: vehicle.x + 12 })) },
        events: [],
      })) satisfies RaceStep,
    })
    session.start(track, setup)
    session.advance(3.7, input)
    session.advance(1 / 60, input)
    const afterStep = session.snapshot().state
    const previous = session.presentationFrame()?.previous
    expect(afterStep?.tick).toBe(1)
    expect(previous?.tick).toBe(0)
    expect(afterStep?.vehicles[0]?.x).toBeCloseTo((previous?.vehicles[0]?.x ?? 0) + 12)
    session.advance(1 / 120, input)
    expect(session.snapshot().state).toBe(afterStep)
    expect(session.presentationFrame()?.alpha).toBeCloseTo(0.5, 8)

    session.setPaused(true)
    expect(session.presentationFrame()?.alpha).toBe(1)
    expect(session.presentationFrame()?.previous).toBe(session.snapshot().state)
    session.setPaused(false)
    expect(session.presentationFrame()?.alpha).toBe(0)
    session.restart()
    expect(session.presentationFrame()?.previous).toBe(session.snapshot().state)
    session.stop()
    expect(session.presentationFrame()).toBeNull()
  })

  it('marks automatic recovery as a discontinuity for the renderer', () => {
    const step: RaceStep = (state) => ({
      state: { ...state, tick: state.tick + 1,
        elapsed: state.elapsed + 1 / 60,
        vehicles: state.vehicles.map((vehicle) =>
          vehicle.player ? { ...vehicle, x: vehicle.x + 5 } : vehicle) },
      events: [{ type: 'vehicle-recovered', vehicleId: 'player',
        reason: 'water', x: 0, y: 0, pathIndex: 0 }],
    })
    const session = new RaceSession({
      scoreStore, feedback, random: { next: () => 0.5 }, step,
    })
    session.start(track, setup)
    session.advance(3.7, input)
    session.advance(1 / 60, input)
    expect(session.presentationFrame()?.discontinuousVehicleIds.has('player')).toBe(true)
  })
})
