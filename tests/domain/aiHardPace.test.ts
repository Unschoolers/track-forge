// @vitest-environment node
import { expect, it } from 'vitest'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'
import { requireFixture } from '../fixtures/requireFixture'

it('sets a stronger Hard benchmark on Meadow Loop in Arcade', () => {
  const { track } = requireFixture(OFFICIAL_CIRCUITS.find(({ track }) => track.name === 'Meadow Loop'))
  const run = runLaneCheck({
    path: prepareLanePath(track), trackName: track.name, seed: 11,
    difficulty: 'hard', car: 'blue', mode: 'solo', handling: 'arcade',
    reversed: false, seconds: 45, laps: 1,
  })

  expect(run.stoppedReason).toBe('finished')
  expect(run.vehicles[0]?.finishedAt).toBeLessThan(10.25)
})
