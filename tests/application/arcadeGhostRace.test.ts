// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { RaceSession } from '@/application/race/raceSession'
import { ghostPoseAt, MAX_GHOST_FRAMES, type GhostFrame } from '@/application/race/ghostReplay'
import { BrowserGhostRepository } from '@/infrastructure/storage/ghostRepository'
import { GhostRecording } from '@/application/race/ghostRecording'
import type { KeyValueStore } from '@/application/ports/storage'
import type { RaceStep } from '@/domain/race/raceEngine'

const track = createStarterTrack(asTrackId('arcade-ghost'), 1)
const setup = { car: 'blue' as const, difficulty: 'normal' as const, laps: 1, handling: 'arcade' as const }
const input = { steering: 0, throttle: 1, braking: false }
function memory(): KeyValueStore {
  const data = new Map<string, string>()
  return { get: (key) => data.get(key) ?? null,
    set: (key, value) => { data.set(key, value); return true },
    remove: (key) => data.delete(key) }
}
function session(store: BrowserGhostRepository, step?: RaceStep): RaceSession {
  return new RaceSession({ ghostStore: store,
    scoreStore: { forTrack: () => [], record: () => true, removeTrack: () => true },
    random: { next: () => 0.5 },
    feedback: { unlock() {}, setEnabled() {}, handle() {}, silenceContinuous() {}, destroy() {} },
    ...(step ? { step } : {}),
  })
}
const frames: GhostFrame[] = [
  { t: 0, x: 0, y: 0, z: 0, angle: 0, structureRunId: null },
  { t: 1, x: 100, y: 0, z: 0, angle: 0, structureRunId: null },
]
function finishAt(time: number, recover = false): RaceStep {
  return (state, _input, dt) => {
    const elapsed = state.elapsed + dt
    const finished = elapsed + 1e-8 >= time
    const player = state.vehicles.find((vehicle) => vehicle.player)
    if (!player) throw new Error('Missing player')
    return {
      state: { ...state, elapsed, phase: finished ? 'finished' : 'running',
        vehicles: [{ ...player, x: player.x + (recover && state.elapsed === 0 ? 1000 : 1),
          speed: 60, finishedAt: finished ? elapsed : null }] },
      events: [
        ...(recover && state.elapsed === 0 ? [{ type: 'vehicle-recovered' as const,
          vehicleId: player.id, reason: 'water' as const,
          x: player.x, y: player.y, pathIndex: player.pathIndex }] : []),
        ...(finished ? [{ type: 'race-finished' as const, reason: 'finished' as const }] : []),
      ],
    }
  }
}

