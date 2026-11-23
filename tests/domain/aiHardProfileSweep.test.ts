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
const cases: Readonly<Record<'blue' | 'green', readonly ProfileEdit[]>> = {
  blue: [
    { label: 'current', changes: {} },
    { label: 'preview-6', changes: { hardLookAheadSamples: 6 } },
    { label: 'preview-8', changes: { hardLookAheadSamples: 8 } },
    { label: 'preview-12', changes: { hardLookAheadSamples: 12 } },
    { label: 'gain-2.32', changes: { hardSteerGain: 2.32 } },
    { label: 'gain-2.42', changes: { hardSteerGain: 2.42 } },
    { label: 'gain-2.55', changes: { hardSteerGain: 2.55 } },
    { label: 'reaction-10', changes: { hardReaction: 10 } },
    { label: 'reserve-0.025', changes: { hardCornerReserve: 0.025 } },
    { label: 'reserve-0.05', changes: { hardCornerReserve: 0.05 } },
    { label: 'reserve-0.08', changes: { hardCornerReserve: 0.08 } },
    { label: 'gain-2.42-preview-8', changes: { hardSteerGain: 2.42, hardLookAheadSamples: 8 } },
  ],
  green: [
    { label: 'current', changes: {} },
    { label: 'reserve-0', changes: { hardCornerReserve: 0 } },
    { label: 'reserve-0.01', changes: { hardCornerReserve: 0.01 } },
    { label: 'reserve-0.03', changes: { hardCornerReserve: 0.03 } },
    { label: 'reserve-0.04', changes: { hardCornerReserve: 0.04 } },
    { label: 'gain-2.5', changes: { hardSteerGain: 2.5 } },
    { label: 'gain-2.6', changes: { hardSteerGain: 2.6 } },
    { label: 'preview-6', changes: { hardLookAheadSamples: 6 } },
    { label: 'preview-8', changes: { hardLookAheadSamples: 8 } },
  ],
}

sweep('measures bounded car-specific Hard controller candidates on Kids Room and Pine', () => {
  const outcomes: Record<string, unknown[]> = {}
  for (const car of ['blue', 'green'] as const) {
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
}, 300_000)
