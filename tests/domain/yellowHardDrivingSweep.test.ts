// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

// Calibrate Yellow Hard independently on both mixed-surface and hairpin tracks.
// All mechanical car/surface physics, checkpoint rules, and recoveries unchanged.
const probe = vi.hoisted(() => ({
  lookahead: null as number | null,
  steerGain: null as number | null,
}))
vi.mock('@/domain/race/ai/aiCarDrivingProfiles', async importOriginal => {
  const original = await importOriginal<typeof import('@/domain/race/ai/aiCarDrivingProfiles')>()
  return {
    ...original,
    CAR_DRIVING_PROFILES: new Proxy(original.CAR_DRIVING_PROFILES, {
      get(target, car) {
        const profile = Reflect.get(target, car)
        if (car !== 'yellow' || !profile) return profile
        return {
          ...profile,
          hardLookAheadSamples: probe.lookahead ?? profile.hardLookAheadSamples,
          hardSteerGain: probe.steerGain ?? profile.hardSteerGain,
        }
      },
    }),
  }
})
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

it('sweeps Yellow Hard pursuit preview and steering across two circuits', () => {
  const [kidsRoom] = decodeTrackInput(JSON.parse(
    readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8'),
  ))
  if (!kidsRoom) throw new Error('Kids Room fixture missing')
  const pine = OFFICIAL_CIRCUITS.find(({ track }) => track.name === 'Pine Hairpins')?.track
  if (!pine) throw new Error('Pine Hairpins fixture missing')
  const paths = [
    { track: kidsRoom, seed: 1, laps: 2, seconds: 150, startRatio: 0.21932299012693934 },
    { track: pine, seed: 11, laps: 1, seconds: 45, startRatio: 0 },
  ] as const
  const previewValues = [4, 7, 10, 14, 18] as const
  const gains = [2.22, 2.42, 2.7] as const
  const matrix: Record<string, unknown> = {}
  try {
    for (const lookahead of previewValues) {
      for (const gain of gains) {
        probe.lookahead = lookahead
        probe.steerGain = gain
        const record: Record<string, unknown> = {}
        for (const entry of paths) {
          const run = runLaneCheck({
            path: prepareLanePath(entry.track), trackName: entry.track.name,
            seed: entry.seed, difficulty: 'hard', car: 'yellow',
            handling: 'arcade', mode: 'solo', reversed: false,
            startRatio: entry.startRatio, seconds: entry.seconds, laps: entry.laps,
          })
          record[entry.track.name] = {
            time: run.vehicles[0]?.finishedAt ?? null,
            recoveries: run.vehicles[0]?.recoveries ?? null,
            offRoadSeconds: run.vehicles[0]?.offRoadSeconds ?? null,
          }
        }
        matrix[`${lookahead}/${gain}`] = record
      }
    }
  } finally {
    probe.lookahead = null
    probe.steerGain = null
  }
  console.log(`AI_YELLOW_TWO_TRACK_SWEEP ${JSON.stringify(matrix)}`)
  expect(Object.keys(matrix)).toHaveLength(previewValues.length * gains.length)
}, 180_000)
