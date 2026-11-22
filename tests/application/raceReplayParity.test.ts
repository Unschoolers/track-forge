// @vitest-environment node
import { expect, it } from 'vitest'
import { RaceSession, type RaceSetup } from '@/application/race/raceSession'
import { asTrackId, type Track } from '@/domain/model'
import {
  RACE_TICK_SECONDS, stepRace, stepRaceTick, type RaceEvent, type RaceTickInput,
} from '@/domain/race/raceEngine'
import { createRace } from '@/domain/race/raceFactory'
import { rankVehicles } from '@/domain/race/ranking'
import { captureRaceSnapshot } from '@/domain/race/raceSnapshot'
import type { RaceState } from '@/domain/race/raceState'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { requireFixture } from '../fixtures/requireFixture'

function seededRandom(seed: number) {
  return {
    next() {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    },
  }
}

it('replays a seeded four-car race with the same checkpoint recovery and finish order', () => {
  const track = {
    id: asTrackId('replay-stage'),
    name: 'Replay Stage', version: 8, routeKind: 'point-to-point',
    points: [{ x: 0, y: 0, surface: 'street' }, { x: 1800, y: 0, surface: 'street' }],
    terrain: EMPTY_TERRAIN, trees: [], recoveryCheckpoints: [0.06],
    lighting: 'day', createdAt: 1, updatedAt: 1,
  } satisfies Track
  const setup: RaceSetup = { mode: 'normal', car: 'blue', difficulty: 'normal', laps: 1, handling: 'arcade' }
  const geometry = new TrackGeometryService()
  const liveEvents: RaceEvent[] = []
  const replayEvents: RaceEvent[] = []
  const seed = 42
  const replayRandom = seededRandom(seed)
  const session = new RaceSession({
    geometry,
    random: seededRandom(seed),
    scoreStore: { record: () => true, forTrack: () => [], removeTrack: () => true },
    feedback: { unlock() {}, setEnabled() {}, handle() {}, silenceContinuous() {}, destroy() {} },
    step: (state, input, seconds, random) => {
      const result = stepRace(state, input, seconds, random)
      liveEvents.push(...result.events)
      return result
    },
  })
  session.start(track, setup)
  const initial = requireFixture(session.snapshot().state)
  expect(initial.vehicles).toHaveLength(4)
  expect(initial.vehicles.filter((vehicle) => vehicle.ai)).toHaveLength(3)
  const playerId = requireFixture(initial.vehicles.find((vehicle) => vehicle.player)).id
  let replay: RaceState = {
    ...createRace({
      path: geometry.get(track).path, routeKind: track.routeKind,
      playerCar: setup.car, handling: setup.handling, difficulty: setup.difficulty, laps: setup.laps,
      recoveryCheckpoints: track.recoveryCheckpoints, recoveryScenery: track,
    }),
    phase: 'running',
    countdown: 0,
  }
  const recoveryTick = 140
  // Slow the player after recovery so the replay captures the rivals' finish times.
  const inputs: RaceTickInput[] = Array.from({ length: 1800 }, (_, index) => ({
    tick: index + 1,
    controls: { [playerId]: { steering: 0, throttle: 1, braking: index < 42 || (index >= 200 && index < 480) } },
    ...(index + 1 === recoveryTick ? { recoverPlayer: true } : {}),
  }))
  session.advance(initial.countdown, { steering: 0, throttle: 0, braking: false })
  expect(captureRaceSnapshot(requireFixture(session.snapshot().state))).toEqual(captureRaceSnapshot(replay))

  for (const input of inputs) {
    if (input.recoverPlayer) {
      const before = requireFixture(session.snapshot().state?.vehicles.find((vehicle) => vehicle.player))
      const contactIndex = requireFixture(before.lastRoadContactIndex)
      session.resetPlayer()
      const after = requireFixture(session.snapshot().state?.vehicles.find((vehicle) => vehicle.player))
      expect(after.pathIndex).toBe(contactIndex)
      expect(after.x).toBeLessThan(before.x)
    }
    session.advance(RACE_TICK_SECONDS, requireFixture(input.controls[playerId]))
    const next = stepRaceTick(replay, input, replayRandom)
    replay = next.state
    replayEvents.push(...next.events)
    const live = requireFixture(session.snapshot().state)
    expect(captureRaceSnapshot(live)).toEqual(captureRaceSnapshot(replay))
    if (live.phase === 'finished') break
  }

  const result = requireFixture(session.snapshot().result)
  expect(result.outcome).toBe('finished')
  expect(replay.tick).toBeGreaterThan(recoveryTick)
  expect(liveEvents).toEqual(replayEvents)
  const playerSplits = replayEvents.flatMap((event) =>
    event.type === 'gate-crossed' && event.vehicleId === playerId
      ? [{ gate: event.gate, lap: event.lap, time: event.time }]
      : [],
  )
  expect(playerSplits.map(({ gate }) => gate)).toEqual([1, 2, 3, 4])
  expect(result.splits).toEqual(playerSplits)
  const ranks = rankVehicles(replay.vehicles, replay.path.points.length, replay.startPathIndex, replay.reversed, replay.routeKind)
  expect(result.standings.map(({ id, finishTime }) => [id, finishTime]))
    .toEqual(ranks.map(({ id, finishedAt }) => [id, finishedAt]))
  expect(ranks.filter((vehicle) => vehicle.finishedAt !== null)).toHaveLength(4)
})
