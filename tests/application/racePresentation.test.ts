import { describe, expect, it, vi } from 'vitest'
import { interpolateRaceState } from '@/application/race/racePresentation'
import { RaceSession } from '@/application/race/raceSession'
import type { FeedbackPort } from '@/application/ports/feedback'
import type { ScoreStore } from '@/application/ports/storage'
import { createRace } from '@/domain/race/raceFactory'
import type { RaceState } from '@/domain/race/raceState'
import type { RaceStep } from '@/domain/race/raceEngine'
import { asTrackId } from '@/domain/model'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { createStarterTrack } from '@/domain/track/starterTrack'

const track = createStarterTrack(asTrackId('interpolation-test'), 1)
const path = new TrackGeometryService().get(track).path
const emptyRecoveries = new Set<string>()

function runningRace() {
  return {
    ...createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2 }),
    phase: 'running' as const,
  }
}

function playerOf(state: RaceState) {
  const player = state.vehicles.find((vehicle) => vehicle.player)
  if (!player) throw new Error('Missing player in interpolation fixture')
  return player
}

describe('render-only race interpolation', () => {
  it('smoothly advances vehicle and camera positions between fixed ticks without changing race state', () => {
    const previous = runningRace()
    const before = playerOf(previous)
    const next = {
      ...previous,
      vehicles: previous.vehicles.map((car) => car.player
        ? { ...car, x: car.x + 12, y: car.y + 8, z: car.z + 4 } : car),
      cameraHints: {
        ...previous.cameraHints,
        target: { x: previous.cameraHints.target.x + 12, y: previous.cameraHints.target.y + 8 },
        preview: [{ x: before.x + 12, y: before.y + 8 }, { x: before.x + 60, y: before.y + 20 }],
      },
    }
    const middle = interpolateRaceState(previous, next, 0.5, emptyRecoveries)
    const painted = playerOf(middle)

    expect(painted).toMatchObject({ x: before.x + 6, y: before.y + 4, z: before.z + 2 })
    expect(middle.cameraHints.target.x).toBeCloseTo(previous.cameraHints.target.x + 6)
    expect(middle.cameraHints.preview?.[0]).toMatchObject({ x: painted.x, y: painted.y })
    expect(playerOf(next).x).toBe(before.x + 12)
    expect(interpolateRaceState(previous, next, 1, emptyRecoveries)).toBe(next)
  })

  it('uses shortest-arc interpolation across the +/-180 degree boundary', () => {
    const state = runningRace()
    const previous = {
      ...state,
      vehicles: state.vehicles.map((car) => ({ ...car, angle: Math.PI - 0.1 })),
      cameraHints: { ...state.cameraHints, roadAngle: Math.PI - 0.1 },
    }
    const current = {
      ...previous,
      vehicles: previous.vehicles.map((car) => ({ ...car, angle: -Math.PI + 0.1 })),
      cameraHints: { ...previous.cameraHints, roadAngle: -Math.PI + 0.1 },
    }
    const frame = interpolateRaceState(previous, current, 0.5, emptyRecoveries)
    expect(playerOf(frame).angle).toBeCloseTo(Math.PI)
    expect(frame.cameraHints.roadAngle).toBeCloseTo(Math.PI)
  })

  it('snaps on recoveries and discontinuous teleports, never drawing a car through the level', () => {
    const previous = runningRace()
    const before = playerOf(previous)
    const current = {
      ...previous,
      vehicles: previous.vehicles.map((car) => car.player
        ? { ...car, x: car.x + 500, y: car.y + 300 } : car),
      cameraHints: { ...previous.cameraHints,
        target: { x: previous.cameraHints.target.x + 500, y: previous.cameraHints.target.y + 300 } },
    }
    const recovered = interpolateRaceState(previous, current, 0.5, new Set([before.id]))
    const discontinuous = interpolateRaceState(previous, current, 0.5, emptyRecoveries)

    expect(playerOf(recovered)).toBe(playerOf(current))
    expect(recovered.cameraHints).toBe(current.cameraHints)
    expect(playerOf(discontinuous)).toBe(playerOf(current))
    expect(discontinuous.cameraHints).toBe(current.cameraHints)
    expect(interpolateRaceState(previous, { ...current, phase: 'finished' }, 0.5, emptyRecoveries))
      .toMatchObject({ phase: 'finished' })
  })

  it('keeps 120 Hz presentation frames smooth while fixed-step physics and pause state remain authoritative', () => {
    const scoreStore: ScoreStore = {
      forTrack: () => [],
      record: () => true,
      removeTrack: () => true,
    }
    const feedback: FeedbackPort = {
      unlock: vi.fn(), setEnabled: vi.fn(), handle: vi.fn(),
      silenceContinuous: vi.fn(), destroy: vi.fn(),
    }
    const step: RaceStep = (state) => ({
      state: {
        ...state,
        tick: state.tick + 1,
        vehicles: state.vehicles.map((car) => ({ ...car, x: car.x + 20 })),
        cameraHints: { ...state.cameraHints, target: {
          x: state.cameraHints.target.x + 20,
          y: state.cameraHints.target.y,
        } },
      },
      events: [],
    })
    const session = new RaceSession({ scoreStore, feedback, random: { next: () => 0.5 }, step })
    session.start(track, { car: 'blue', difficulty: 'normal', laps: 2 })
    session.advance(3.7, { steering: 0, throttle: 1, braking: false })
    const initial = session.snapshot().state
    if (!initial) throw new Error('Expected countdown to complete')
    const initialX = playerOf(initial)
    session.advance(1 / 60, { steering: 0, throttle: 1, braking: false })
    expect(playerOf(session.presentationState()!).x).toBeCloseTo(initialX.x)
    session.advance(1 / 120, { steering: 0, throttle: 1, braking: false })
    const authoritative = session.snapshot().state
    const painted = session.presentationState()
    if (!authoritative || !painted) throw new Error('Expected running race')
    expect(playerOf(painted).x).toBeCloseTo(initialX.x + 10)
    expect(playerOf(authoritative).x).toBeCloseTo(initialX.x + 20)
    expect(session.snapshot().state).toBe(authoritative)
    session.setPaused(true)
    expect(session.presentationState()).toBe(session.snapshot().state)
    session.setPaused(false)
    expect(session.presentationState()).toBe(session.snapshot().state)
  })
})
