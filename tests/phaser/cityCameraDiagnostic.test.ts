import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { decodeTrack } from '@/domain/track/trackCodec'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { buildBridgePresentation, getBridgeDeckOcclusion, type BridgePolygonPrimitive } from '@/phaser/rendering/bridgeRenderer'
import { isVehicleAboveStructures } from '@/phaser/rendering/vehicleRenderer'

function contains(point: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

it('marks the player through City Harbor decks without marking supported ramp traffic', () => {
  const raw = JSON.parse(readFileSync('tests/fixtures/cityHarbor.trackforge.json', 'utf8'))
  const geometry = buildTrackGeometry(decodeTrack(raw.track, 1)!)
  const path = geometry.path
  const presentation = buildBridgePresentation(geometry)
  const decks = presentation.filter((primitive): primitive is BridgePolygonPrimitive => primitive.kind === 'edge')
  const covered = getBridgeDeckOcclusion(geometry)
  expect(buildBridgePresentation(geometry)).toBe(presentation)
  const base = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2, handling: 'arcade' })
  const p = path.points[150]!
  const q = path.points[151]!
  const angle = Math.atan2(q.y - p.y, q.x - p.x)
  let race: RaceState = { ...base, phase: 'running', vehicles: [{ ...base.vehicles[0]!, x: p.x, y: p.y, z: 0, pathIndex: 150, structureRunId: null, angle, vx: 170 * Math.cos(angle), vy: 170 * Math.sin(angle), speed: 170 }] }
  let hiddenFrames = 0
  for (let frame = 0; frame < 900; frame++) {
    const vehicle = race.vehicles[0]!
    const aim = path.points[(vehicle.pathIndex + 7) % path.points.length]!
    const delta = Math.atan2(aim.y - vehicle.y, aim.x - vehicle.x) - vehicle.angle
    const steering = Math.max(-1, Math.min(1, Math.atan2(Math.sin(delta), Math.cos(delta)) * 4))
    race = stepRace(race, { steering, throttle: 0.8, braking: false }, 1 / 60, { next: () => 0.5 }).state
    const player = race.vehicles[0]!
    if (!isVehicleAboveStructures(player, path) && decks.some((deck) => deck.deckHeight > player.z + 2 && contains(player, deck.polygon))) {
      hiddenFrames++
      expect(covered(player)).toBe(true)
    }
  }
  expect(hiddenFrames).toBeGreaterThan(10)
  for (let i = 0; i < path.points.length; i++) {
    const point = path.points[i]!
    const road = path.roadSurface.at(i, point)
    if (road.structureHeight > 0.005 && road.structureHeight < 24) {
      expect(covered({ ...point, z: road.height })).toBe(false)
    }
  }
})
