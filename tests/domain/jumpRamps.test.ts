import { describe, expect, it } from 'vitest'
import { WORLD_ELEVATION } from '@/domain/config'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { findJumpTakeoff } from '@/domain/race/jumpTakeoff'
import type { TrackPoint } from '@/domain/model'

function jumpPath() {
  const points: TrackPoint[] = [
    { id: 'approach', x: 0, y: 0, surface: 'street' },
    { id: 'ramp', x: 120, y: 0, surface: 'street', structure: 'jump' },
    { id: 'landing', x: 240, y: 0, surface: 'street' },
    { id: 'finish', x: 600, y: 0, surface: 'street' },
  ]
  return buildRoadPath(points, EMPTY_TERRAIN, undefined, 'point-to-point')
}

describe('authored jump ramps', () => {
  it('rises to the fixed lip height and immediately returns to the ground beyond it', () => {
    const path = jumpPath()
    const lip = path.roadSurface.jumpLips[0]
    if (!lip) throw new Error('Expected a compiled jump lip')
    const before = path.roadSurface.at(lip.beforeIndex)
    expect(before.structureHeight).toBeGreaterThan(0)
    expect(before.grade).toBeGreaterThan(0)
    expect(lip.height).toBeCloseTo(WORLD_ELEVATION.levelHeight)
    expect(path.roadSurface.at(lip.afterIndex).structureHeight).toBe(0)
    expect(path.roadSurface.at(lip.afterIndex).grade).toBeCloseTo(0)
    expect(path.roadSurface.atSegmentEnd(lip.beforeIndex).structureHeight).toBeCloseTo(WORLD_ELEVATION.levelHeight)
  })

  it('launches only a grounded forward crossing of the finite lip on its own run', () => {
    const path = jumpPath()
    const lip = path.roadSurface.jumpLips[0]
    if (!lip) throw new Error('Expected a compiled jump lip')
    const before = { x: lip.center.x - 3, y: 0, grounded: true, pathIndex: lip.beforeIndex }
    const after = { x: lip.center.x + 3, y: 0, vx: 100, vy: 0 }
    const launch = findJumpTakeoff(path, before, after, lip.runId)
    expect(launch?.height).toBeCloseTo(WORLD_ELEVATION.levelHeight)
    expect(launch?.grade).toBeGreaterThan(0)
    expect(findJumpTakeoff(path, { ...before, grounded: false }, after, lip.runId)).toBeUndefined()
    expect(findJumpTakeoff(path, before, after, null)).toBeUndefined()
    expect(findJumpTakeoff(path, { ...before, x: after.x }, { ...after, x: before.x, vx: -100 }, lip.runId)).toBeUndefined()
    expect(findJumpTakeoff(path, { ...before, y: 100 }, { ...after, y: 100 }, lip.runId)).toBeUndefined()
  })

  it('does not create a launch lip for an ordinary bridge', () => {
    const points: TrackPoint[] = [
      { x: 0, y: 0, surface: 'street' },
      { x: 120, y: 0, surface: 'street', structure: 'overpass' },
      { x: 240, y: 0, surface: 'street' },
      { x: 600, y: 0, surface: 'street' },
    ]
    expect(buildRoadPath(points, EMPTY_TERRAIN, undefined, 'point-to-point').roadSurface.jumpLips).toEqual([])
  })
})
