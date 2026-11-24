// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { createLaneScenarios, decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

type Scenario = {
  name: string
  file?: string
  official?: string
  qa?: string
  startRatio: number
  reversed: boolean
  laps: number
  seconds: number
  gridPositions?: readonly number[]
}
const scenarios: readonly Scenario[] = [
  { name: 'Figure-eight replay', file: 'tests/fixtures/figureEightRaceAi.trackforge.json',
    startRatio: 0.32853982300884954, reversed: false, laps: 2, seconds: 100,
    gridPositions: [0, 2, 3, 1] },
  { name: 'Desert reverse', file: 'tests/fixtures/desertSandAi.trackforge.json',
    startRatio: 0.7794871794871795, reversed: true, laps: 2, seconds: 70,
    gridPositions: [1, 3, 0, 2] },
  { name: 'Kids Room', file: 'tests/fixtures/kidsRoomAi.trackforge.json',
    startRatio: 0.21932299012693934, reversed: false, laps: 2, seconds: 145 },
  { name: 'Hairpin circuit', qa: 'hairpin',
    startRatio: 0, reversed: false, laps: 1, seconds: 80 },
  { name: 'City Sprint', official: 'City Sprint',
    startRatio: 0, reversed: false, laps: 1, seconds: 75 },
]
const pathCache = scenarios.map(scenario => {
  const track = scenario.file
    ? decodeTrackInput(JSON.parse(readFileSync(scenario.file, 'utf8')))[0]
    : scenario.qa ? createLaneScenarios().find(entry => entry.id === scenario.qa)
    : OFFICIAL_CIRCUITS.find(entry => entry.track.name === scenario.official)?.track
  if (!track) throw new Error(`Missing ${scenario.name} track`)
  return prepareLanePath(track)
})
const cars = ['red', 'blue', 'yellow', 'green'] as const

describe('four-car race safety', () => {
  it.each(cars)('%s completes representative races without invalid state', car => {
    for (const [index, scenario] of scenarios.entries()) {
      const path = pathCache[index]
      if (!path) throw new Error('Missing track')
      for (const mode of ['solo', 'traffic'] as const) {
        const result = runLaneCheck({
          path, trackName: scenario.name, seed: 1, difficulty: 'hard',
          reversed: scenario.reversed, handling: 'arcade', mode, car,
          seconds: scenario.seconds, laps: scenario.laps, startRatio: scenario.startRatio,
          ...(scenario.gridPositions ? { gridPositions: scenario.gridPositions } : {}),
        })
        const context = scenario.name + '/' + mode
        expect(result.vehicles[0]?.finishedAt, context).not.toBeNull()
        expect(Number.isFinite(result.vehicles[0]?.finishedAt), context).toBe(true)
        expect(result.issues.filter(issue => issue.code === 'invalid-state'), context).toEqual([])
      }
    }
  }, 120000)
})
