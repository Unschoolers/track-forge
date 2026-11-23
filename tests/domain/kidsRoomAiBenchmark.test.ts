import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAR_IDS, type CarId, type DifficultyId } from '@/domain/model'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

// Deterministic SOLO AI comparison: no overtaking/traffic/grid interference.
// Identical path, start ratio, handling, seeds and vehicle specs across commits.
// Human references are 2-lap Green 72.900 s (best) and Red 85.883 s.
// Times here describe AI solo drives, NOT the four-car live race times.
const reference = JSON.parse(
  readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8'),
) as unknown
const [track] = decodeTrackInput(reference)
if (!track) throw new Error('Missing Kids Room AI benchmark track')
const path = prepareLanePath(track)
const difficulties: readonly DifficultyId[] = ['easy', 'normal', 'hard']
const seeds = [1, 4331] as const
const startRatio = 0.21932299012693934

describe('Kids Room deterministic all-car three-difficulty AI pace benchmark', () => {
  it('records identical-course before/after times and physical recoveries', () => {
    const matrix: Record<string, Record<string, {
      times: (number | null)[]
      recoveries: number[]
      offRoadSeconds: number[]
    }>> = {}
    for (const car of CAR_IDS) {
      const record: Record<string, { times: (number | null)[], recoveries: number[], offRoadSeconds: number[] }> = {}
      matrix[car] = record
      for (const difficulty of difficulties) {
        const times: (number | null)[] = []
        const recoveries: number[] = []
        const offRoadSeconds: number[] = []
        for (const seed of seeds) {
          const result = runLaneCheck({
            path,
            trackName: track.name,
            seed,
            difficulty,
            car: car as CarId,
            handling: 'arcade',
            mode: 'solo',
            reversed: false,
            startRatio,
            seconds: 150,
            laps: 2,
          })
          const v = result.vehicles[0]
          times.push(v?.finishedAt ?? null)
          recoveries.push(v?.recoveries ?? -1)
          offRoadSeconds.push(Number((v?.offRoadSeconds ?? 0).toFixed(3)))
        }
        record[difficulty] = { times, recoveries, offRoadSeconds }
      }
    }
    // Search CI job logs for the single-line JSON: read on the baseline commit
    // and the final tuning commit and compare the *same* 12 cases.
    console.log('AI_PACE_MATRIX ' + JSON.stringify({
      track: track.name, handling: 'arcade', laps: 2,
      startRatio, seeds, type: 'solo AI, no opponents',
      humanReferences: { greenBest: 72.9, redRecent: 85.883 },
      matrix,
    }))
    expect(Object.keys(matrix)).toHaveLength(4)
  }, 120_000)
})
