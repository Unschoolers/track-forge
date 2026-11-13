import { expect, it } from 'vitest'
import { CAR_IDS, DIFFICULTY_IDS } from '@/domain/model'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

it('orders comparable official-circuit solo finishes by difficulty', () => {
  const finishes: Record<string, number[]> = { easy: [], normal: [], hard: [] }
  for (const { track } of OFFICIAL_CIRCUITS) {
    const path = prepareLanePath(track)
    for (const car of CAR_IDS) {
      for (const difficulty of DIFFICULTY_IDS) {
        const result = runLaneCheck({ path, trackName: track.name, seed: 1,
          difficulty, car, mode: 'solo', reversed: false, seconds: 120, laps: 1 })
        const finish = result.vehicles[0]?.finishedAt
        expect(finish).not.toBeNull()
        expect(finish).not.toBeUndefined()
        if (finish != null) finishes[difficulty]?.push(finish)
      }
    }
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const middle = sorted.length / 2
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  }
  expect(finishes.easy).toHaveLength(24)
  expect(finishes.normal).toHaveLength(24)
  expect(finishes.hard).toHaveLength(24)
  expect(median(finishes.easy ?? [])).toBeGreaterThan(median(finishes.normal ?? []))
  expect(median(finishes.normal ?? [])).toBeGreaterThan(median(finishes.hard ?? []))
}, 120_000)
