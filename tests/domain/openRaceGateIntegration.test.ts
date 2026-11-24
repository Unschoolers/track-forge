import { expect, it, vi } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import { resetVehicleToTrack } from '@/domain/race/trackContext'

const movement = vi.hoisted(() => ({ x: 0, y: 0 }))
vi.mock('@/domain/race/vehiclePhysics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/race/vehiclePhysics')>()
  return { ...actual, stepVehicle: (vehicle: object) => ({ ...vehicle, ...movement }) }
})

it('does not accept a grass bypass or emit timing, then accepts a crossing after recovery', () => {
  const track = createStarterTrack(asTrackId('gate-test'), 1)
  const points = [0, 200, 400, 600, 800].map((x) => ({ x, y: 0, surface: 'street' as const, curve: 'corner' as const }))
  const path = buildRoadPath(points, track.terrain, undefined, 'point-to-point')
  const race = createRace({ path, recoveryCheckpoints: [0.25, 0.5, 0.75], playerCar: 'red', difficulty: 'normal', laps: 1, routeKind: 'point-to-point', handling: 'arcade' })
  const gateIndex = race.timingGates?.[0]
  if (gateIndex === undefined) throw new Error('Missing authored checkpoint')
  const gateX = path.points[gateIndex]!.x
  const player = { ...race.vehicles[0]!, x: gateX - 1, y: 80, pathIndex: Math.floor(gateIndex) }
  movement.x = gateX + 1
  movement.y = 0
  const initial = { ...race, phase: 'running' as const, vehicles: [player] }
  const input = { steering: 0, throttle: 0, braking: false }
  const bypass = stepRace(initial, input, 0.01, { next: () => 0.5 })
  expect(bypass.state.vehicles[0]!.nextSector).toBe(1)
  expect(bypass.events.some(e => e.type === 'gate-crossed' || e.type === 'vehicle-finished')).toBe(false)
  movement.x = gateX + 2
  const rejoin = stepRace(bypass.state, input, 0.01, { next: () => 0.5 })
  expect(rejoin.state.vehicles[0]!.nextSector).toBe(1)
  expect(rejoin.events.some(e => e.type === 'gate-crossed')).toBe(false)
  const recovered = resetVehicleToTrack(rejoin.state.vehicles[0]!, path, { pathIndex: Math.floor(gateIndex) - 1, maxPathIndex: Math.ceil(gateIndex) - 1 })
  movement.x = gateX + 1
  const crossing = stepRace({ ...rejoin.state, vehicles: [recovered] }, input, 0.01, { next: () => 0.5 })
  expect(crossing.events).toContainEqual({ type: 'gate-crossed', vehicleId: 'player', gate: 1, lap: 0, time: crossing.state.elapsed })
})

it.each(['arcade', 'simulation'] as const)('counts down after a missed gate, freezes while paused, and recovers before the gate in %s', handling => {
  const track = createStarterTrack(asTrackId('missed-gate'), 1)
  const points = [0, 200, 400, 600, 800].map((x) => ({ x, y: 0, surface: 'street' as const, curve: 'corner' as const }))
  const path = buildRoadPath(points, track.terrain, undefined, 'point-to-point')
  const race = createRace({ path, recoveryCheckpoints: [0.25, 0.5, 0.75], playerCar: 'red', difficulty: 'normal', laps: 1, routeKind: 'point-to-point', handling })
  const gateIndex = race.timingGates?.[0]
  if (gateIndex === undefined) throw new Error('Missing authored checkpoint')
  const lower = Math.floor(gateIndex)
  const gateX = path.points[lower]!.x + (path.points[lower + 1]!.x - path.points[lower]!.x) * (gateIndex - lower)
  const player = { ...race.vehicles[0]!, x: gateX - 1, y: 80, pathIndex: lower }
  const input = { steering: 0, throttle: 0, braking: false }
  const random = { next: () => 0.5 }
  movement.x = gateX + 1
  movement.y = 80
  const missed = stepRace({ ...race, phase: 'running', vehicles: [player] }, input, 0.01, random)
  expect(missed.state.missedCheckpoint).toMatchObject({ gate: 1, remainingSeconds: 2 })
  expect(missed.state.vehicles[0]!.nextSector).toBe(1)
  const paused = stepRace({ ...missed.state, paused: true }, input, 0.05, random)
  expect(paused.state.missedCheckpoint?.remainingSeconds).toBe(2)
  const countdown = stepRace(missed.state, input, 0.05, random)
  expect(countdown.state.missedCheckpoint?.remainingSeconds).toBeCloseTo(1.95)
  let lastTick = countdown
  for (let i = 0; i < 38; i++) lastTick = stepRace(lastTick.state, input, 0.05, random)
  expect(lastTick.state.missedCheckpoint?.remainingSeconds).toBeCloseTo(0.05)
  const recovered = stepRace(lastTick.state, input, 0.05, random)
  expect(recovered.state.missedCheckpoint).toBeUndefined()
  expect(recovered.events).toContainEqual(expect.objectContaining({ type: 'vehicle-recovered', reason: 'missed-checkpoint' }))
  const resetCar = recovered.state.vehicles[0]!
  // A missed timing gate returns before the pending stripe with room to drive
  // through it, not necessarily all the way back to the race start.
  expect(resetCar.pathIndex).toBeGreaterThanOrEqual(0)
  expect(resetCar.pathIndex).toBeLessThan(gateIndex)
  expect(resetCar.x).toBeCloseTo(path.points[resetCar.pathIndex]!.x)
  expect(resetCar.lap).toBe(player.lap)
  expect(resetCar.recoveryPenaltySeconds).toBeCloseTo(0.1)
  expect(recovered.state.vehicles[0]!.nextSector).toBe(1)
  expect(recovered.state.elapsed).toBeCloseTo(missed.state.elapsed + 2)
})

