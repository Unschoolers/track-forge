// @vitest-environment node
import { expect, it } from 'vitest'
import { AI_DRIVING_TUNING } from '@/domain/race/ai/aiDrivingTuning'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { createLaneScenarios, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'
import { requireFixture } from '../fixtures/requireFixture'

it('laps Pine Hairpins faster on Hard with the same car and no traffic', () => {
  const { track } = requireFixture(OFFICIAL_CIRCUITS.find(({ track }) => track.name === 'Pine Hairpins'))
  const path = prepareLanePath(track)
  const [medium, hard] = (['normal', 'hard'] as const).map((difficulty) => {
    const run = runLaneCheck({
      path, trackName: track.name, seed: 11,
      difficulty, car: 'blue', mode: 'solo', handling: 'arcade',
      reversed: false, seconds: 45, laps: 1,
    })

    expect(run.stoppedReason).toBe('finished')
    const vehicle = requireFixture(run.vehicles[0])
    expect(vehicle.recoveries).toBe(0)
    return requireFixture(vehicle.finishedAt)
  })

  expect(requireFixture(hard)).toBeLessThan(requireFixture(medium))
})


it.each([false, true])('keeps Hard traffic on the hairpin circuit in reverse=%s', (reversed) => {
  const track = requireFixture(createLaneScenarios().find(({ id }) => id === 'hairpin'))
  const run = runLaneCheck({
    path: prepareLanePath(track), trackName: track.name, seed: 1,
    difficulty: 'hard', car: 'blue', mode: 'traffic', handling: 'simulation',
    reversed, seconds: 45, laps: 1,
  })
  expect(run.stoppedReason).toBe('finished')
  expect(run.vehicles.reduce((total, vehicle) => total + vehicle.recoveries, 0)).toBeLessThanOrEqual(3)
})


// Research-only sweep for #257; remove after selecting a stable setting.
it('calibrates Hard pursuit and steering on Pine Hairpins', () => {
  const { track } = requireFixture(OFFICIAL_CIRCUITS.find(({ track }) => track.name === 'Pine Hairpins'))
  const path = prepareLanePath(track)
  const mutable = AI_DRIVING_TUNING as unknown as {
    HARD_ARCADE_REACTION: number
    HARD_ARCADE_STEER_GAIN: number
    HARD_EXTRA_LOOKAHEAD_SAMPLES: number
  }
  const initial = { ...mutable }
  const candidates: { reaction: number, gain: number, lookAhead: number }[] = []
  for (const lookAhead of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    candidates.push({ reaction: 8, gain: 2.42, lookAhead })
  }
  for (const gain of [1.8, 2.05, 2.22, 2.32, 2.55, 2.7, 2.9, 3.1]) {
    candidates.push({ reaction: 8, gain, lookAhead: 4 })
  }
  for (const gain of [2.22, 2.55, 2.8]) {
    for (const lookAhead of [0, 1, 2, 3, 5, 6]) {
      candidates.push({ reaction: 8, gain, lookAhead })
    }
  }
  const outcomes: unknown[] = []
  try {
    for (const candidate of candidates) {
      mutable.HARD_ARCADE_REACTION = candidate.reaction
      mutable.HARD_ARCADE_STEER_GAIN = candidate.gain
      mutable.HARD_EXTRA_LOOKAHEAD_SAMPLES = candidate.lookAhead
      const run = runLaneCheck({
        path, trackName: track.name, seed: 11, difficulty: 'hard', car: 'blue',
        mode: 'solo', handling: 'arcade', reversed: false, seconds: 45, laps: 1,
      })
      const vehicle = requireFixture(run.vehicles[0])
      outcomes.push({ ...candidate, time: vehicle.finishedAt,
        recoveries: vehicle.recoveries, stopped: run.stoppedReason })
    }
  } finally {
    Object.assign(mutable, initial)
  }
  console.info('HARD_PURSUIT_SWEEP', JSON.stringify(outcomes))
}, 60000)
