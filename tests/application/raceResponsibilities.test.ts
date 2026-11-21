import { describe, expect, it, vi } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { createRaceResult } from '@/application/race/raceResultRecorder'
import { routeRaceFeedback } from '@/application/race/raceFeedback'
import type { ScoreEntry, ScoreStore } from '@/application/ports/storage'
import type { RaceSetup } from '@/application/race/raceSession'
import type { FeedbackPort } from '@/application/ports/feedback'

const track = createStarterTrack(asTrackId('session-extraction'), 1)
const path = buildRoadPath(track.points, track.terrain)
const setup: RaceSetup = { car: 'blue', difficulty: 'normal', laps: 2, mode: 'normal' }

function finishedState() {
  const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2 })
  return {
    ...race, phase: 'finished' as const,
    vehicles: race.vehicles.map(v => v.player ? { ...v, finishedAt: 42, lap: 2 } : v),
  }
}

function store(canSave = true) {
  const records: ScoreEntry[] = []
  const scores: ScoreStore = {
    forTrack: () => records,
    record: vi.fn((_id, entry) => {
      if (canSave) records.push(entry)
      return canSave
    }),
    removeTrack: vi.fn(() => true),
  }
  return { scores, records }
}

describe('race result recorder', () => {
  it('writes the valid finish once with the matching category and immutable split history', () => {
    const { scores, records } = store()
    const splits = [{ lap: 1, gate: 1 as const, time: 11 }]
    const result = createRaceResult({
      state: finishedState(), track, setup, terminalReason: undefined,
      scoreStore: scores, now: () => 123456, splits, bestGhostTime: undefined,
    })
    expect(result).toMatchObject({ outcome: 'finished', playerTime: 42, newRecord: true, playerWrecked: false })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ time: 42, recordedAt: 123456, car: 'blue', difficulty: 'normal' })
    expect(result?.highScores).toHaveLength(1)
    expect(result?.splits).toEqual(splits)
    expect(result?.splits).not.toBe(splits)
  })

  it('reports a failed record write and never marks it as a new record', () => {
    const { scores, records } = store(false)
    const result = createRaceResult({
      state: finishedState(), track, setup, terminalReason: undefined,
      scoreStore: scores, now: () => 123, splits: [], bestGhostTime: undefined,
    })
    expect(result).toMatchObject({ outcome: 'finished', newRecord: false, scoreSaveFailed: true })
    expect(records).toHaveLength(0)
  })

  it('does not persist nearby results or non-finishing water outcomes', () => {
    const { scores, records } = store()
    const state = finishedState()
    const nearby = createRaceResult({
      state, track, setup: { ...setup, mode: 'nearby' }, terminalReason: undefined,
      scoreStore: scores, now: () => 0, splits: [], bestGhostTime: undefined,
    })
    expect(nearby).toMatchObject({ mode: 'nearby', highScores: [], newRecord: false })
    const water = createRaceResult({
      state: { ...state, vehicles: state.vehicles.map(v =>
        v.player ? { ...v, finishedAt: null } : v) },
      track, setup, terminalReason: 'water',
      scoreStore: scores, now: () => 0, splits: [], bestGhostTime: undefined,
    })
    expect(water).toMatchObject({ outcome: 'water', playerTime: null, newRecord: false })
    expect(records).toHaveLength(0)
  })
})

it('routes only player collision/curb events and tracks the nearest rival for feedback', () => {
  const state = finishedState()
  const player = state.vehicles[0]
  const rival = state.vehicles[1]
  if (!player || !rival) throw new Error('Missing race fixture')
  const report = vi.fn()
  const feedback = { handle: report } as unknown as FeedbackPort
  const vehicles = [{ ...player, x: 0, y: 0, angle: 0, finishedAt: null, speed: 100 },
    { ...rival, x: 50, y: 0, finishedAt: null, speed: 70 }]
  routeRaceFeedback(feedback, { ...state, vehicles }, [
    { type: 'curb-hit', vehicleId: 'ai-1', speed: 50 },
    { type: 'curb-hit', vehicleId: player.id, speed: 40 },
    { type: 'collision', leftId: player.id, rightId: rival.id, strength: 0.8 },
    { type: 'barrier-collision', vehicleId: rival.id, strength: 0.2 },
  ], { throttle: 1, steering: 0.3, braking: false }, 0.4)
  const messages = report.mock.calls.map(([event]) => event)
  expect(messages).toContainEqual(expect.objectContaining({ type: 'rival', proximity: 0.8 }))
  expect(messages).toContainEqual({ type: 'curb', speed: 40 })
  expect(messages).toContainEqual({ type: 'collision', strength: 0.8 })
  expect(messages).toContainEqual({ type: 'landing', strength: 0.4 })
  expect(messages.filter((event) => event.type === 'curb')).toHaveLength(1)
  expect(messages.filter((event) => event.type === 'collision')).toHaveLength(1)
})
