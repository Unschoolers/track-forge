// @vitest-environment node
// Real 2026-11-23 Kids Room Hard replay: exact track, player car, grid,
// direction and two-lap length. A separate 60 Hz AI-only simulation
// reproduces two off-road Red recoveries before the traction-planner fix.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

function loadPath() {
  const [track] = decodeTrackInput(JSON.parse(
    readFileSync('tests/fixtures/kidsRoomAi.trackforge.json', 'utf8'),
  ))
  if (!track) throw new Error('Missing Kids Room fixture')
  return { path: prepareLanePath(track), name: track.name, ratio: track.start?.ratio ?? 0 }
}

const course = loadPath()
describe('Hard mixed-surface ice-to-street corner braking (recorded Kids Room grid)', () => {
  it.each([1, 4331])('lets Red and the other rivals finish without forced recovery (seed %i)', seed => {
    const run = runLaneCheck({
      path: course.path, trackName: course.name,
      car: 'green', difficulty: 'hard', handling: 'arcade',
      mode: 'traffic', seed, startRatio: course.ratio,
      gridPositions: [3, 1, 0, 2], reversed: false,
      laps: 2, seconds: 145,
    })
    const red = run.vehicles.find(vehicle => vehicle.car === 'red')
    if (!red) throw new Error('Red rival absent from reproduced grid')
    expect(red.recoveries, JSON.stringify(run.issues)).toBe(0)
    expect(red.finishedAt, JSON.stringify(run.issues)).not.toBeNull()
    expect(red.finishedAt ?? Infinity).toBeLessThan(97)
    expect(run.vehicles.every(vehicle => vehicle.finishedAt !== null),
      JSON.stringify(run.issues)).toBe(true)
    expect(run.issues.filter(issue => issue.severity === 'error')).toEqual([])
  }, 30000)
})
