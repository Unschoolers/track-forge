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
it('calibrates Hard steering response on Pine Hairpins', () => {
  const { track } = requireFixture(OFFICIAL_CIRCUITS.find(({ track }) => track.name === 'Pine Hairpins'))
  const path = prepareLanePath(track)
  const mutable = AI_DRIVING_TUNING as unknown as { HARD_ARCADE_REACTION: number }
  const initial = mutable.HARD_ARCADE_REACTION
  const outcomes: unknown[] = []
  try {
    for (const response of [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 24]) {
      mutable.HARD_ARCADE_REACTION = response
      const run = runLaneCheck({
        path, trackName: track.name, seed: 11, difficulty: 'hard', car: 'blue',
        mode: 'solo', handling: 'arcade', reversed: false, seconds: 45, laps: 1,
      })
      const vehicle = requireFixture(run.vehicles[0])
      outcomes.push({ response, time: vehicle.finishedAt, recoveries: vehicle.recoveries,
        stopped: run.stoppedReason })
    }
  } finally {
    mutable.HARD_ARCADE_REACTION = initial
  }
  console.info('HARD_REACTION_SWEEP', JSON.stringify(outcomes))
}, 30000)
