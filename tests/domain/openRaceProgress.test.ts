import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { resetRaceVehicle } from '@/domain/race/raceEngine'
import { updateOpenRouteProgress, updateProgress } from '@/domain/race/progress'
import { rankVehicles } from '@/domain/race/ranking'
import { requireFixture } from '../fixtures/requireFixture'

const track = createStarterTrack(asTrackId('open-race'), 1)
const path = buildRoadPath(track.points, track.terrain, undefined, 'point-to-point')
const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75], path, playerCar: 'red', difficulty: 'normal', laps: 3, startRatio: 0.5, reversed: true, routeKind: 'point-to-point' })
const player = requireFixture(race.vehicles[0])
const last = path.points.length - 1

function gateLine(gate: 1 | 2 | 3 | 4) {
  const gatePosition = gate === 4 ? last : requireFixture(race.timingGates?.[gate - 1])
  const lower = Math.min(last - 1, Math.floor(gatePosition))
  const a = requireFixture(path.points[lower])
  const b = requireFixture(path.points[lower + 1])
  const fraction = gatePosition - lower
  const x = a.x + (b.x - a.x) * fraction
  const y = a.y + (b.y - a.y) * fraction
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const tx = (b.x - a.x) / length
  const ty = (b.y - a.y) / length
  return {
    before: { x: x - tx, y: y - ty, pathIndex: lower },
    after: { x: x + tx, y: y + ty, pathIndex: lower + 1 },
  }
}

function cross(vehicle: typeof player, gate: 1 | 2 | 3 | 4, backwards = false) {
  const { before, after } = gateLine(gate)
  const from = backwards ? after : before
  const to = backwards ? before : after
  return updateOpenRouteProgress({ ...vehicle, ...from }, { ...vehicle, ...to }, path, to.pathIndex, 12, true, true, 42, race.timingGates)
}

describe('point-to-point race', () => {
  it('stages at the route start facing forward and forces one run', () => {
    expect(race).toMatchObject({ totalLaps: 1, startPathIndex: 0, reversed: false })
    expect(race.vehicles.every(v => v.pathIndex === 0)).toBe(true)
    expect(new Set(race.vehicles.map(v => `${v.x},${v.y}`)).size).toBe(4)
  })
  it('accepts gates in order and requires a nearby forward finish crossing', () => {
    expect(cross(player, 2).nextSector).toBe(1)
    let v = cross(player, 1)
    expect(v.nextSector).toBe(2)
    v = cross(v, 2)
    expect(cross(v, 4).finishedAt).toBeNull()
    v = cross(v, 3)
    expect(v.nextSector).toBe(4)
    expect(cross(v, 4, true).finishedAt).toBeNull()
    expect(cross(v, 4)).toMatchObject({ lap: 1, finishedAt: 12 })
    expect(cross(cross(v, 4), 4).lap).toBe(1)
  })
  it('ranks open-route progress without wrapping at the start', () => {
    const ahead = { ...player, id: 'ahead', pathIndex: 10 }
    const behind = { ...player, id: 'behind', pathIndex: 0 }
    expect(rankVehicles([behind, ahead], path.points.length, 0, false, 'point-to-point').map(v => v.id)).toEqual(['ahead', 'behind'])
  })
})

it('requires an on-road physical crossing and allows recovery before a missed gate', () => {
  const line = gateLine(1)
  const before = { ...player, ...line.before }
  const after = { ...player, ...line.after }
  // Off-road bypass is a shortcut only when the swept path misses the painted stripe.
  const grassBefore = { ...before, y: before.y + 80 }
  const grassAfter = { ...after, y: after.y + 80 }
  const bypass = updateOpenRouteProgress(grassBefore, grassAfter, path, after.pathIndex, 1, false, true, 42, race.timingGates)
  expect(bypass.nextSector).toBe(1)
  expect(bypass.finishedAt).toBeNull()
  const rejoin = updateOpenRouteProgress(bypass, bypass, path, after.pathIndex, 2, true, true, 42, race.timingGates)
  expect(rejoin.nextSector).toBe(1)
  const recovered = resetRaceVehicle(rejoin, race)
  expect(recovered.pathIndex).toBeLessThan(last / 4)
  expect(updateOpenRouteProgress(before, after, path, after.pathIndex, 3, true, true, 42, race.timingGates).nextSector).toBe(2)
  expect(cross({ ...player, grounded: false }, 1).nextSector).toBe(2)
})

it('lets AI finish at the last driveable sample only after its authored gates', () => {
  const last = path.points.length - 1
  const gates = race.timingGates ?? []
  expect(gates.length).toBeGreaterThan(0)
  const rival = { ...player, player: false, pathIndex: last - 2, nextSector: gates.length + 1 }
  const finished = updateProgress(rival, last - 2, path.points.length, 12, 1, 0, false, gates, false)
  expect(finished).toMatchObject({ lap: 1, finishedAt: 12, nextSector: 1 })
  expect(updateProgress({ ...rival, nextSector: 1 }, last - 2, path.points.length, 12, 1, 0, false, gates, false))
    .toMatchObject({ lap: 0, finishedAt: null })
  expect(updateProgress({ ...rival, pathIndex: last - 5 }, last - 4, path.points.length, 12, 1, 0, false, gates, false))
    .toMatchObject({ lap: 0, finishedAt: null })
})

it('consumes adjacent authored checkpoint samples crossed in the same 60 Hz tick', () => {
  const gates = [5, 6, 7]
  const rival = { ...player, player: false, nextSector: 1, pathIndex: 4 }
  const next = updateProgress(rival, 8, path.points.length, 1, 1, 0, false, gates, false)
  expect(next).toMatchObject({ nextSector: 4, lap: 0, finishedAt: null })
  // Skipping these would strand the next checkpoint permanently behind AI.
  expect(updateProgress(rival, 5, path.points.length, 1, 1, 0, false, gates, false))
    .toMatchObject({ nextSector: 2, lap: 0 })
})
