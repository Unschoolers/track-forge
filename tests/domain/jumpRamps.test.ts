import { describe, expect, it } from 'vitest'
import { WORLD_ELEVATION } from '@/domain/config'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { findJumpTakeoff } from '@/domain/race/jumpTakeoff'
import { asTrackId, type TrackPoint, type Track } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { jumpValidationMessage } from '@/domain/track/jumpValidation'
import { decodeTrack } from '@/domain/track/trackCodec'
import { createEditorState, applyEditorCommand } from '@/domain/editor/editorState'

function jumpPoints(): TrackPoint[] {
  return [
    { id: 'approach', x: 0, y: 0, surface: 'street' },
    { id: 'ramp', x: 120, y: 0, surface: 'street', structure: 'jump' },
    { id: 'landing', x: 240, y: 0, surface: 'street' },
    { id: 'finish', x: 1200, y: 0, surface: 'street' },
  ]
}

function jumpPath() {
  return buildRoadPath(jumpPoints(), EMPTY_TERRAIN, undefined, 'point-to-point')
}

function jumpTrack(): Track {
  return { id: asTrackId('jump-test'), name: 'Jump test', version: 8, routeKind: 'point-to-point',
    points: jumpPoints(), trees: [], terrain: EMPTY_TERRAIN, lighting: 'day',
    recoveryCheckpoints: [0.7], createdAt: 1, updatedAt: 1, }
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

it('preserves the jump brush through an editor command and local save decoding', () => {
  const track = jumpTrack()
  const original = createEditorState(track.points.map(point => ({ ...point, structure: 'surface' })))
  const { state: edited } = applyEditorCommand(original, { type: 'paint-section-structure', index: 1, structure: 'jump' })
  expect(edited.points[1]?.structure).toBe('jump')
  expect(decodeTrack({ ...track, points: edited.points }, 1)?.points[1]?.structure).toBe('jump')
})

it('rejects jumps without an ordinary landing or approach', () => {
  const track = jumpTrack()
  expect(jumpValidationMessage(track, jumpPath())).toBeUndefined()
  expect(jumpValidationMessage({ ...track, points: track.points.map((point, index) => index >= 1 ? { ...point, structure: 'jump' } : point) })).toMatch(/jump/i)
  expect(jumpValidationMessage({ ...track, routeKind: 'circuit', start: { ratio: 0, reversed: true } })).toMatch(/forward/i)
})

it('launches and lands through the real race tick without bridge-fall recovery', () => {
  const path = jumpPath()
  const lip = path.roadSurface.jumpLips[0]
  if (!lip) throw new Error('Missing jump lip')
  const base = createRace({ path, routeKind: 'point-to-point', playerCar: 'red', difficulty: 'hard', laps: 1 })
  const original = base.vehicles[0]
  if (!original) throw new Error('Missing player')
  const x = lip.center.x - 3
  const support = path.roadSurface.at(lip.beforeIndex, { x, y: 0 })
  let race: RaceState = { ...base, phase: 'running', vehicles: [{
    ...original, x, y: 0, z: support.height, pathIndex: lip.beforeIndex, angle: 0,
    speed: 180, vx: 180, vy: 0, grounded: true, structureRunId: support.structureRunId,
  }] }
  let launched = false
  let landed = false
  let takeoffEvents = 0
  for (let frame = 0; frame < 180; frame++) {
    const step = stepRace(race, { steering: 0, throttle: 0.5, braking: false }, 1 / 60, { next: () => 0.5 })
    const car = step.state.vehicles[0]
    if (!car) throw new Error('Missing player after tick')
    expect(car.bridgeFallSeconds).toBeUndefined()
    expect(step.events.some(event => event.type === 'vehicle-recovered')).toBe(false)
    for (const event of step.events) {
      if (event.type === 'vehicle-jumped') {
        takeoffEvents++
        expect(car.jumpFlight).toBe(true)
        expect(step.state.effects.particles.some(p => p.kind === 'jump-launch' && p.raised)).toBe(true)
      }
    }
    if (!car.grounded) {
      launched = true
      expect(car.jumpFlight).toBe(true)
    }
    if (launched && car.grounded) {
      landed = true
      expect(car.jumpFlight).toBe(false)
      expect(step.events).toContainEqual(expect.objectContaining({ type: 'vehicle-landed', jump: true }))
      expect(step.state.effects.particles.filter(p => p.kind === 'landing-dust').length).toBeGreaterThanOrEqual(12)
      break
    }
    race = { ...step.state, phase: 'running', vehicles: [car] }
  }
  expect(takeoffEvents).toBe(1)
  expect(launched).toBe(true)
  expect(landed).toBe(true)
})
