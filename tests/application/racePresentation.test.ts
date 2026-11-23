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

  it('does not jump camera framing when high-speed road preview gains or loses a point', () => {
    const previous = runningRace()
    const player = playerOf(previous)
    const previewStart = [
      { x: player.x, y: player.y },
      { x: player.x + 50, y: player.y },
      { x: player.x + 100, y: player.y },
    ]
    const longerPreview = [...previewStart, { x: player.x + 170, y: player.y }]
    const before = {
      ...previous,
      cameraHints: { ...previous.cameraHints, preview: previewStart },
    }
    const gained = {
      ...before,
      cameraHints: { ...before.cameraHints, preview: longerPreview },
    }
    // On a new tick alpha=0, the window's world bounds must still match
    // the previous tick, even though the current preview grew.
    const entering = interpolateRaceState(before, gained, 0, emptyRecoveries)
    expect(entering.cameraHints.preview?.at(-1)).toEqual(previewStart.at(-1))
    const middle = interpolateRaceState(before, gained, 0.5, emptyRecoveries)
    expect(middle.cameraHints.preview?.at(-1)?.x).toBeCloseTo(player.x + 135)
    const finished = interpolateRaceState(before, gained, 1, emptyRecoveries)
    expect(finished).toBe(gained)

    // Removing the far point also needs a continuous transition, not a snap.
    const losing = interpolateRaceState(gained, before, 0, emptyRecoveries)
    expect(losing.cameraHints.preview?.at(-1)).toEqual(longerPreview.at(-1))
    const leaving = interpolateRaceState(gained, before, 0.5, emptyRecoveries)
    expect(leaving.cameraHints.preview?.at(-1)?.x).toBeCloseTo(player.x + 135)
  })

  it('keeps the car silhouette and impact shake smooth without modifying the real physics state', () => {
    const before = runningRace()
    const current = {
      ...before,
      vehicles: before.vehicles.map((vehicle) => vehicle.player
        ? { ...vehicle, suspensionCompression: 0.6, landingIntensity: 0.8, verticalVelocity: 12 }
        : vehicle),
      cameraHints: { ...before.cameraHints, shake: 4 },
    }
    const visual = interpolateRaceState(before, current, 0.5, emptyRecoveries)
    const player = playerOf(visual)
    expect(player.suspensionCompression).toBeCloseTo(0.3)
    expect(player.landingIntensity).toBeCloseTo(0.4)
    expect(player.verticalVelocity).toBeCloseTo(6)
    expect(visual.cameraHints.shake).toBeCloseTo(2)
    expect(playerOf(current).landingIntensity).toBe(0.8)
    expect(current.cameraHints.shake).toBe(4)
  })

  it('snaps when changing between road decks, rather than morphing through an overpass', () => {
    const previous = runningRace()
    const player = playerOf(previous)
    const current = {
      ...previous,
      vehicles: previous.vehicles.map((vehicle) => vehicle.player
        ? { ...vehicle, x: vehicle.x + 5, structureRunId: 'bridge' }
        : vehicle),
    }
    const visual = interpolateRaceState(previous, current, 0.5, emptyRecoveries)
    expect(playerOf(visual)).toBe(playerOf(current))
    expect(playerOf(visual).x).toBeCloseTo(player.x + 5)
    expect(visual.cameraHints).toBe(current.cameraHints)
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
    const firstFrame = session.presentationState()
    if (!firstFrame) throw new Error('Expected first presentation frame')
    expect(playerOf(firstFrame).x).toBeCloseTo(initialX.x)
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
