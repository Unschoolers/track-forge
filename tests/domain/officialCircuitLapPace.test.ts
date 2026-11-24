// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

describe('new official circuits at 60 Hz', () => {
  it.each(OFFICIAL_CIRCUITS)('$track.name supports a clean Arcade lap', ({ track }) => {
    const result = runLaneCheck({
      path: prepareLanePath(track),
      trackName: track.name,
      car: 'blue',
      difficulty: 'normal',
      mode: 'solo',
      handling: 'arcade',
      seed: 1,
      reversed: false,
      laps: 1,
      seconds: 120,
    })
    const finish = result.vehicles[0]?.finishedAt
    expect(result.stoppedReason, track.name).toBe('finished')
    expect(finish, track.name).not.toBeNull()
    expect(result.vehicles[0]?.recoveries, track.name).toBe(0)
  }, 30_000)
})
