import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { ghostPoseAt, ghostRaceKey, type GhostFrame } from '@/application/race/ghostReplay'
import { BrowserGhostRepository } from '@/infrastructure/storage/ghostRepository'
import { RaceSession } from '@/application/race/raceSession'
import type { RaceStep } from '@/domain/race/raceEngine'
import type { KeyValueStore } from '@/application/ports/storage'

const track = createStarterTrack(asTrackId('ghost-track'), 42)
const setup = { car: 'blue' as const, difficulty: 'normal' as const, laps: 1, handling: 'arcade' as const }
const frames: GhostFrame[] = [
  { t: 0, x: 0, y: 0, z: 0, angle: Math.PI - 0.1, structureRunId: null },
  { t: 1, x: 20, y: 0, z: 10, angle: -Math.PI + 0.1, structureRunId: 'bridge' },
]
function memory(): KeyValueStore {
  const data = new Map<string, string>()
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => { data.set(key, value); return true },
    remove: (key) => data.delete(key),
  }
}

describe('personal-best ghost replay', () => {
  it.each([
    [-0.1, 1], [0.1, 1], [0, 0.5], [0, 2], [0, 0], [0, 0.8, 0.4, 1],
  ])('rejects an invalid replay timeline %j on record and load', (...times) => {
    const storage = memory()
    const store = new BrowserGhostRepository(storage)
    const invalid = times.map((t) => ({ ...frames[0]!, t }))
    expect(store.record(track, setup, 1, invalid)).toBe(false)
    storage.set('trackforge-ghost-runs-v1', JSON.stringify({
      [ghostRaceKey(track, setup)]: { car: 'blue', time: 1, frames: invalid },
    }))
    expect(store.load(track, setup)).toBeNull()
  })

  it.each(['off-road', 'water'] as const)('does not store a finish after a short automatic player %s recovery', (reason) => {
    const store = new BrowserGhostRepository(memory())
    const step: RaceStep = (state) => {
      const player = state.vehicles.find((vehicle) => vehicle.player)!
      return {
        state: { ...state, phase: 'finished', elapsed: 1,
          vehicles: [{ ...player, x: player.x + 20, finishedAt: 1 }] },
        events: [
          { type: 'vehicle-recovered', vehicleId: player.id, reason,
            x: player.x, y: player.y, pathIndex: player.pathIndex },
          { type: 'race-finished', reason: 'finished' },
        ],
      }
    }
    const session = new RaceSession({
      ghostStore: store,
      scoreStore: { forTrack: () => [], record: () => true, removeTrack: () => true },
      random: { next: () => 0.5 },
      feedback: { unlock() {}, setEnabled() {}, handle() {}, silenceContinuous() {}, destroy() {} },
      step,
    })
    const simulation = { ...setup, handling: 'simulation' as const }
    session.start(track, simulation)
    session.advance(4, { steering: 0, throttle: 1, braking: false })
    expect(session.snapshot().result?.outcome).toBe('finished')
    expect(store.load(track, simulation)).toBeNull()
    session.destroy()
  })

  it('interpolates position and wrapped heading, then disappears after finishing', () => {
    const run = { car: 'blue' as const, time: 1, frames }
    const pose = ghostPoseAt(run, 0.5)
    expect(pose?.x).toBeCloseTo(10)
    expect(pose?.z).toBeCloseTo(5)
    expect(Math.abs(pose?.angle ?? 0)).toBeCloseTo(Math.PI, 1)
    expect(ghostPoseAt(run, 1.01)).toBeNull()
  })
  it('keeps the fastest replay only for the same track revision and race setup', () => {
    const store = new BrowserGhostRepository(memory())
    expect(store.record(track, setup, 1, frames)).toBe(true)
    expect(store.record(track, setup, 2, frames)).toBe(false)
    expect(store.load(track, setup)?.time).toBe(1)
    expect(store.load({ ...track, updatedAt: track.updatedAt + 1 }, setup)).toBeNull()
    expect(store.load(track, { ...setup, laps: 2 })).toBeNull()
    expect(ghostRaceKey(track, setup)).not.toBe(ghostRaceKey(track, { ...setup, handling: 'simulation' }))
  })
  it('captures a race finish and loads the best ghost on replay', () => {
    const store = new BrowserGhostRepository(memory())
    const step: RaceStep = (state) => ({
      state: {
        ...state, phase: 'finished', elapsed: 1,
        vehicles: state.vehicles.map((vehicle) =>
          vehicle.player
            ? { ...vehicle, x: vehicle.x + 10, finishedAt: 1, speed: 100 }
            : vehicle),
      },
      events: [{ type: 'race-finished', reason: 'finished' }],
    })
    const session = new RaceSession({
      ghostStore: store,
      scoreStore: { forTrack: () => [], record: () => true, removeTrack: () => true },
      random: { next: () => 0.5 },
      feedback: { unlock() {}, setEnabled() {}, handle() {}, silenceContinuous() {}, destroy() {} },
      step,
    })
    const input = { steering: 0, throttle: 1, braking: false }
    session.start(track, setup)
    session.advance(3.7, input)
    session.advance(1 / 60, input)
    expect(store.load(track, setup)?.frames.length).toBeGreaterThan(1)
    session.start(track, { ...setup, mode: 'ghost', lighting: 'night' })
    expect(session.snapshot().setup?.lighting).toBe('night')
    expect(session.snapshot().ghost).not.toBeNull()
    expect(session.snapshot().ghost?.car).toBe('blue')
    session.destroy()
  })
})
