import { RaceSession } from '@/application/race/raceSession'
import { RACE_TICK_SECONDS, stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput } from '../../qa/lanes/scenarios'

// Exact mixed-surface two-lap circuit reported by a player, anonymized.
// Their clean Green arcade finish was 1:12.900; Medium rivals should race it.
const PLAYER_REFERENCE_SECONDS = 72.9
function loadKidsRoom() {
  const [track] = decodeTrackInput(
    JSON.parse(readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8')),
  )
  if (!track) throw new Error('Missing Kids room AI regression track')
  return track
}
const kidsRoom = loadKidsRoom()

function normalRivals(seed: number, difficulty: 'normal' | 'hard' = 'normal', chaseReference = false) {
  let state = seed >>> 0
  const random = {
    next: () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    },
  }
  const session = new RaceSession({
    geometry: new TrackGeometryService(),
    random,
    scoreStore: { forTrack: () => [], record: () => true, removeTrack: () => true },
    feedback: { unlock() {}, setEnabled() {}, handle() {}, silenceContinuous() {}, destroy() {} },
  })
  session.start(kidsRoom, { car: 'green', difficulty, laps: 2, handling: 'arcade' })
  const starting = session.snapshot().state
  session.destroy()
  if (!starting) throw new Error('Missing Kids room race state')
  // The player's stationary test vehicle must not obstruct the grid. Measure real rival AI on its own.
  let race: RaceState = { ...starting, phase: 'running', countdown: 0,
    vehicles: chaseReference ? starting.vehicles : starting.vehicles.filter(vehicle => !vehicle.player) }
  const recoveries: string[] = []
  const splits = new Map<string, string[]>()
  const surfaces = new Map<string, Record<string, number>>()
  for (let tick = 0; tick < 150 / RACE_TICK_SECONDS; tick++) {
    if (chaseReference) {
      const elapsed = tick * RACE_TICK_SECONDS
      // A reference pacer follows the player's two-lap 1:12.900 progress.
      // Keep its pose off the road so it cannot block traffic or cause contact.
      // It stops providing catch-up once the player's finish time is reached.
      if (elapsed >= PLAYER_REFERENCE_SECONDS) {
        race = { ...race, vehicles: race.vehicles.filter(vehicle => !vehicle.player) }
      } else {
        const progress = elapsed * 2 / PLAYER_REFERENCE_SECONDS
        const lap = Math.floor(progress)
        const fraction = progress - lap
        const rawIndex = race.startPathIndex + Math.floor(fraction * race.path.points.length) *
          (race.reversed ? -1 : 1)
        const index = ((rawIndex % race.path.points.length) + race.path.points.length) %
          race.path.points.length
        const point = race.path.points[index]
        if (!point) throw new Error('Missing reference pacer road sample')
        const pacer = race.vehicles.find(vehicle => vehicle.player)
        if (!pacer) throw new Error('Missing reference pacer')
        const speed = race.path.totalLength * 2 / PLAYER_REFERENCE_SECONDS
        race = { ...race, vehicles: race.vehicles.map(vehicle =>
          vehicle.player ? {
            ...pacer, x: point.x + 10000, y: point.y + 10000, z: 0,
            pathIndex: index, pathDistance: point.distance, lap,
            nextSector: Math.max(1, Math.min(4, Math.floor(fraction * 4) + 1)) as 1 | 2 | 3 | 4,
            currentSurface: point.surface, speed, vx: speed, vy: 0,
            finishedAt: null, grounded: true, wrecked: false,
          } : vehicle) }
      }
    }
    const before = race
    const stepped = stepRace(
      race,
      { steering: 0, throttle: 0, braking: true },
      RACE_TICK_SECONDS,
      random,
    )
    race = stepped.state
    for (const event of stepped.events) {
      if (event.type === 'gate-crossed' && event.vehicleId !== 'player') {
        const times = splits.get(event.vehicleId) ?? []
        times.push(`${event.lap}:${event.gate}@${event.time.toFixed(1)}`)
        splits.set(event.vehicleId, times)
      }
      if (event.type === 'vehicle-recovered' && event.vehicleId !== 'player') {
        const vehicle = race.vehicles.find(candidate => candidate.id === event.vehicleId)
        const prior = before.vehicles.find(candidate => candidate.id === event.vehicleId)
        const point = race.path.points[event.pathIndex]
        const distance = point ? Math.hypot((prior?.x ?? 0) - point.x, (prior?.y ?? 0) - point.y) : NaN
        recoveries.push(`${vehicle?.car ?? event.vehicleId}@${race.elapsed.toFixed(1)}s, reason=${event.reason}, x=${event.x.toFixed(0)}, y=${event.y.toFixed(0)}, index=${event.pathIndex}, surface=${point?.surface ?? '?'}, speed=${prior?.speed.toFixed(0) ?? '?'}, slip=${prior?.slip.toFixed(0) ?? '?'}, yaw=${prior?.yawRate.toFixed(2) ?? '?'}, offset=${distance.toFixed(0)}`)
      }
    }
    if (tick % 60 === 0) {
      for (const vehicle of race.vehicles.filter(vehicle => !vehicle.player && vehicle.finishedAt === null)) {
        const stats = surfaces.get(vehicle.id) ?? {}
        const surface = race.path.points[vehicle.pathIndex]?.surface ?? 'unknown'
        stats[surface] = (stats[surface] ?? 0) + 1
        surfaces.set(vehicle.id, stats)
      }
    }
    if (race.vehicles.filter(vehicle => !vehicle.player).every(vehicle => vehicle.finishedAt !== null)) break
  }
  return {
    opponents: race.vehicles.filter(vehicle => !vehicle.player),
    recoveries,
    splits,
    surfaces,
  }
}

describe('Normal AI on the Kids room mixed-surface circuit', () => {
  it.each([1, 4331])('finishes two laps near the player reference pace (seed %i)', seed => {
    const { opponents, recoveries, splits, surfaces } = normalRivals(seed)
    const hard = normalRivals(seed, 'hard')
    const chasing = normalRivals(seed, 'normal', true)
    const chasingTimes = chasing.opponents.map(vehicle => `${vehicle.car}:${vehicle.finishedAt?.toFixed(2) ?? 'DNF'}`).join(',')
    const hardTimes = hard.opponents.map(vehicle => `${vehicle.car}:${vehicle.finishedAt?.toFixed(2) ?? 'DNF'}`).join(',')
    const times = opponents.map(vehicle => vehicle.finishedAt ?? Infinity)
    const diagnostic = opponents.map(vehicle =>
      `${vehicle.car}: ${vehicle.finishedAt?.toFixed(2) ?? 'DNF'}s, lap=${vehicle.lap}, gate=${vehicle.nextSector}`,
    ).join('; ') + `; paced=${chasingTimes}; pacedRecoveries=${chasing.recoveries.join('; ')}; hard=${hardTimes}; hardRecoveries=${hard.recoveries.join('; ')}; recoveries=${recoveries.join('; ')}; ` + opponents.map(v =>
      `${v.car} splits=${splits.get(v.id)?.join('/') ?? ''} surfaces=${JSON.stringify(surfaces.get(v.id))}`,
    ).join('; ')
    expect(opponents).toHaveLength(3)
    expect(recoveries, diagnostic).toEqual([])
    expect(Math.max(...times), diagnostic).toBeLessThan(PLAYER_REFERENCE_SECONDS * 1.28)
    expect(Math.min(...times), diagnostic).toBeLessThan(PLAYER_REFERENCE_SECONDS * 1.10)
  }, 30000)
})
