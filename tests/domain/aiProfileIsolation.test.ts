// @vitest-environment node
import { expect, it } from 'vitest'
import { CAR_DRIVING_PROFILES } from '@/domain/race/ai/aiCarDrivingProfiles'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

// Component-level regression: strategy selection is a per-race dependency.
// One test must never alter the next race or the module's default profiles.
it('isolates AI profile candidates without changing any shared defaults', () => {
  const fixture = OFFICIAL_CIRCUITS.find(circuit => circuit.track.name === 'Pine Hairpins')
  if (!fixture) throw new Error('Missing Pine Hairpins')
  const path = prepareLanePath(fixture.track)
  const defaults = structuredClone(CAR_DRIVING_PROFILES)
  const options = {
    path, trackName: fixture.track.name, seed: 11,
    difficulty: 'hard' as const, car: 'blue' as const,
    mode: 'solo' as const, handling: 'arcade' as const,
    reversed: false, laps: 1, seconds: 60,
  }

  const baseline = runLaneCheck(options)
  const alternate = runLaneCheck({
    ...options,
    aiProfileOverrides: { blue: { ...CAR_DRIVING_PROFILES.blue, hardSteerGain: 0 } },
  })
  const baselineAgain = runLaneCheck(options)

  expect(baseline.stoppedReason).toBe('finished')
  expect(baselineAgain.vehicles).toEqual(baseline.vehicles)
  expect(baselineAgain.issues).toEqual(baseline.issues)
  expect(CAR_DRIVING_PROFILES).toEqual(defaults)
  // An override has a real effect, but is restricted to its own race.
  expect(alternate.vehicles[0]?.finishedAt).not.toBe(baseline.vehicles[0]?.finishedAt)
}, 60_000)
