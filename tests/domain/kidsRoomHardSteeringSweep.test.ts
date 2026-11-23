// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

// Diagnostic only: preview length changes the road point Blue *aims* at,
// never vehicle grip, engine, brakes, checkpoint rules or race timing.
const probe = vi.hoisted(() => ({ hardLookAheadSamples: null as number | null }))
vi.mock('@/domain/race/ai/aiCarDrivingProfiles', async importOriginal => {
  const original = await importOriginal<typeof import('@/domain/race/ai/aiCarDrivingProfiles')>()
  return {
    ...original,
    CAR_DRIVING_PROFILES: new Proxy(original.CAR_DRIVING_PROFILES, {
      get(target, key) {
        const profile = Reflect.get(target, key)
        if (key !== 'blue' || !profile) return profile
        return {
          ...profile,
          hardLookAheadSamples: probe.hardLookAheadSamples ?? profile.hardLookAheadSamples,
        }
      },
    }),
  }
})
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

it('compares Hard Blue preview on Kids Room and Pine Hairpins', () => {
  const [kidsRoom] = decodeTrackInput(JSON.parse(
    readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8'),
  ))
  if (!kidsRoom) throw new Error('Kids Room fixture missing')
  const pine = OFFICIAL_CIRCUITS.find(({ track }) => track.name === 'Pine Hairpins')?.track
  if (!pine) throw new Error('Pine Hairpins fixture missing')
  const paths = [
    { track: kidsRoom, seed: 1, laps: 2, seconds: 150,
      startRatio: 0.21932299012693934 },
    { track: pine, seed: 11, laps: 1, seconds: 45, startRatio: 0 },
  ] as const
  const previews = [-4, -2, 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15] as const
  const matrix: Record<string, unknown> = {}
  try {
    for (const lookAhead of previews) {
      probe.hardLookAheadSamples = lookAhead
      const record: Record<string, unknown> = {}
      for (const entry of paths) {
        const run = runLaneCheck({
          path: prepareLanePath(entry.track), trackName: entry.track.name,
          seed: entry.seed, difficulty: 'hard', car: 'blue',
          handling: 'arcade', mode: 'solo', reversed: false,
          startRatio: entry.startRatio, seconds: entry.seconds, laps: entry.laps,
        })
        record[entry.track.name] = {
          time: run.vehicles[0]?.finishedAt ?? null,
          recoveries: run.vehicles[0]?.recoveries ?? null,
          offRoadSeconds: run.vehicles[0]?.offRoadSeconds ?? null,
        }
      }
      matrix[String(lookAhead)] = record
    }
  } finally {
    probe.hardLookAheadSamples = null
  }
  console.log(`AI_BLUE_TWO_TRACK_PREVIEW_SWEEP ${JSON.stringify(matrix)}`)
  expect(Object.keys(matrix)).toHaveLength(previews.length)
}, 180_000)
