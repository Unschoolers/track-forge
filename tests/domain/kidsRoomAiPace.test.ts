import { RaceSession } from '@/application/race/raceSession'
import { RACE_TICK_SECONDS, stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput } from '../../qa/lanes/scenarios'

// Exact mixed-surface two-lap circuit reported by a player, anonymized.
// Their clean Green arcade finish was 1:12.900; unachieved competitive target tracked in #257.
const PLAYER_REFERENCE_SECONDS = 72.9
function loadKidsRoom() {
  const [track] = decodeTrackInput(
    JSON.parse(readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8')),
  )
  if (!track) throw new Error('Missing Kids room AI regression track')
  return track
}
const kidsRoom = loadKidsRoom()

function normalRivals(seed: number, difficulty: 'normal' | 'hard' = 'normal') {
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
    vehicles: starting.vehicles.filter(vehicle => !vehicle.player) }
  const recoveries: string[] = []
  const splits = new Map<string, string[]>()
  const surfaces = new Map<string, Record<string, number>>()
  // Temporary forensic telemetry for #257 (will be removed after calibration).
  const paceSegments = new Map<string, { count: number, speedSum: number,
    brakes: number, slow: number, slide: number, speedPeak: number }>()
  for (let tick = 0; tick < 150 / RACE_TICK_SECONDS; tick++) {
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
    if (tick % 6 === 0) {
      for (const vehicle of race.vehicles.filter(vehicle => !vehicle.player && vehicle.finishedAt === null)) {
        const surface = vehicle.currentSurface
        const key = `${vehicle.car}/${vehicle.nextSector}/${surface}`
        const sample = paceSegments.get(key) ?? { count: 0, speedSum: 0,
          brakes: 0, slow: 0, slide: 0, speedPeak: 0 }
        sample.count++
        sample.speedSum += vehicle.speed
        sample.brakes += vehicle.braking ? 1 : 0
        sample.slow += vehicle.speed < 95 ? 1 : 0
        sample.slide += Math.abs(vehicle.slip) > 12 ? 1 : 0
        sample.speedPeak = Math.max(sample.speedPeak, vehicle.speed)
        paceSegments.set(key, sample)
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
    paceSegments,
  }
}

describe('AI cornering on the Kids room mixed-surface circuit', () => {
  it.each([1, 4331])('finishes reliably with a competitive field (seed %i)', seed => {
    const { opponents, recoveries, splits, surfaces, paceSegments } = normalRivals(seed)
    if (seed === 1) {
      console.info('CORNER_PACE_FORENSICS', JSON.stringify(
        Array.from(paceSegments.entries()).sort(([a], [b]) => a.localeCompare(b))
          .map(([key, stat]) => ({
            key, seconds: Number((stat.count / 10).toFixed(1)),
            avg: Math.round(stat.speedSum / stat.count), peak: Math.round(stat.speedPeak),
            brakesPercent: Math.round(100 * stat.brakes / stat.count),
            slowPercent: Math.round(100 * stat.slow / stat.count),
            driftPercent: Math.round(100 * stat.slide / stat.count),
          }))))
    }
    const hard = normalRivals(seed, 'hard')
    const hardTimes = hard.opponents.map(vehicle => `${vehicle.car}:${vehicle.finishedAt?.toFixed(2) ?? 'DNF'}`).join(',')
    const times = opponents.map(vehicle => vehicle.finishedAt ?? Infinity)
    const diagnostic = opponents.map(vehicle =>
      `${vehicle.car}: ${vehicle.finishedAt?.toFixed(2) ?? 'DNF'}s, lap=${vehicle.lap}, gate=${vehicle.nextSector}`,
    ).join('; ') + `; hard=${hardTimes}; hardRecoveries=${hard.recoveries.join('; ')}; recoveries=${recoveries.join('; ')}; ` + opponents.map(v =>
      `${v.car} splits=${splits.get(v.id)?.join('/') ?? ''} surfaces=${JSON.stringify(surfaces.get(v.id))}`,
    ).join('; ')
    // The player's 1:12.900 was in Green: Red specializes in pavement, not
    // this circuit's dirt/ice. The distinct cars should *all* finish cleanly,
    // but must not be held to identical Green-car lap times. The stricter
    // Normal within-10-second target remains OPEN in GitHub issue #257.
    expect(opponents).toHaveLength(3)
    expect(times.every(Number.isFinite), diagnostic).toBe(true)
    expect(recoveries, diagnostic).toEqual([])
    expect(hard.recoveries, diagnostic).toEqual([])
    // After results appear, the live 40 s settlement budget should be enough
    // for the whole Normal field to produce actual, not invented finish times.
    expect(Math.max(...times), diagnostic).toBeLessThan(PLAYER_REFERENCE_SECONDS + 40)
    // Release competitiveness floors, not the unsolved pace stretch goal.
    expect(Math.min(...times), diagnostic).toBeLessThan(PLAYER_REFERENCE_SECONDS + 16)
    expect(Math.min(...hard.opponents.map(v => v.finishedAt ?? Infinity)), diagnostic)
      .toBeLessThan(PLAYER_REFERENCE_SECONDS + 12)
  }, 30000)
})
