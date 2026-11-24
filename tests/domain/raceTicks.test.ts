// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  RACE_TICK_SECONDS,
  stepRace,
  stepRaceTick,
  type RaceEvent,
} from '@/domain/race/raceEngine'
import { createRace } from '@/domain/race/raceFactory'
import { captureRaceSnapshot } from '@/domain/race/raceSnapshot'
import type { RaceState } from '@/domain/race/raceState'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { requireFixture } from '../fixtures/requireFixture'

const path = buildRoadPath([
  { x: 0, y: 0, surface: 'street' },
  { x: 600, y: 0, surface: 'street' },
], EMPTY_TERRAIN, undefined, 'point-to-point')
const accelerate = { steering: 0, throttle: 1, braking: false }
const coast = { steering: 0, throttle: 0, braking: false }

function startingGrid() {
  return createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
    path,
    routeKind: 'point-to-point',
    handling: 'simulation',
    playerCar: 'blue',
    difficulty: 'normal',
    laps: 1,
  })
}

function runningRace(): RaceState {
  return { ...startingGrid(), phase: 'running', countdown: 0 }
}

function randomSequence() {
  let seed = 42
  return {
    next: () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    },
  }
}

describe('fixed race ticks', () => {
  it('replays the same independent inputs and finish across two simulations', () => {
    const createTwoCarRace = (): RaceState => {
      const race = runningRace()
      // The first and third open-grid slots have clearance at the start.
      return {
        ...race,
        vehicles: [requireFixture(race.vehicles[0]), requireFixture(race.vehicles[2])],
      }
    }
    let first = createTwoCarRace()
    let second = createTwoCarRace()
    const firstRandom = randomSequence()
    const secondRandom = randomSequence()
    const playerId = requireFixture(first.vehicles[0]).id
    const rivalId = requireFixture(first.vehicles[1]).id
    const events: RaceEvent[] = []

    for (let tick = 1; tick <= 480 && first.phase === 'running'; tick++) {
      const rivalInput = {
        steering: tick >= 35 && tick < 42 ? 0.1 : 0,
        throttle: tick > 15 ? 0.55 : 0,
        braking: tick >= 75 && tick < 95,
      }
      const a = stepRaceTick(first, {
        tick, controls: { [playerId]: accelerate, [rivalId]: rivalInput },
      }, firstRandom)
      const b = stepRaceTick(second, {
        tick, controls: { [rivalId]: rivalInput, [playerId]: accelerate },
      }, secondRandom)
      first = a.state
      second = b.state
      events.push(...a.events)

      expect(captureRaceSnapshot(first)).toEqual(captureRaceSnapshot(second))
      expect(a.events).toEqual(b.events)
      expect(first.tick).toBe(tick)
      if (tick === 15) {
        expect(first.vehicles[0]?.speed).toBeGreaterThan(0)
        expect(first.vehicles[1]?.speed).toBe(0)
      }
      if (tick === 75) {
        expect(first.vehicles[0]?.braking).toBe(false)
        expect(first.vehicles[1]?.braking).toBe(true)
      }
    }

    const snapshot = captureRaceSnapshot(first)
    expect(snapshot.phase).toBe('finished')
    expect(snapshot.vehicles[0]).toMatchObject({ lap: 1, finishedAt: snapshot.elapsed })
    expect(snapshot.vehicles[1]?.finishedAt).toBeNull()
    expect(events.flatMap((event) =>
      event.type === 'gate-crossed' && event.vehicleId === playerId ? [event.gate] : [],
    )).toEqual([1, 2, 3, 4])
    expect(events.at(-1)).toEqual({ type: 'race-finished', reason: 'finished' })
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    expect(snapshot).not.toHaveProperty('path')
    expect(snapshot).not.toHaveProperty('effects')
    expect(snapshot.vehicles[1]).not.toHaveProperty('ai')
  })

  it('matches the regular race step when only primary controls are supplied', () => {
    let fixed = runningRace()
    let regular = runningRace()
    const fixedRandom = randomSequence()
    const regularRandom = randomSequence()
    for (let tick = 1; tick <= 60; tick++) {
      const input = tick <= 30 ? accelerate : { ...coast, braking: true }
      const a = stepRaceTick(fixed, { tick, controls: { player: input } }, fixedRandom)
      const b = stepRace(regular, input, RACE_TICK_SECONDS, regularRandom)
      expect(a).toEqual(b)
      fixed = a.state
      regular = b.state
    }
    expect(fixed.vehicles[1]?.speed).toBeGreaterThan(0)
  })

  it('requires the next tick and preserves it while the race cannot advance', () => {
    const random = randomSequence()
    const initial = startingGrid()
    const running = runningRace()
    const input = { tick: 1, controls: {} }
    const paused = { ...running, paused: true }

    expect(stepRaceTick(initial, input, random).state).toBe(initial)
    expect(stepRaceTick(paused, input, random).state).toBe(paused)
    const result = stepRaceTick(running, input, random)

    expect(result.state.tick).toBe(1)
    expect(result.state.elapsed).toBe(RACE_TICK_SECONDS)
    expect(() => stepRaceTick(result.state, input, random)).toThrow(RangeError)
    expect(() => stepRaceTick(result.state, { ...input, tick: 3 }, random)).toThrow(RangeError)

    const finished = { ...result.state, phase: 'finished' as const }
    expect(stepRaceTick(finished, { ...input, tick: 2 }, random).state).toBe(finished)
  })
})
