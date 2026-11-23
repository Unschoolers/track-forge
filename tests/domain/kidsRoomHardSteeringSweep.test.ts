// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

// Isolated Hard steering-policy experiment for the balanced Blue chassis.
// Keep physical yaw, grip, speed, surfaces and opponents unchanged.
const probe = vi.hoisted(() => ({
  reaction: null as number | null,
  gain: null as number | null,
}))
vi.mock('@/domain/race/ai/aiDrivingTuning', async importOriginal => {
  const original = await importOriginal<typeof import('@/domain/race/ai/aiDrivingTuning')>()
  return {
    ...original,
    AI_DRIVING_TUNING: {
      ...original.AI_DRIVING_TUNING,
      get HARD_ARCADE_REACTION() {
        return probe.reaction ?? original.AI_DRIVING_TUNING.HARD_ARCADE_REACTION
      },
      get HARD_ARCADE_STEER_GAIN() {
        return probe.gain ?? original.AI_DRIVING_TUNING.HARD_ARCADE_STEER_GAIN
      },
    },
  }
})

import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

it('diagnoses physically unchanged Hard Blue steering response', () => {
  const [track] = decodeTrackInput(JSON.parse(
    readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8'),
  ))
  if (!track) throw new Error('Kids Room fixture missing')
  const path = prepareLanePath(track)
  const variants = [
    [8, 2.22], [6, 2.22], [10, 2.22], [12, 2.22],
    [8, 2.42], [10, 2.42], [12, 2.42],
    [6, 2.42], [8, 2.7], [10, 2.7],
    [12, 2.7], [14, 2.7], [10, 2.95],
    [12, 2.95],
  ] as const
  const matrix: Record<string, unknown> = {}
  try {
    for (const [reaction, gain] of variants) {
      probe.reaction = reaction
      probe.gain = gain
      const results = [1, 4331].map(seed => {
        const run = runLaneCheck({
          path, trackName: track.name, seed, difficulty: 'hard',
          car: 'blue', handling: 'arcade', mode: 'solo',
          reversed: false, startRatio: 0.21932299012693934,
          seconds: 150, laps: 2,
        })
        return {
          time: run.vehicles[0]?.finishedAt ?? null,
          recoveries: run.vehicles[0]?.recoveries ?? null,
          offRoadSeconds: run.vehicles[0]?.offRoadSeconds ?? null,
        }
      })
      matrix[`${reaction}/${gain}`] = results
    }
  } finally {
    probe.reaction = null
    probe.gain = null
  }
  console.log(`AI_HARD_BLUE_STEERING_SWEEP ${JSON.stringify(matrix)}`)
  expect(Object.keys(matrix)).toHaveLength(variants.length)
}, 180_000)
