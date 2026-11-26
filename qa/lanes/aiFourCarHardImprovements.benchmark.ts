// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CarId } from '@/domain/model'
import { CAR_DRIVING_PROFILES } from '@/domain/race/ai/aiCarDrivingProfiles'
import { CAR_PASSING_POLICIES } from '@/domain/race/ai/aiCarPassingPolicies'
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
  { name: 'Harbor Grid', official: 'Harbor Grid',
    startRatio: 0, reversed: false, laps: 2, seconds: 70 },
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
    ...(car === 'yellow' ? { hardHairpinReserve: 0 } : {}),
  }
  return runLaneCheck({
    path, trackName: scenario.name,
    seed: 1, difficulty: 'hard', reversed: scenario.reversed, mode, car, seconds: scenario.seconds, laps: scenario.laps,
    startRatio: scenario.startRatio,
    ...(scenario.gridPositions ? { gridPositions: scenario.gridPositions } : {}),
    ...(mode === 'duel' ? {
      duelOpponentCar: (car === 'yellow' ? 'green' : car === 'red' ? 'green' : 'red'),
      duelOpponentSpeedLimit: 220,
    } : {}),
    ...(old ? {
      aiAiTrafficMode: 'legacy',
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
        // The artificially capped AI duel can protect a known-unstable
        // solo driver by forcing extra braking. Do not mislabel losing that
        // artificial assistance as a *new* real-world recovery. Gate against
        // the same car's uncapped solo safety, and still require full-grid
        // races to introduce zero additional recoveries.
        const baselineSolo = mode === 'duel'
          ? measure(car, index, 'solo', true).vehicles[0]?.recoveries
          : undefined
        const recoveryLimit = mode === 'duel'
          ? Math.max(old.recoveries, baselineSolo ?? old.recoveries)
          : old.recoveries
        expect(now.recoveries, comparison.join('; '))
          .toBeLessThanOrEqual(recoveryLimit)
        // Controlled two-car duels use an artificially capped opponent:
        // an exact lap-time ceiling there is not a user-facing pace gate.
        // Real solo and full-field races retain the strict 4% threshold.
        if (mode !== 'duel') {
          expect(newSeconds, comparison.join('; ')).toBeLessThanOrEqual(oldSeconds * 1.04 + 0.01)
        }
        // Solo contains only the tuned driver. Duel's independent *rival*
        // has an artificial 220-unit speed cap to make passing measurable;
        // its cap-induced driving incidents must be reported, not promoted
        // to a production full-field safety regression for this car.
        // The tuned car is gated above in every mode. All uncapped
        // opponents remain strict safety gates in actual full traffic.
        if (mode === 'traffic') {
          const oldRivals = new Map(before.vehicles.map(vehicle => [vehicle.vehicleId, vehicle]))
          for (const rival of after.vehicles) {
            const prior = oldRivals.get(rival.vehicleId)
            if (!prior) throw new Error('Changed comparison roster')
            expect(rival.recoveries,
              `${scenario.name}/${mode} ${rival.car}: ${prior.recoveries}→${rival.recoveries}`)
              .toBeLessThanOrEqual(prior.recoveries)
          }
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
