// @vitest-environment node
// Temporary diagnostic for issue #270: compare only *driver decisions*.
// No physics, track-specific settings, or runtime production sweep.
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { CarId } from '@/domain/model'
import { CAR_DRIVING_PROFILES, type CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

const sweep = process.env.AI_PROFILE_SWEEP === '1' ? it : it.skip
const profiles = CAR_DRIVING_PROFILES as Record<CarId, CarDrivingProfile>
const [kids] = decodeTrackInput(JSON.parse(readFileSync(
  'tests/fixtures/kidsRoomAi.trackforge.json', 'utf8',
)) as unknown)
if (!kids) throw new Error('Missing Kids Room fixture')
const kidsPath = prepareLanePath(kids)
const pine = OFFICIAL_CIRCUITS.find(circuit => circuit.track.name === 'Pine Hairpins')
if (!pine) throw new Error('Missing Pine Hairpins')
const pinePath = prepareLanePath(pine.track)

type ProfileEdit = { readonly label: string, readonly changes: Partial<CarDrivingProfile> }
const cases: Readonly<Record<CarId, readonly ProfileEdit[]>> = {
  blue: [
    { label: 'current', changes: {} },
    { label: 'normal-steering-preview4', changes: { hardReaction: 10, hardSteerGain: 2.42, hardLookAheadSamples: 4 } },
    { label: 'normal-steering-preview6', changes: { hardReaction: 10, hardSteerGain: 2.42, hardLookAheadSamples: 6 } },
    { label: 'normal-steering-preview8', changes: { hardReaction: 10, hardSteerGain: 2.42, hardLookAheadSamples: 8 } },
    { label: 'normal-steering-preview10', changes: { hardReaction: 10, hardSteerGain: 2.42, hardLookAheadSamples: 10 } },
    { label: 'gain255-preview4', changes: { hardSteerGain: 2.55, hardLookAheadSamples: 4 } },
    { label: 'gain255-preview6', changes: { hardSteerGain: 2.55, hardLookAheadSamples: 6 } },
    { label: 'gain255-preview8', changes: { hardSteerGain: 2.55, hardLookAheadSamples: 8 } },
    { label: 'gain255-preview10', changes: { hardSteerGain: 2.55, hardLookAheadSamples: 10 } },
    { label: 'gain255-preview12', changes: { hardSteerGain: 2.55, hardLookAheadSamples: 12 } },
    { label: 'reaction12-gain242-preview4', changes: { hardReaction: 12, hardSteerGain: 2.42, hardLookAheadSamples: 4 } },
    { label: 'reaction12-gain242-preview8', changes: { hardReaction: 12, hardSteerGain: 2.42, hardLookAheadSamples: 8 } },
    { label: 'reaction12-gain255-preview8', changes: { hardReaction: 12, hardSteerGain: 2.55, hardLookAheadSamples: 8 } },
    { label: 'reaction10-gain27-preview8', changes: { hardReaction: 10, hardSteerGain: 2.7, hardLookAheadSamples: 8 } },
    { label: 'reaction15-gain3-preview4', changes: { hardReaction: 15, hardSteerGain: 3, hardLookAheadSamples: 4 } },
    { label: 'gain242-reserve001-preview10', changes: { hardSteerGain: 2.42, hardCornerReserve: 0.01 } },

    { label: 'preview14', changes: { hardLookAheadSamples: 14 } },
    { label: 'preview18', changes: { hardLookAheadSamples: 18 } },
    { label: 'gain235-preview12', changes: { hardSteerGain: 2.35, hardLookAheadSamples: 12 } },
    { label: 'gain235-preview14', changes: { hardSteerGain: 2.35, hardLookAheadSamples: 14 } },
    { label: 'gain24-preview14', changes: { hardSteerGain: 2.4, hardLookAheadSamples: 14 } },
    { label: 'gain25-preview14', changes: { hardSteerGain: 2.5, hardLookAheadSamples: 14 } },
    { label: 'reaction6-gain242-preview10', changes: { hardReaction: 6, hardSteerGain: 2.42 } },
    { label: 'reaction6-gain255-preview10', changes: { hardReaction: 6, hardSteerGain: 2.55 } },
    { label: 'reaction6-gain242-preview6', changes: { hardReaction: 6, hardSteerGain: 2.42, hardLookAheadSamples: 6 } },
    { label: 'reaction6-gain255-preview8', changes: { hardReaction: 6, hardSteerGain: 2.55, hardLookAheadSamples: 8 } },
    { label: 'reaction7-gain242-preview12', changes: { hardReaction: 7, hardSteerGain: 2.42, hardLookAheadSamples: 12 } },
    { label: 'reaction8-gain20-preview14', changes: { hardSteerGain: 2.0, hardLookAheadSamples: 14 } },
  ],
  green: [
    { label: 'current', changes: {} },
    { label: 'preview8-reserve0', changes: { hardCornerReserve: 0 } },
    { label: 'preview8-reserve001', changes: { hardCornerReserve: 0.01 } },
    { label: 'preview8-reserve0035', changes: { hardCornerReserve: 0.035 } },
    { label: 'preview8-reserve005', changes: { hardCornerReserve: 0.05 } },
    { label: 'preview6-reserve001', changes: { hardLookAheadSamples: 6, hardCornerReserve: 0.01 } },
    { label: 'preview10', changes: { hardLookAheadSamples: 10 } },
    { label: 'preview12', changes: { hardLookAheadSamples: 12 } },
    { label: 'preview8-gain23', changes: { hardSteerGain: 2.3 } },
    { label: 'preview8-gain25', changes: { hardSteerGain: 2.5 } },
    { label: 'preview8-gain26', changes: { hardSteerGain: 2.6 } },
    { label: 'preview8-gain27', changes: { hardSteerGain: 2.7 } },
    { label: 'preview8-reaction8', changes: { hardReaction: 8 } },
    { label: 'preview8-reaction12', changes: { hardReaction: 12 } },
    { label: 'preview8-gain26-reserve001', changes: { hardSteerGain: 2.6, hardCornerReserve: 0.01 } },
  ],
  red: [
    { label: 'current', changes: {} },
    { label: 'preview6', changes: { hardLookAheadSamples: 6 } },
    { label: 'preview8', changes: { hardLookAheadSamples: 8 } },
    { label: 'preview10', changes: { hardLookAheadSamples: 10 } },
    { label: 'preview12', changes: { hardLookAheadSamples: 12 } },
    { label: 'gain242', changes: { hardSteerGain: 2.42 } },
    { label: 'gain26', changes: { hardSteerGain: 2.6 } },
    { label: 'gain28', changes: { hardSteerGain: 2.8 } },
    { label: 'reaction10', changes: { hardReaction: 10 } },
    { label: 'reaction12', changes: { hardReaction: 12 } },
    { label: 'reaction10-gain242-preview8', changes: { hardReaction: 10, hardSteerGain: 2.42, hardLookAheadSamples: 8 } },
    { label: 'reaction10-gain26-preview8', changes: { hardReaction: 10, hardSteerGain: 2.6, hardLookAheadSamples: 8 } },
    { label: 'reserve002', changes: { hardCornerReserve: 0.02 } },
    { label: 'reserve005', changes: { hardCornerReserve: 0.05 } },

    { label: 'reaction12-reserve002', changes: { hardReaction: 12, hardCornerReserve: 0.02 } },
    { label: 'reaction12-reserve004', changes: { hardReaction: 12, hardCornerReserve: 0.04 } },
    { label: 'reaction12-reserve006', changes: { hardReaction: 12, hardCornerReserve: 0.06 } },
    { label: 'reaction12-reserve008', changes: { hardReaction: 12, hardCornerReserve: 0.08 } },
    { label: 'reaction12-reserve010', changes: { hardReaction: 12, hardCornerReserve: 0.1 } },
    { label: 'reaction12-reserve012', changes: { hardReaction: 12, hardCornerReserve: 0.12 } },
    { label: 'reaction12-reserve015', changes: { hardReaction: 12, hardCornerReserve: 0.15 } },
    { label: 'reaction10-reserve006', changes: { hardReaction: 10, hardCornerReserve: 0.06 } },
    { label: 'reaction10-reserve010', changes: { hardReaction: 10, hardCornerReserve: 0.1 } },
    { label: 'gain242-reserve008', changes: { hardSteerGain: 2.42, hardCornerReserve: 0.08 } },
    { label: 'gain242-reserve012', changes: { hardSteerGain: 2.42, hardCornerReserve: 0.12 } },
    { label: 'preview2', changes: { hardLookAheadSamples: 2 } },
    { label: 'preview1', changes: { hardLookAheadSamples: 1 } },
    { label: 'reaction12-preview2', changes: { hardReaction: 12, hardLookAheadSamples: 2 } },
    { label: 'reaction12-preview10-reserve006', changes: { hardReaction: 12, hardLookAheadSamples: 10, hardCornerReserve: 0.06 } },
    { label: 'reaction12-preview8-reserve010', changes: { hardReaction: 12, hardLookAheadSamples: 8, hardCornerReserve: 0.1 } },
  ],
  yellow: [
    { label: 'current', changes: {} },
    { label: 'preview8', changes: { hardLookAheadSamples: 8 } },
    { label: 'preview12', changes: { hardLookAheadSamples: 12 } },
    { label: 'preview14', changes: { hardLookAheadSamples: 14 } },
    { label: 'gain28', changes: { hardSteerGain: 2.8 } },
    { label: 'gain3', changes: { hardSteerGain: 3 } },
    { label: 'gain32', changes: { hardSteerGain: 3.2 } },
    { label: 'reaction10', changes: { hardReaction: 10 } },
    { label: 'reaction12', changes: { hardReaction: 12 } },
    { label: 'reserve002', changes: { hardCornerReserve: 0.02 } },
    { label: 'gain3-preview8', changes: { hardSteerGain: 3, hardLookAheadSamples: 8 } },
    { label: 'gain3-preview12', changes: { hardSteerGain: 3, hardLookAheadSamples: 12 } },
    { label: 'gain27-reaction12-preview10', changes: { hardReaction: 12 } },
  ],
}

sweep('measures bounded car-specific Hard controller candidates on Kids Room and Pine', () => {
  const outcomes: Record<string, unknown[]> = {}
  for (const car of ['blue', 'green', 'red', 'yellow'] as const) {
    const original = profiles[car]
    const results: unknown[] = []
    try {
      for (const candidate of cases[car]) {
        profiles[car] = { ...original, ...candidate.changes }
        const kidsRun = runLaneCheck({
          path: kidsPath, trackName: kids.name, car, seed: 1,
          difficulty: 'hard', handling: 'arcade', mode: 'solo',
          reversed: false, startRatio: 0.21932299012693934,
          laps: 2, seconds: 150,
        })
        const kidsVehicle = kidsRun.vehicles[0]
        const pineRun = runLaneCheck({
          path: pinePath, trackName: pine.track.name, car, seed: 11,
          difficulty: 'hard', handling: 'arcade', mode: 'solo',
          reversed: false, laps: 1, seconds: 75,
        })
        const pineVehicle = pineRun.vehicles[0]
        results.push({
          label: candidate.label, profile: profiles[car],
          kids: { time: kidsVehicle?.finishedAt ?? null, recoveries: kidsVehicle?.recoveries ?? -1,
            offroad: kidsVehicle?.offRoadSeconds ?? -1, reason: kidsRun.stoppedReason },
          pine: { time: pineVehicle?.finishedAt ?? null, recoveries: pineVehicle?.recoveries ?? -1,
            offroad: pineVehicle?.offRoadSeconds ?? -1, reason: pineRun.stoppedReason },
        })
      }
    } finally {
      profiles[car] = original
    }
    outcomes[car] = results
  }
  console.log('AI_PROFILE_SWEEP ' + JSON.stringify(outcomes))
  expect(outcomes.blue).toHaveLength(cases.blue.length)
  expect(outcomes.green).toHaveLength(cases.green.length)
  expect(outcomes.red).toHaveLength(cases.red.length)
  expect(outcomes.yellow).toHaveLength(cases.yellow.length)
}, 300_000)
