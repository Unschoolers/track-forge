// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import type { CarId, DifficultyId } from '@/domain/model'

// Diagnostic experiment: override only the Hard speed-target reserve, never
// vehicle forces, surfaces, or checkpoint/recovery rules.
const probe = vi.hoisted(() => ({ margin: null as number | null }))
vi.mock('@/domain/race/ai/difficultyPolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/domain/race/ai/difficultyPolicy')>()
  return {
    ...original,
    arcadeCornerMargin: (difficulty: DifficultyId, car?: CarId) =>
      difficulty === 'hard' && probe.margin !== null
        ? probe.margin : original.arcadeCornerMargin(difficulty, car),
  }
})

import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

it('diagnoses hard corner reserve efficiency on a fixed mixed-surface circuit', () => {
  const [track] = decodeTrackInput(JSON.parse(
    readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8'),
  ))
  if (!track) throw new Error('Kids Room fixture missing')
  const path = prepareLanePath(track)
  const values: Array<number | null> = [null, 0, 0.02, 0.035, 0.05, 0.065, 0.08, 0.10]
  const matrix: Record<string, unknown> = {}
  try {
    for (const car of ['blue', 'green'] as const) {
      const results: Record<string, unknown> = {}
      for (const margin of values) {
        probe.margin = margin
        const runs = [1, 4331].map(seed => {
          const run = runLaneCheck({
            path, trackName: track.name, seed, difficulty: 'hard',
            car, handling: 'arcade', mode: 'solo', reversed: false,
            startRatio: 0.21932299012693934, seconds: 150, laps: 2,
          })
          return {
            time: run.vehicles[0]?.finishedAt ?? null,
            recoveries: run.vehicles[0]?.recoveries ?? null,
            offRoadSeconds: run.vehicles[0]?.offRoadSeconds ?? null,
          }
        })
        results[margin === null ? 'original' : String(margin)] = runs
      }
      matrix[car] = results
    }
  } finally {
    probe.margin = null
  }
  console.log('AI_HARD_RESERVE_SWEEP ' + JSON.stringify(matrix))
  expect(Object.keys(matrix)).toHaveLength(2)
}, 180_000)
