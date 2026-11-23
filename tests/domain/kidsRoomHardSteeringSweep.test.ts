// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'

// Diagnostic sweep: same Blue physics, two very different corners/track shapes.
// We must find one Hard policy that is quicker on Kids Room *and* Pine Hairpins.
const probe = vi.hoisted(() => ({
  reaction: null as number | null,
  gain: null as number | null,
}))
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
          hardReaction: probe.reaction ?? profile.hardReaction,
          hardSteerGain: probe.gain ?? profile.hardSteerGain,
        }
      },
    }),
  }
})

import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

it('compares Hard Blue steering on Kids Room and Pine Hairpins', () => {
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
  const variants = [
    [8, 2.22], [8, 2.42], [8, 2.7], [8, 2.95], [8, 3.2],
    [9, 2.7], [9, 2.95], [10, 2.42], [10, 2.7], [10, 2.95],
    [12, 2.42], [12, 2.7], [12, 2.95], [12, 3.2], [14, 2.95],
  ] as const
  const matrix: Record<string, unknown> = {}
  try {
    for (const [reaction, gain] of variants) {
      probe.reaction = reaction
      probe.gain = gain
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
      matrix[`${reaction}/${gain}`] = record
    }
  } finally {
    probe.reaction = null
    probe.gain = null
  }
  console.log(`AI_BLUE_TWO_TRACK_STEERING_SWEEP ${JSON.stringify(matrix)}`)
  expect(Object.keys(matrix)).toHaveLength(variants.length)
}, 180_000)
