import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAR_IDS, type CarId, type DifficultyId } from '@/domain/model'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

// Deterministic SOLO AI comparison: no overtaking/traffic/grid interference.
// Identical path, start ratio, handling, seeds and vehicle specs across commits.
// Creator references (4-car live races) are Red 85.883 s, Green 71.383 s,
// Blue 79.967 s, and Yellow 72.117 s. Not directly solo-comparable.
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
      humanReferences: { redRecent: 85.883, greenBest: 71.38333333333057,
        blueBest: 79.96666666666341, yellowBest: 72.11666666666386 },
      matrix,
    }))
    expect(Object.keys(matrix)).toHaveLength(4)

    // Guard every car and difficulty against a hidden regression. Normal and
    // Easy must remain unchanged when calibrating the Hard-specific profiles.
    const baseline = JSON.parse(readFileSync(
      'qa/benchmarks/kidsRoomAiBaseline.json', 'utf8',
    )) as { matrix: Record<CarId, Record<DifficultyId, { times: number[] }>> }
    for (const car of CAR_IDS) {
      for (const difficulty of difficulties) {
        const run = matrix[car]?.[difficulty]
        const original = baseline.matrix[car]?.[difficulty]?.times
        expect(run?.recoveries, `${car} ${difficulty}`).toEqual([0, 0])
        expect(run?.times.every(t => t !== null && Number.isFinite(t)), `${car} ${difficulty}`).toBe(true)
        expect(original).toHaveLength(seeds.length)
        for (const [index, time] of (run?.times ?? []).entries()) {
          const old = original?.[index]
          if (old === undefined || time === null) continue
          if (difficulty !== 'hard') {
            expect(Math.abs(time - old), `${car} ${difficulty} seed ${seeds[index]}`).toBeLessThan(0.05)
          } else {
            expect(time, `${car} Hard seed ${seeds[index]} (before ${old.toFixed(3)} s)`)
              .toBeLessThanOrEqual(old + 0.05)
          }
        }
      }
    }
  }, 120_000)
})
