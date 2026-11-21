import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import type { Preferences } from '@/application/ports/storage'
import { raceSetupFromPreferences, withFreshStartGrid } from '@/application/race/raceSetup'

const track = createStarterTrack(asTrackId('race-setup'), 1)
const prefs: Preferences = {
  car: 'green', difficulty: 'hard', handling: 'simulation', raceLaps: 3,
  raceMode: 'normal', audioEnabled: true, hapticsEnabled: true, dynamicZoomEnabled: true,
}

describe('race setup policies', () => {
  it('keeps user car, handling, laps and lighting while randomizing a normal circuit grid', () => {
    const setup = raceSetupFromPreferences(track, prefs, 'night', () => 0)
    expect(setup).toEqual({
      car: 'green', difficulty: 'hard', laps: 3, handling: 'simulation',
      mode: 'normal', lighting: 'night', gridPositions: [1, 2, 3, 0],
    })
    expect(prefs.raceLaps).toBe(3)
  })

  it('converts unsupported circuit Time Trial into a normal race with a shuffled grid', () => {
    expect(raceSetupFromPreferences(track, { ...prefs, raceMode: 'time-trial' }, 'day', () => 0).mode).toBe('normal')
    expect(raceSetupFromPreferences(track, { ...prefs, raceMode: 'time-trial' }, 'day', () => 0).gridPositions)
      .toEqual([1, 2, 3, 0])
  })

  it('forces point-to-point to one lap and preserves Time Trial without consuming randomness', () => {
    const pointToPoint = { ...track, routeKind: 'point-to-point' as const }
    const setup = raceSetupFromPreferences(pointToPoint,
      { ...prefs, raceMode: 'time-trial' }, 'day',
      () => { throw new Error('Time trial should not request a grid') })
    expect(setup).toMatchObject({ laps: 1, mode: 'time-trial', lighting: 'day' })
    expect(setup.gridPositions).toBeUndefined()
  })

  it('retains ghost and nearby setups, but renews a normal replay grid without modifying saved setup', () => {
    const saved = { car: 'red' as const, difficulty: 'normal' as const, laps: 2,
      mode: 'normal' as const, gridPositions: [0, 1, 2, 3] }
    expect(withFreshStartGrid(saved, () => 0).gridPositions).toEqual([1, 2, 3, 0])
    expect(saved.gridPositions).toEqual([0, 1, 2, 3])
    const neverRandom = () => { throw new Error('Non-normal races should retain their setup') }
    expect(withFreshStartGrid({ ...saved, mode: 'ghost' }, neverRandom)).toEqual({ ...saved, mode: 'ghost' })
    expect(withFreshStartGrid({ ...saved, mode: 'nearby' }, neverRandom)).toEqual({ ...saved, mode: 'nearby' })
  })

  it('treats legacy replay setups without a mode as normal races', () => {
    const saved = { car: 'blue' as const, difficulty: 'easy' as const, laps: 2 }
    expect(withFreshStartGrid(saved, () => 0).gridPositions).toEqual([1, 2, 3, 0])
  })
})