it('clears the countdown only on a valid forward recross', () => {
  const track = createStarterTrack(asTrackId('recross-gate'), 1)
  const path = buildRoadPath([0, 200, 400, 600, 800].map(x => ({ x, y: 0, surface: 'street' as const, curve: 'corner' as const })), track.terrain, undefined, 'point-to-point')
  const race = createRace({ path, recoveryCheckpoints: [0.25, 0.5, 0.75], playerCar: 'red', difficulty: 'normal', laps: 1, routeKind: 'point-to-point', handling: 'arcade' })
  const index = race.timingGates?.[0]
  if (index === undefined) throw new Error('Missing authored checkpoint')
  const lower = Math.floor(index)
  const x = path.points[lower]!.x + (path.points[lower + 1]!.x - path.points[lower]!.x) * (index - lower)
  const input = { steering: 0, throttle: 0, braking: false }
  const random = { next: () => 0.5 }
  movement.x = x + 1; movement.y = 80
  const missed = stepRace({ ...race, phase: 'running', vehicles: [{ ...race.vehicles[0]!, x: x - 1, y: 80, pathIndex: lower }] }, input, 0.01, random)
  movement.x = x - 1; movement.y = 0
  const back = stepRace(missed.state, input, 0.01, random)
  expect(back.state.missedCheckpoint).toBeDefined()
  movement.x = x + 1
  const crossed = stepRace(back.state, input, 0.01, random)
  expect(crossed.state.missedCheckpoint).toBeUndefined()
  expect(crossed.state.vehicles[0]!.nextSector).toBe(2)
})

it.each([false, true])('requires the actual circuit gate line in either direction (reversed=%s)', (reversed) => {
  const terrain = createStarterTrack(asTrackId('circuit-gate'), 1).terrain
  const points = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 800 }, { x: 0, y: 800 }, { x: 0, y: 0 }]
    .map(point => ({ ...point, surface: 'street' as const, curve: 'corner' as const }))
  const path = buildRoadPath(points, terrain)
  expect(path.closed).toBe(true)
  const authoredRatio = (0.13 + (reversed ? -0.25 : 0.25) + 1) % 1
  const race = createRace({ path, recoveryCheckpoints: [authoredRatio], playerCar: 'blue', difficulty: 'normal', laps: 1, handling: 'arcade', startRatio: 0.13, reversed })
  const direction = reversed ? -1 : 1
  const count = path.points.length
  const position = race.timingGates?.[0]
  if (position === undefined) throw new Error('Missing authored checkpoint')
  const index = Math.floor(position)
  const a = path.points[index]!
  const b = path.points[(index + 1) % count]!
  const x = a.x + (b.x - a.x) * (position - index)
  const y = a.y + (b.y - a.y) * (position - index)
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const tx = direction * (b.x - a.x) / length
  const ty = direction * (b.y - a.y) / length
  const player = { ...race.vehicles[0]!, x: x - tx - ty * 60, y: y - ty + tx * 60, pathIndex: index }
  const input = { steering: 0, throttle: 0, braking: false }
  const random = { next: () => 0.5 }
  movement.x = x + tx - ty * 60
  movement.y = y + ty + tx * 60
  const missed = stepRace({ ...race, phase: 'running', vehicles: [player] }, input, 1 / 60, random)
  expect(missed.state.missedCheckpoint?.gate).toBe(1)
  expect(missed.state.vehicles[0]!.nextSector).toBe(1)
  movement.x = x - tx
  movement.y = y - ty
  const back = stepRace(missed.state, input, 1 / 60, random)
  expect(back.state.missedCheckpoint).toBeDefined()
  movement.x = x + tx
  movement.y = y + ty
  const crossed = stepRace(back.state, input, 1 / 60, random)
  expect(crossed.state.missedCheckpoint).toBeUndefined()
  expect(crossed.state.vehicles[0]!.nextSector).toBe(2)
})