describe('Arcade ghost racing', () => {
  it('preserves the original pre-cut pose when recovery repeats in the same tick', () => {
    const race = session(new BrowserGhostRepository(memory()))
    race.start(track, setup)
    const source = race.snapshot().state?.vehicles[0]
    if (!source) throw new Error('Missing player')
    const before = { ...source, x: 1000, y: 0 }
    const after = { ...before, x: 0 }
    const recorder = new GhostRecording(before, true)
    recorder.sample(before, 0.9)
    recorder.recover(before, after, 1)
    recorder.recover(after, after, 1)
    const saved = recorder.finish(after, 2)
    if (!saved) throw new Error('Missing recording')
    expect(ghostPoseAt({ car: 'blue', time: 2, frames: saved }, 0.95)?.x).toBe(1000)
    expect(ghostPoseAt({ car: 'blue', time: 2, frames: saved }, 1)?.x).toBe(0)
  })
  it('keeps the exact recovery timestamp when compacting a long recording', () => {
    const race = session(new BrowserGhostRepository(memory()))
    race.start(track, setup)
    const source = race.snapshot().state?.vehicles[0]
    if (!source) throw new Error('Missing player')
    const before = { ...source, x: 0, y: 0 }
    const after = { ...before, x: 1000 }
    const recorder = new GhostRecording(before, true)
    recorder.sample(before, 0.2)
    recorder.recover(before, after, 1)
    for (let index = 1; index <= 3300; index++) recorder.sample(after, 1 + index * 0.2)
    const saved = recorder.finish(after, 662)
    if (!saved) throw new Error('Missing recording')
    expect(saved.length).toBeLessThanOrEqual(MAX_GHOST_FRAMES)
    expect(ghostPoseAt({ car: 'blue', time: 662, frames: saved }, 1)?.x).toBe(1000)
    expect(saved.some((frame) => frame.cut && frame.t === 1)).toBe(true)
  })
  it('reports failure to replace an existing best while retaining the old replay', () => {
    const data = memory()
    let fail = false
    const store = new BrowserGhostRepository({ ...data, set: (key, value) => !fail && data.set(key, value) })
    store.record(track, setup, 1, frames)
    fail = true
    const race = session(store, finishAt(0.2))
    race.start(track, setup)
    race.advance(3.7, input)
    race.advance(0.25, input)
    expect(race.snapshot().result?.ghostSaveFailed).toBe(true)
    expect(store.load(track, setup)?.time).toBe(1)
  })
  it('saves a completed Arcade race including water recovery', () => {
    const store = new BrowserGhostRepository(memory())
    const race = session(store, finishAt(0.2, true))
    race.start(track, setup)
    race.advance(3.7, input)
    race.advance(0.25, input)
    expect(race.snapshot().result?.outcome).toBe('finished')
    const saved = store.load(track, setup)
    expect(saved).not.toBeNull()
    expect(saved?.frames.some((frame) => frame.cut)).toBe(true)
  })
  it('saves manual recoveries without interpolating across their teleport', () => {
    const store = new BrowserGhostRepository(memory())
    const race = session(store, finishAt(0.3))
    race.start(track, setup)
    race.advance(3.7, input)
    race.advance(0.1, input)
    race.resetPlayer()
    race.advance(0.25, input)
    expect(store.load(track, setup)?.frames.some((frame) => frame.cut)).toBe(true)
  })
  it('holds the pre-recovery position until the exact recovery timestamp', () => {
    const run = { car: 'blue' as const, time: 1,
      frames: [frames[0]!, { ...frames[1]!, cut: true }] }
    expect(ghostPoseAt(run, 0.5)?.x).toBe(0)
    expect(ghostPoseAt(run, 1)?.x).toBe(100)
  })
  it('shows a ghost only for explicitly selected solo Ghost Race', () => {
    const store = new BrowserGhostRepository(memory())
    store.record(track, setup, 1, frames)
    const race = session(store)
    race.start(track, setup)
    expect(race.snapshot().ghost).toBeNull()
    expect(race.snapshot().state?.vehicles).toHaveLength(4)
    race.start(track, { ...setup, mode: 'ghost' })
    expect(race.snapshot().ghost?.car).toBe('blue')
    expect(race.snapshot().ghostTime).toBe(1)
    expect(race.snapshot().state?.vehicles).toHaveLength(1)
    expect(race.ghostTime(track, setup)).toBe(1)
    race.start(track, { ...setup, car: 'red', mode: 'ghost' })
    expect(race.snapshot().setup?.mode).toBe('normal')
    expect(race.snapshot().state?.vehicles).toHaveLength(4)
  })
  it('keeps long Arcade races recordable within the sample budget', () => {
    const store = new BrowserGhostRepository(memory())
    const race = session(store, finishAt(360))
    race.start(track, setup)
    race.advance(3.7, input)
    for (let frame = 0; frame < 360 * 60; frame++) race.advance(1 / 60, input)
    const saved = store.load(track, setup)
    expect(saved).not.toBeNull()
    expect(saved?.frames.length).toBeLessThanOrEqual(MAX_GHOST_FRAMES)
    expect(saved?.frames[0]?.t).toBe(0)
    expect(saved?.frames.at(-1)?.t).toBeCloseTo(360)
  })
  it('keeps the original Ghost Race target after saving a faster finish', () => {
    const store = new BrowserGhostRepository(memory())
    store.record(track, setup, 1, frames)
    const race = session(store, finishAt(0.2))
    race.start(track, { ...setup, mode: 'ghost' })
    race.advance(3.7, input)
    race.advance(0.25, input)
    expect(race.snapshot().result?.ghostTime).toBe(1)
    expect(race.snapshot().ghostTime).toBe(1)
    expect(race.snapshot().result?.ghostSaved).toBe(true)
    expect(store.load(track, setup)?.time).toBeCloseTo(0.2)
  })
  it('evicts older combinations before failing to save a new best when storage is full', () => {
    const data = memory()
    let quota = Infinity
    const store = new BrowserGhostRepository({ ...data,
      set: (key, value) => value.length <= quota && data.set(key, value) })
    expect(store.record(track, setup, 1, frames)).toBe(true)
    quota = (data.get('trackforge-ghost-runs-v1')?.length ?? 0) + 20
    const other = { ...track, id: asTrackId('another-ghost') }
    expect(store.record(other, setup, 1, frames)).toBe(true)
    expect(store.load(other, setup)?.time).toBe(1)
    expect(store.load(track, setup)).toBeNull()
  })
})
