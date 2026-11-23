// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CarId } from '@/domain/model'
import { CAR_DRIVING_PROFILES } from '@/domain/race/ai/aiCarDrivingProfiles'
import { CAR_PASSING_POLICIES } from '@/domain/race/ai/aiCarPassingPolicies'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

type Scenario = {
  name: string
  file?: string
  official?: string
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
  { name: 'Pine Hairpins', official: 'Pine Hairpins',
    startRatio: 0, reversed: false, laps: 1, seconds: 80 },
  { name: 'Meadow Loop', official: 'Meadow Loop',
    startRatio: 0, reversed: false, laps: 2, seconds: 70 },
]
const pathCache = scenarios.map(scenario => {
  const track = scenario.file
    ? decodeTrackInput(JSON.parse(readFileSync(scenario.file, 'utf8')))[0]
    : OFFICIAL_CIRCUITS.find(entry => entry.track.name === scenario.official)?.track
  if (!track) throw new Error(`Missing ${scenario.name} track`)
  return prepareLanePath(track)
})
const cars = ['red', 'blue', 'yellow', 'green'] as const

function measure(car: CarId, scenarioIndex: number, mode: 'solo' | 'duel' | 'traffic', old: boolean) {
  const scenario = scenarios[scenarioIndex]
  const path = pathCache[scenarioIndex]
  if (!scenario || !path) throw new Error('Missing track')
  const oldPassing = {
    ...CAR_PASSING_POLICIES[car],
    triggerDistanceScale: 1,
    abandonAfterSeconds: 8,
    rejoinClearSeconds: 0.25,
  }
  const oldDriving = {
    ...CAR_DRIVING_PROFILES[car],
    ...(car === 'blue' ? { hardCornerTargetBonus: 0.04 } : {}),
    ...(car === 'green' ? { hardCornerTargetBonus: 0.35 } : {}),
    ...(car === 'yellow' ? { hardTightBendTargetBonus: 0.45 } : {}),
  }
  return runLaneCheck({
    path, trackName: scenario.name,
    seed: 1, difficulty: 'hard', reversed: scenario.reversed,
    handling: 'arcade', mode, car, seconds: scenario.seconds, laps: scenario.laps,
    startRatio: scenario.startRatio,
    ...(scenario.gridPositions ? { gridPositions: scenario.gridPositions } : {}),
    ...(mode === 'duel' ? {
      duelOpponentCar: (car === 'yellow' ? 'green' : car === 'red' ? 'green' : 'red'),
      duelOpponentSpeedLimit: 220,
    } : {}),
    ...(old ? {
      aiPassingPolicyOverrides: { [car]: oldPassing },
      aiProfileOverrides: { [car]: oldDriving },
    } : {}),
  })
}

describe('four physical cars — real Hard AI improvements without new safety defects', () => {
  it.each(cars)('%s is evaluated on matched solo, duel and traffic races', car => {
    const comparison: string[] = []
    let totalBenefit = 0
    let gains = 0
    let fixes = 0
    for (const [index, scenario] of scenarios.entries()) {
      for (const mode of ['solo', 'duel', 'traffic'] as const) {
        const before = measure(car, index, mode, true)
        const after = measure(car, index, mode, false)
        const old = before.vehicles[0]
        const now = after.vehicles[0]
        if (!old || !now) throw new Error('Missing benchmark car')
        const oldSeconds = old.finishedAt ?? Infinity
        const newSeconds = now.finishedAt ?? Infinity
        const difference = oldSeconds - newSeconds
        totalBenefit += Number.isFinite(difference) ? difference : 0
        if (difference > 0.025) gains++
        if (now.recoveries < old.recoveries) fixes++
        comparison.push(`${scenario.name}/${mode}: ${oldSeconds.toFixed(2)}→${newSeconds.toFixed(2)}s, recoveries ${old.recoveries}→${now.recoveries}`)
        expect(newSeconds, comparison.join('; ')).toBeLessThan(Infinity)
        expect(now.recoveries, comparison.join('; ')).toBeLessThanOrEqual(old.recoveries)
        expect(newSeconds, comparison.join('; ')).toBeLessThanOrEqual(oldSeconds * 1.04 + 0.01)
        const oldRivals = new Map(before.vehicles.map(vehicle => [vehicle.vehicleId, vehicle]))
        for (const rival of after.vehicles) {
          const prior = oldRivals.get(rival.vehicleId)
          if (!prior) throw new Error('Changed comparison roster')
          expect(rival.recoveries, comparison.join('; ')).toBeLessThanOrEqual(prior.recoveries)
        }
        expect(after.issues.filter(issue => issue.code === 'invalid-state'), comparison.join('; ')).toEqual([])
      }
    }
    console.log(`AI_FOUR_CAR_RESULT ${JSON.stringify({ car, totalBenefitSeconds: +totalBenefit.toFixed(3), gains, fixes, comparisons: comparison })}`)
    // A release-worthy tuning must produce an actual measurable advantage,
    // not merely preserve an unchanged policy for the fourth colour.
    expect(gains + fixes, comparison.join('; ')).toBeGreaterThan(0)
  }, 120000)
})
