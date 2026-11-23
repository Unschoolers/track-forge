// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAR_PASSING_POLICIES } from '@/domain/race/ai/aiCarPassingPolicies'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

function loadTrack() {
  const [track] = decodeTrackInput(JSON.parse(
    readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8'),
  ))
  if (!track) throw new Error('Missing Kids Room AI fixture')
  return track
}
const loaded = loadTrack()
const path = prepareLanePath(loaded)

function race(
  car: 'red' | 'yellow',
  mode: 'solo' | 'duel' | 'traffic',
  redAbandon?: number,
) {
  const red = CAR_PASSING_POLICIES.red
  return runLaneCheck({
    path, trackName: loaded.name, car, difficulty: 'hard',
    handling: 'arcade', seed: 4331, reversed: false,
    startRatio: 0.21932299012693934, laps: 2,
    mode, seconds: 140,
    ...(mode === 'duel' ? { duelOpponentCar: 'yellow' as const } : {}),
    ...(redAbandon !== undefined ? {
      aiPassingPolicyOverrides: {
        red: { ...red, abandonAfterSeconds: redAbandon },
      },
    } : {}),
  })
}

describe('Independent passing policy contracts', () => {
  it('explicit baseline policy is behaviorally identical to existing shared passing', () => {
    const oldRace = race('red', 'traffic')
    const newRace = race('red', 'traffic', 8)
    expect(newRace.vehicles).toEqual(oldRace.vehicles)
    expect(newRace.issues).toEqual(oldRace.issues)
    expect(newRace.samples).toEqual(oldRace.samples)
  }, 30000)

  it('changing Red passing leaves Yellow solo results bit-identical', () => {
    const control = race('yellow', 'solo')
    const redTuned = race('yellow', 'solo', 4)
    expect(redTuned.vehicles).toEqual(control.vehicles)
    expect(redTuned.samples).toEqual(control.samples)
    expect(redTuned.issues).toEqual(control.issues)
  }, 30000)

  it('runs a reproducible two-AI car duel with no third or fourth racer', () => {
    const first = race('red', 'duel')
    const second = race('red', 'duel')
    expect(first.vehicles).toHaveLength(2)
    expect(first.vehicles.map(v => v.car)).toEqual(['red', 'yellow'])
    expect(first.vehicles).toEqual(second.vehicles)
    expect(first.samples).toEqual(second.samples)
    expect(first.issues).toEqual(second.issues)
    expect(first.steps).toBeGreaterThan(0)
  }, 30000)

  it('rejects a duel without a real selected rival', () => {
    expect(() => runLaneCheck({
      path, trackName: loaded.name, car: 'red', mode: 'duel',
      seed: 1, difficulty: 'hard', handling: 'arcade',
      reversed: false, laps: 2, seconds: 50,
    })).toThrow(/Invalid lane simulation options/)
  })
})
