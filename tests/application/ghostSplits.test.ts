import { expect, it } from 'vitest'
import { LapTiming } from '@/application/race/lapTiming'

it('tracks gate splits and compares cumulative time without inventing legacy gaps', () => {
  const timing = new LapTiming([1, 2, 3, 4])
  timing.accept(0, 1, 1.2)
  expect(timing.gap).toBeCloseTo(0.2)
  timing.accept(0, 2, 2.2)
  timing.accept(0, 3, 3.2)
  timing.accept(0, 4, 4.2)
  expect(timing.bestLap).toBeCloseTo(4.2)
  expect(timing.splits).toEqual([1.2, 2.2, 3.2, 4.2])
  const legacy = new LapTiming()
  legacy.accept(0, 1, 1)
  expect(legacy.gap).toBeNull()
})

import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { RaceSession } from '@/application/race/raceSession'
import { BrowserGhostRepository } from '@/infrastructure/storage/ghostRepository'
import type { RaceStep } from '@/domain/race/raceEngine'

it('records real session gate crossings and compares a subsequent ghost race', () => {
  const data = new Map<string, string>()
  const store = new BrowserGhostRepository({ get: (k) => data.get(k) ?? null,
    set: (k, v) => { data.set(k, v); return true }, remove: (k) => data.delete(k) })
  const track = createStarterTrack(asTrackId('splits'), 1)
  const setup = { car: 'blue' as const, difficulty: 'normal' as const, laps: 1 }
  let gate = 0
  let interval = 1
  const step: RaceStep = (state) => {
    gate++
    const finish = gate === 4
    return { state: { ...state, elapsed: gate * interval, phase: finish ? 'finished' : 'running',
      vehicles: state.vehicles.map((v) => v.player ? { ...v, x: v.x + gate,
        nextSector: (finish ? 1 : gate + 1) as 1 | 2 | 3 | 4,
        lap: finish ? 1 : 0, finishedAt: finish ? gate * interval : null } : v) },
      events: [{ type: 'gate-crossed', vehicleId: 'player', gate: gate as 1 | 2 | 3 | 4, lap: 0, time: gate * interval }, ...(finish ? [{ type: 'race-finished' as const, reason: 'finished' as const }] : [])] }
  }
  const session = new RaceSession({ ghostStore: store, step,
    scoreStore: { forTrack: () => [], record: () => true, removeTrack: () => true },
    random: { next: () => 0.5 },
    feedback: { unlock() {}, setEnabled() {}, handle() {}, silenceContinuous() {}, destroy() {} } })
  const input = { steering: 0, throttle: 1, braking: false }
  session.start(track, setup)
  session.advance(3.7, input)
  for (let i = 0; i < 4; i++) session.advance(1 / 60, input)
  expect(store.load(track, setup)?.splits).toEqual([1, 2, 3, 4])
  gate = 0
  interval = 1.2
  session.start(track, { ...setup, mode: 'ghost' })
  session.advance(3.7, input)
  session.advance(1 / 60, input)
  expect(session.snapshot().telemetry.ghostGap).toBeCloseTo(0.2)
  session.destroy()
})

it('invalidates recovered timing until the next lap and resets cleanly for a restart', () => {
  const timing = new LapTiming([1, 2, 3, 4, 5, 6, 7, 8], 4)
  timing.accept(0, 1, 1)
  timing.recover()
  expect(timing.currentLap(2)).toBeNull()
  expect(timing.gap).toBeNull()
  timing.accept(0, 2, 2)
  timing.accept(0, 3, 3)
  timing.accept(0, 4, 4)
  expect(timing.bestLap).toBeNull()
  expect(timing.currentLap(5)).toBe(1)
  timing.accept(1, 1, 5)
  timing.accept(1, 2, 6)
  timing.accept(1, 3, 7)
  timing.accept(1, 4, 8)
  expect(timing.bestLap).toBe(4)
  expect(timing.complete(2)).toBeUndefined()
  const restarted = new LapTiming([1, 2, 3, 4])
  expect(restarted.currentLap(0)).toBe(0)
  expect(restarted.bestLap).toBeNull()
  restarted.accept(0, 1, 0.9)
  expect(restarted.gap).toBeCloseTo(-0.1)
})

it('rejects malformed split metadata but accepts legacy pose-only runs', () => {
  const data = new Map<string, string>()
  const store = new BrowserGhostRepository({ get: (k) => data.get(k) ?? null,
    set: (k, v) => { data.set(k, v); return true }, remove: (k) => data.delete(k) })
  const track = createStarterTrack(asTrackId('legacy'), 1)
  const setup = { car: 'blue' as const, difficulty: 'normal' as const, laps: 1 }
  const frames = [{ t: 0, x: 0, y: 0, angle: 0, z: 0, structureRunId: null },
    { t: 4, x: 1, y: 1, angle: 0, z: 0, structureRunId: null }]
  expect(store.record(track, setup, 4, frames, [1, 3, 2, 4])).toBe(false)
  expect(store.record(track, setup, 4, frames, [1, 2, 4])).toBe(true)
  expect(store.load(track, setup)?.splits).toEqual([1, 2, 4])
  // A pose-only replay remains supported for a separate race revision.
  const oldTrack = { ...track, raceRevision: 2 }
  expect(store.record(oldTrack, setup, 4, frames)).toBe(true)
  expect(store.load(oldTrack, setup)?.splits).toBeUndefined()
})
