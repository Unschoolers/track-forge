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
  const race = createRace({ path, playerCar: 'red', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
  const gateIndex = (path.points.length - 1) / 4
  const gateX = path.totalLength / 4
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
