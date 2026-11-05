import { describe, expect, it, vi } from 'vitest'
import type { ScoreEntry, ScoreStore } from '@/application/ports/storage'
import { RaceSession } from '@/application/race/raceSession'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { stepRace, type RaceStep } from '@/domain/race/raceEngine'
import type { FeedbackPort } from '@/application/ports/feedback'

const track = createStarterTrack(asTrackId('session-track'), 1)
const setup = {
  car: 'blue' as const,
  difficulty: 'normal' as const,
  laps: 3,
}
const noInput = { steering: 0, throttle: 1, braking: false }

function createFeedback(): FeedbackPort {
  return {
    unlock: vi.fn(),
    setEnabled: vi.fn(),
    handle: vi.fn(),
    silenceContinuous: vi.fn(),
    destroy: vi.fn(),
  }
}

function createScoreStore() {
  const scores: ScoreEntry[] = []
  const store: ScoreStore = {
    forTrack: () => [...scores].sort((left, right) => left.time - right.time),
    record: vi.fn((_trackId, score) => {
      scores.push(score)
      return true
    }),
    removeTrack: vi.fn(() => true),
  }
  return { store, scores }
}

describe('RaceSession', () => {

  it('uses the moved reverse start for telemetry, standings, and results', () => {
    for (const terminal of [false, true]) {
      const { store } = createScoreStore()
      const step: RaceStep = (state) => ({
        state: {
          ...state,
          phase: terminal ? 'finished' : 'running',
          vehicles: state.vehicles.map((vehicle, index) => ({
            ...vehicle,
            pathIndex: (state.startPathIndex - (index === 0 ? 4 : 1) + state.path.points.length) % state.path.points.length,
          })),
        },
        events: terminal ? [{ type: 'race-finished', reason: 'water' }] : [],
      })
      const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback: createFeedback(), step })
      session.start({ ...track, start: { ratio: 0.35, reversed: true } }, setup)
      session.advance(3.7, noInput)
      session.advance(1 / 60, noInput)
      const snapshot = session.snapshot()
      expect(snapshot.telemetry.position).toBe(1)
      expect(snapshot.standings[0]?.id).toBe('player')
      if (terminal) {
        expect(snapshot.result?.playerPlace).toBe(1)
        expect(snapshot.result?.standings[0]?.id).toBe('player')
      }
    }
  })

  it('simulates equal wall time consistently across frame rates, including countdown overflow', () => {
    const snapshots = [10, 20, 30, 60, 120].map((hz) => {
      const { store } = createScoreStore()
      const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback: createFeedback() })
      session.start(track, setup)
      for (let frame = 0; frame < hz * 5; frame++) session.advance(1 / hz, noInput)
      const state = session.snapshot().state
      if (!state) throw new Error('Missing race state')
      return state
    })
    const reference = snapshots[0]?.vehicles[0]
    if (!reference) throw new Error('Missing player')
    for (const state of snapshots) {
      expect(state.elapsed).toBeCloseTo(1.3, 8)
      expect(state.vehicles[0]?.x).toBeCloseTo(reference.x, 8)
      expect(state.vehicles[0]?.y).toBeCloseTo(reference.y, 8)
    }
  })

  it('ignores invalid deltas and clears fractional running time on pause and restart', () => {
    const { store } = createScoreStore()
    const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback: createFeedback() })
    session.start(track, setup)
    for (const delta of [-1, NaN, Infinity]) session.advance(delta, noInput)
    expect(session.snapshot().telemetry.countdown).toBe(3.7)
    session.advance(3.7, noInput)
    session.advance(0.01, noInput)
    session.setPaused(true)
    session.setPaused(false)
    session.advance(0.01, noInput)
    expect(session.snapshot().telemetry.elapsed).toBe(0)
    session.restart()
    session.advance(3.7, noInput)
    session.advance(0.01, noInput)
    expect(session.snapshot().telemetry.elapsed).toBe(0)
    for (const delta of [-1, NaN, Infinity]) session.advance(delta, noInput)
    expect(session.snapshot().telemetry.elapsed).toBe(0)
  })

  it('consumes countdown overflow and limits running catch-up after a long stall', () => {
    const { store } = createScoreStore()
    const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback: createFeedback() })
    session.start(track, setup)
    session.advance(3.8, noInput)
    expect(session.snapshot().telemetry.elapsed).toBeCloseTo(0.1, 8)
    session.advance(10, noInput)
    expect(session.snapshot().telemetry.elapsed).toBeCloseTo(0.35, 8)
  })

  it('publishes and updates continuous feedback once for a multi-step frame', () => {
    const { store } = createScoreStore()
    const feedback = createFeedback()
    const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback })
    const listener = vi.fn()
    session.subscribe(listener)
    session.start(track, setup)
    session.advance(3.7, noInput)
    listener.mockClear()
    vi.mocked(feedback.handle).mockClear()
    session.advance(0.1, noInput)
    expect(listener).toHaveBeenCalledOnce()
    expect(vi.mocked(feedback.handle).mock.calls.filter(([event]) => event.type === 'engine')).toHaveLength(1)
    expect(vi.mocked(feedback.handle).mock.calls.filter(([event]) => event.type === 'surface')).toHaveLength(1)
  })

  it('keeps peak shake from earlier substeps with the final camera pose', () => {
    const { store } = createScoreStore()
    let n = 0
    const step: RaceStep = (state) => ({ state: { ...state, cameraHints: { ...state.cameraHints, shake: n++ === 0 ? 0.8 : 0, speed: n } }, events: [] })
    const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback: createFeedback(), step })
    session.start(track, setup)
    session.advance(3.7, noInput)
    session.advance(0.05, noInput)
    expect(session.snapshot().state?.cameraHints).toMatchObject({ shake: 0.8, speed: 3 })
  })

  it('stops substeps at a terminal result and records it once', () => {
    const { store } = createScoreStore()
    const step = vi.fn<RaceStep>((state) => ({
      state: { ...state, phase: 'finished', vehicles: state.vehicles.map((vehicle) => vehicle.player ? { ...vehicle, finishedAt: 1 } : vehicle) },
      events: [{ type: 'race-finished', reason: 'finished' }],
    }))
    const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback: createFeedback(), step })
    session.start(track, setup)
    session.advance(3.7, noInput)
    session.advance(0.1, noInput)
    session.advance(0.1, noInput)
    expect(step).toHaveBeenCalledOnce()
    expect(store.record).toHaveBeenCalledOnce()
  })

  it('resets a reverse-race player facing reverse travel', () => {
    const { store } = createScoreStore()
    const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback: createFeedback() })
    session.start({ ...track, start: { ratio: 0.35, reversed: true } }, setup)
    session.advance(4, noInput)
    session.resetPlayer()
    const state = session.snapshot().state
    if (!state) throw new Error('Missing race state')
    const car = state.vehicles[0]
    if (!car) throw new Error('Missing player')
    const point = state.path.points[car.pathIndex]
    const ahead = state.path.points[(car.pathIndex - 4 + state.path.points.length) % state.path.points.length]
    if (!point || !ahead) throw new Error('Missing path points')
    const expected = Math.atan2(ahead.y - point.y, ahead.x - point.x)
    expect(Math.abs(Math.atan2(Math.sin(car.angle - expected), Math.cos(car.angle - expected)))).toBeLessThan(0.01)
  })

  it('only recovers during unpaused racing and preserves progress, damage, and time', () => {
    const { store } = createScoreStore()
    let finish = false
    const step: RaceStep = (state) => ({
      state: {
        ...state,
        phase: finish ? 'finished' : 'running',
        elapsed: 42,
        vehicles: state.vehicles.map((vehicle) => vehicle.player
          ? { ...vehicle, x: vehicle.x + 1000, y: vehicle.y + 1000, speed: 30, lap: 1, nextSector: 3, damage: 2 }
          : vehicle),
      },
      events: finish ? [{ type: 'race-finished', reason: 'water' }] : [],
    })
    const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback: createFeedback(), step })
    session.start(track, setup)

    const countdown = session.snapshot()
    session.resetPlayer()
    expect(session.snapshot()).toBe(countdown)

    session.advance(3.7, noInput)
    session.advance(1 / 60, noInput)
    session.setPaused(true)
    const paused = session.snapshot()
    session.resetPlayer()
    expect(session.snapshot()).toBe(paused)

    session.setPaused(false)
    const before = session.snapshot()
    const beforePlayer = before.state?.vehicles.find((vehicle) => vehicle.player)
    if (!beforePlayer) throw new Error('Missing player')
    session.resetPlayer()
    const recovered = session.snapshot()
    const player = recovered.state?.vehicles.find((vehicle) => vehicle.player)
    expect(player?.x).not.toBe(beforePlayer.x)
    expect(player?.y).not.toBe(beforePlayer.y)
    expect(player).toMatchObject({ speed: 0, vx: 0, vy: 0, lap: 1, nextSector: 3, damage: 2 })
    expect(recovered.telemetry).toMatchObject({ elapsed: 42, lap: 1, damage: 2 })
    expect(recovered.state?.vehicles.filter((vehicle) => !vehicle.player)).toEqual(
      before.state?.vehicles.filter((vehicle) => !vehicle.player),
    )

    finish = true
    session.advance(1 / 60, noInput)
    const finished = session.snapshot()
    expect(finished.state?.phase).toBe('finished')
    session.resetPlayer()
    expect(session.snapshot()).toBe(finished)
  })

  it('owns countdown, pause, restart, and observable snapshots', () => {
    const { store } = createScoreStore()
    const step = vi.fn<RaceStep>((state) => ({ state, events: [] }))
    const feedback = createFeedback()
    const session = new RaceSession({
      scoreStore: store,
      random: { next: () => 0.5 },
      feedback,
      now: () => 100,
      step,
    })
    const listener = vi.fn()
    session.subscribe(listener)
    session.start(track, setup)
    const initial = session.snapshot()

    session.advance(3.6, noInput)
    expect(session.snapshot().telemetry).toMatchObject({
      phase: 'countdown',
      countdown: expect.closeTo(0.1),
      elapsed: 0,
    })
    expect(step).not.toHaveBeenCalled()

    session.advance(0.1, noInput)
    expect(session.snapshot().telemetry.phase).toBe('running')
    session.setPaused(true)
    expect(feedback.silenceContinuous).toHaveBeenCalledTimes(2)
    session.advance(1, noInput)
    expect(step).not.toHaveBeenCalled()

    session.setPaused(false)
    session.advance(0.02, noInput)
    expect(step).toHaveBeenCalledOnce()
    session.restart()
    expect(feedback.silenceContinuous).toHaveBeenCalledTimes(3)
    expect(session.snapshot()).toMatchObject({
      telemetry: { phase: 'countdown', countdown: 3.7, elapsed: 0 },
      result: null,
    })
    expect(session.snapshot().state).toEqual(initial.state)
    expect(listener).toHaveBeenCalled()
  })

  it('publishes terminal results and records a player finish exactly once', () => {
    const { store } = createScoreStore()
    const step: RaceStep = (state) => ({
      state: {
        ...state,
        phase: 'finished',
        elapsed: 12.5,
        vehicles: state.vehicles.map((vehicle, index) => ({
          ...vehicle,
          lap: index === 0 ? state.totalLaps : vehicle.lap,
          finishedAt: index === 0 ? 12.5 : vehicle.finishedAt,
        })),
      },
      events: [{ type: 'race-finished', reason: 'finished' }],
    })
    const feedback = createFeedback()
    const session = new RaceSession({
      scoreStore: store,
      random: { next: () => 0.5 },
      feedback,
      now: () => 250,
      step,
    })
    session.start(track, setup)
    session.advance(3.7, noInput)
    session.advance(0.02, noInput)
    session.advance(0.02, noInput)

    expect(store.record).toHaveBeenCalledOnce()
    expect(store.record).toHaveBeenCalledWith(track.id, {
      time: 12.5,
      car: 'blue',
      difficulty: 'normal',
      recordedAt: 250,
    })
    expect(session.snapshot().result).toMatchObject({
      outcome: 'finished',
      trackId: track.id,
      playerPlace: 1,
      playerTime: 12.5,
      playerWrecked: false,
      newRecord: true,
      highScores: [{ time: 12.5 }],
    })
    expect(feedback.handle).toHaveBeenCalledWith({
      type: 'finish',
      place: 1,
      newRecord: true,
    })
    expect(feedback.silenceContinuous).toHaveBeenCalledTimes(2)
  })

  it('keeps an opponent finish in standings and results as the player continues and finishes', () => {
    const { store } = createScoreStore()
    let frames = 0
    const step: RaceStep = (state, input, deltaSeconds, random) => {
      const point = state.path.points[0]
      const player = state.vehicles[0]
      const rival = state.vehicles[1]
      if (!point || !player || !rival) throw new Error('Missing race fixtures')
      const atLine = { x: point.x, y: point.y, z: 0, vx: 0, vy: 0, speed: 0 }
      const prepared = frames++ === 0
        ? {
            ...state,
            elapsed: 10,
            vehicles: [
              { ...player, ...atLine, pathIndex: 0 },
              { ...rival, ...atLine, x: point.x - 1, pathIndex: state.path.points.length - 2, nextSector: 4 as const },
            ],
          }
        : {
            ...state,
            vehicles: [
              { ...player, ...atLine, pathIndex: state.path.points.length - 2, nextSector: 4 as const },
              rival,
            ],
          }
      return stepRace(prepared, input, deltaSeconds, random)
    }
    const session = new RaceSession({ scoreStore: store, random: { next: () => 0.5 }, feedback: createFeedback(), step })
    session.start(track, { ...setup, laps: 1 })
    session.advance(3.7, noInput)
    session.advance(1 / 60, noInput)

    const running = session.snapshot()
    expect(running.state?.phase).toBe('running')
    expect(running.state?.vehicles[0]?.damage).toBe(0)
    expect(running.state?.activeContacts).toEqual([])
    expect(running.standings[0]).toMatchObject({ id: 'ai-1', place: 1, finishTime: 10 + 1 / 60 })
    expect(running.result).toBeNull()

    session.advance(1 / 60, noInput)
    const finished = session.snapshot()
    expect(finished.result).toMatchObject({ outcome: 'finished', playerPlace: 2, playerTime: expect.closeTo(10 + 2 / 60) })
    expect(finished.result?.standings).toMatchObject([
      { id: 'ai-1', place: 1, finishTime: 10 + 1 / 60 },
      { id: 'player', place: 2, finishTime: expect.closeTo(10 + 2 / 60) },
    ])
    expect(store.record).toHaveBeenCalledOnce()
  })

  it('reports wrecks without writing a score and destroys idempotently', () => {
    const { store } = createScoreStore()
    const step: RaceStep = (state) => ({
      state: {
        ...state,
        phase: 'finished',
        vehicles: state.vehicles.map((vehicle) =>
          vehicle.player ? { ...vehicle, wrecked: true } : vehicle,
        ),
      },
      events: [{ type: 'race-finished', reason: 'wrecked' }],
    })
    const feedback = createFeedback()
    const session = new RaceSession({
      scoreStore: store,
      random: { next: () => 0.5 },
      feedback,
      step,
    })
    const listener = vi.fn()
    session.subscribe(listener)
    session.start(track, setup)
    session.advance(3.7, noInput)
    session.advance(0.02, noInput)

    expect(session.snapshot().result).toMatchObject({
      outcome: 'wrecked',
      playerTime: null,
      playerWrecked: true,
    })
    expect(store.record).not.toHaveBeenCalled()
    session.destroy()
    session.destroy()
    session.setPaused(true)
    expect(feedback.silenceContinuous).toHaveBeenCalledTimes(3)
    expect(listener).toHaveBeenCalled()
  })

  it('publishes water once, silences feedback, and never writes a score', () => {
    const { store } = createScoreStore()
    const step: RaceStep = (state) => ({
      state: {
        ...state,
        phase: 'finished',
        elapsed: 12.5,
        vehicles: state.vehicles.map((vehicle) =>
          vehicle.player ? { ...vehicle, finishedAt: 12.5 } : vehicle,
        ),
      },
      events: [{ type: 'race-finished', reason: 'water' }],
    })
    const feedback = createFeedback()
    const session = new RaceSession({
      scoreStore: store,
      random: { next: () => 0.5 },
      feedback,
      now: () => 250,
      step,
    })
    session.start(track, setup)
    session.advance(3.7, noInput)
    session.advance(0.02, noInput)
    session.advance(0.02, noInput)

    expect(session.snapshot().result).toMatchObject({
      outcome: 'water',
      playerTime: null,
      newRecord: false,
      highScores: [],
    })
    expect(
      session.snapshot().result?.standings.find(({ player }) => player),
    ).toMatchObject({
      id: 'player',
      finishTime: null,
    })
    expect(
      session.snapshot().state?.vehicles.find(({ player }) => player)
        ?.finishedAt,
    ).toBeNull()
    expect(
      session.snapshot().standings.find(({ player }) => player)?.finishTime,
    ).toBeNull()
    expect(store.record).not.toHaveBeenCalled()
    expect(feedback.silenceContinuous).toHaveBeenCalledTimes(2)
    expect(
      vi.mocked(feedback.handle).mock.calls.filter(
        ([event]) => event.type === 'finish',
      ),
    ).toEqual([
      [{ type: 'finish', place: 1, newRecord: false }],
    ])
  })

  it('includes the player car and cornering load in engine feedback', () => {
    const { store } = createScoreStore()
    const feedback = createFeedback()
    const session = new RaceSession({
      scoreStore: store,
      random: { next: () => 0.5 },
      feedback,
      step: (state) => ({ state, events: [] }),
    })
    session.start(track, { ...setup, car: 'red' })
    session.advance(3.7, noInput)
    session.advance(0.02, {
      ...noInput,
      steering: -0.75,
    })

    expect(feedback.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine',
        car: 'red',
        cornering: 0.75,
      }),
    )
  })
})
