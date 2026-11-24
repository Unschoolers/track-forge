import { RaceSession } from '@/application/race/raceSession'
import { RACE_TICK_SECONDS, stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput } from '../../qa/lanes/scenarios'

// Exact mixed-surface two-lap circuit reported by a player, anonymized.
function loadKidsRoom() {
  const [track] = decodeTrackInput(
    JSON.parse(readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8')),
  )
  if (!track) throw new Error('Missing Kids room AI regression track')
  return track
}
const kidsRoom = loadKidsRoom()

function raceRivals(seed: number, difficulty: 'easy' | 'normal' | 'hard' = 'normal', playerCar: 'green' | 'red' = 'green') {
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
  session.start(kidsRoom, { car: playerCar, difficulty, laps: 2 })
  const starting = session.snapshot().state
  session.destroy()
  if (!starting) throw new Error('Missing Kids room race state')
  // The player's stationary test vehicle must not obstruct the grid. Measure real rival AI on its own.
  let race: RaceState = { ...starting, phase: 'running', countdown: 0,
    vehicles: starting.vehicles.filter(vehicle => !vehicle.player) }
  const recoveries: string[] = []
  const splits = new Map<string, string[]>()
  const surfaces = new Map<string, Record<string, number>>()
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
    if (tick % 60 === 0) {
      for (const vehicle of race.vehicles.filter(vehicle => !vehicle.player && vehicle.finishedAt === null)) {
        const stats = surfaces.get(vehicle.id) ?? {}
        const surface = vehicle.currentSurface ?? 'unknown'
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

describe('AI cornering on the Kids room mixed-surface circuit', () => {
  it.each([1, 4331])('finishes reliably with a clean field (seed %i)', seed => {
    const { opponents, recoveries, splits, surfaces } = raceRivals(seed)
    const hard = raceRivals(seed, 'hard')
    const hardTimes = hard.opponents.map(vehicle => `${vehicle.car}:${vehicle.finishedAt?.toFixed(2) ?? 'DNF'}`).join(',')
    const times = opponents.map(vehicle => vehicle.finishedAt ?? Infinity)
    const diagnostic = opponents.map(vehicle =>
      `${vehicle.car}: ${vehicle.finishedAt?.toFixed(2) ?? 'DNF'}s, lap=${vehicle.lap}, gate=${vehicle.nextSector}`,
    ).join('; ') + `; hard=${hardTimes}; hardRecoveries=${hard.recoveries.join('; ')}; recoveries=${recoveries.join('; ')}; ` + opponents.map(v =>
      `${v.car} splits=${splits.get(v.id)?.join('/') ?? ''} surfaces=${JSON.stringify(surfaces.get(v.id))}`,
    ).join('; ')
    // The player's 1:12.900 was in Green: Red specializes in pavement, not
    // this circuit's dirt/ice. All cars should finish cleanly, but don't
    // demand that Red or Yellow match Green's player lap times.
    expect(opponents).toHaveLength(3)
    expect(times.every(Number.isFinite), diagnostic).toBe(true)
    expect(recoveries, diagnostic).toEqual([])
    expect(hard.recoveries, diagnostic).toEqual([])
    expect(hard.opponents.every(v => Number.isFinite(v.finishedAt)), diagnostic).toBe(true)
  }, 30000)
})

describe('Green AI completes mixed-surface Kids room', () => {
  it.each([1, 4331])('completes a clean two-lap race (seed %i)', seed => {
    // Select Red as the stationary player so Green takes a real AI grid slot.
    const { opponents, recoveries } = raceRivals(seed, 'normal', 'red')
    const green = opponents.find(vehicle => vehicle.car === 'green')
    const blue = opponents.find(vehicle => vehicle.car === 'blue')
    const yellow = opponents.find(vehicle => vehicle.car === 'yellow')
    const diagnostics = opponents.map(vehicle =>
      `${vehicle.car}=${vehicle.finishedAt?.toFixed(3) ?? 'DNF'}`).join('; ')
    expect(recoveries, diagnostics).toEqual([])
    expect(green?.finishedAt, diagnostics).not.toBeNull()
    expect(blue?.finishedAt, diagnostics).not.toBeNull()
    expect(yellow?.finishedAt, diagnostics).not.toBeNull()
    expect(opponents.every(v => Number.isFinite(v.finishedAt)), diagnostics).toBe(true)
  }, 30000)
})

describe('Hard-first Green AI safety on the real Kids room circuit', () => {
  it.each([1, 4331])('finishes on every difficulty without conflating different AI grids (seed %i)', seed => {
    const runs = (['hard', 'normal', 'easy'] as const).map(difficulty => {
      // Red occupies the human slot; Green remains a real AI on the original grid.
      const result = raceRivals(seed, difficulty, 'red')
      const green = result.opponents.find(vehicle => vehicle.car === 'green')
      return { difficulty, green, recoveries: result.recoveries,
        surfaces: green ? result.surfaces.get(green.id) : undefined,
        splits: green ? result.splits.get(green.id) : undefined }
    })
    const diagnostics = runs.map(({ difficulty, green, recoveries, surfaces, splits }) =>
      `${difficulty}: Green=${green?.finishedAt?.toFixed(3) ?? 'DNF'}, recoveries=${recoveries.join(',')}, surfaces=${JSON.stringify(surfaces)}, splits=${splits?.join('/')}`
    ).join('; ')
    for (const { green, recoveries } of runs) {
      expect(green?.finishedAt, diagnostics).not.toBeNull()
      expect(Number.isFinite(green?.finishedAt), diagnostics).toBe(true)
      expect(recoveries, diagnostics).toEqual([])
    }
  }, 30000)
})
