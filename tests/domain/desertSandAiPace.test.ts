// @vitest-environment node
// Real reverse Desert sand regression from the creator's two-lap replay.
// These are physics-driven AI races; the human replay is reference only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

function loadTrack() {
  const [track] = decodeTrackInput(JSON.parse(readFileSync(
    'tests/fixtures/desertSandAi.trackforge.json', 'utf8',
  )))
  if (!track) throw new Error('Missing Desert sand regression fixture')
  return track
}
const track = loadTrack()
const path = prepareLanePath(track)
const gridPositions = [1, 3, 0, 2] as const
function drive(car: 'green' | 'red', difficulty: 'hard' | 'normal', seed: number, mode: 'solo' | 'traffic') {
  return runLaneCheck({
    path, trackName: track.name, seed, car, difficulty, mode,
    reversed: true, startRatio: track.start?.ratio ?? 0, gridPositions, laps: 2, seconds: 70,
  })
}

describe('Desert sand Hard AI: faster Green with real physical safety', () => {
  it.each([1, 4331])('beats its matched Normal solo time without recovery (seed %i)', seed => {
    const hard = drive('green', 'hard', seed, 'solo').vehicles[0]
    const normal = drive('green', 'normal', seed, 'solo').vehicles[0]
    if (!hard || !normal) throw new Error('Missing Green result')
    expect(hard.recoveries).toBe(0)
    expect(hard.finishedAt).not.toBeNull()
    expect(normal.finishedAt).not.toBeNull()
    expect(hard.finishedAt ?? Infinity).toBeLessThan(30.5)
    expect(hard.finishedAt ?? Infinity).toBeLessThan(normal.finishedAt ?? Infinity)
  })
  it.each([1, 4331])('keeps Green clean and competitive behind the Red player slot (seed %i)', seed => {
    const run = drive('red', 'hard', seed, 'traffic')
    const green = run.vehicles.find(v => v.car === 'green')
    if (!green) throw new Error('Missing Green rival')
    expect(green.recoveries, JSON.stringify(run.issues)).toBe(0)
    expect(green.finishedAt, JSON.stringify(run.issues)).not.toBeNull()
    expect(green.finishedAt ?? Infinity).toBeLessThan(31.5)
    expect(run.issues.filter(issue => issue.severity === 'error')).toEqual([])
  })
})
