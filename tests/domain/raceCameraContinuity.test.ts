import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { recoverRacePlayer, stepRace } from '@/domain/race/raceEngine'
import { buildRaceCameraHints } from '@/domain/race/trackContext'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { advanceRaceCamera, createRaceCamera } from '@/phaser/camera/raceCamera'

// A compressed winding stage based on the shape that exposed the bug.
const controls = [
  { x: -71, y: -196 }, { x: -157, y: -295 }, { x: -6, y: -373 },
  { x: 145, y: -451 }, { x: 168, y: -515 }, { x: -107, y: -534 },
  { x: -171, y: -555 }, { x: -166, y: -623 },
].map(point => ({ ...point, surface: 'street' as const, curve: 'smooth' as const, tension: 0.5 }))

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing camera regression fixture')
  return value
}

function closedHairpin() {
  return buildRoadPath([
    { x: 0, y: 0, surface: 'street' },
    { x: 600, y: 0, surface: 'street' },
    { x: 600, y: 50, surface: 'street' },
    { x: 0, y: 50, surface: 'street' },
    { x: -300, y: 50, surface: 'street' },
    { x: -300, y: -150, surface: 'street' },
    { x: -300, y: -300, surface: 'street' },
    { x: 0, y: -300, surface: 'street' },
    { x: 0, y: 0, surface: 'street' },
  ], EMPTY_TERRAIN)
}

function straightStage() {
  return buildRoadPath([
    { x: 0, y: 0, surface: 'street' },
    { x: 1000, y: 0, surface: 'street' },
    { x: 2000, y: 0, surface: 'street' },
  ], EMPTY_TERRAIN, undefined, 'point-to-point')
}

describe('race camera road continuity', () => {
  it('previews the road selected by race progress rather than a closer return arm', () => {
    const path = closedHairpin()
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1 })
    const index = path.points.findIndex(point => point.segment === 0 && point.x >= 432)
    const player = {
      ...required(race.vehicles[0]), x: 432, y: 30, angle: 0,
      vx: 100, vy: 0, speed: 100, pathIndex: index,
    }
    const hints = buildRaceCameraHints(path, player)
    const firstRoadPoint = required(hints.preview?.[1])
    expect(firstRoadPoint.y).toBeLessThan(20)
    expect(firstRoadPoint.x).toBeGreaterThan(432)
  })

  it('waits for sustained reverse travel and keeps direction stable while stopped', () => {
    const path = straightStage()
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
    const sample = required(nearestPathPoint(path, { x: 1000, y: 0 }))
    const player = { ...required(race.vehicles[0]), x: 1000, y: 0, angle: Math.PI,
      vx: -100, vy: 0, speed: 100, pathIndex: sample.index }
    let hints = buildRaceCameraHints(path, player)
    for (let frame = 0; frame < 10; frame += 1) {
      hints = buildRaceCameraHints(path, player, false, hints, 1 / 60)
    }
    expect(required(hints.preview?.at(-1)).x).toBeGreaterThan(player.x)
    // One forward tick must reset rather than accumulate reverse evidence.
    hints = buildRaceCameraHints(path, { ...player, vx: 100 }, false, hints, 1 / 60)
    for (let frame = 0; frame < 10; frame += 1) {
      hints = buildRaceCameraHints(path, player, false, hints, 1 / 60)
    }
    expect(required(hints.preview?.at(-1)).x).toBeGreaterThan(player.x)
    for (let frame = 0; frame < 10; frame += 1) {
      hints = buildRaceCameraHints(path, player, false, hints, 1 / 60)
    }
    expect(required(hints.preview?.at(-1)).x).toBeLessThan(player.x)
    const stopped = { ...player, vx: 0, speed: 0 }
    for (let frame = 0; frame < 30; frame += 1) {
      hints = buildRaceCameraHints(path, stopped, false, hints, 1 / 60)
    }
    expect(required(hints.preview?.at(-1)).x).toBeLessThan(player.x)
    const forward = { ...player, angle: 0, vx: 100 }
    for (let frame = 0; frame < 20; frame += 1) {
      hints = buildRaceCameraHints(path, forward, false, hints, 1 / 60)
    }
    expect(required(hints.preview?.at(-1)).x).toBeGreaterThan(player.x)
  })

  it('treats a reversed circuit start as the normal route direction', () => {
    const path = closedHairpin()
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, reversed: true })
    const index = path.points.findIndex(point => point.segment === 0 && point.x >= 432)
    const point = required(path.points[index])
    const player = { ...required(race.vehicles[0]), x: point.x, y: point.y,
      angle: Math.PI, vx: -100, vy: 0, speed: 100, pathIndex: index }
    let hints = buildRaceCameraHints(path, player, true)
    for (let frame = 0; frame < 20; frame += 1) {
      hints = buildRaceCameraHints(path, player, true, hints, 1 / 60)
    }
    expect(hints.followingOppositeTravel).toBe(false)
    expect(required(hints.preview?.at(-1)).x).toBeLessThan(player.x)
    const goingBack = { ...player, angle: 0, vx: 100 }
    for (let frame = 0; frame < 20; frame += 1) {
      hints = buildRaceCameraHints(path, goingBack, true, hints, 1 / 60)
    }
    expect(hints.followingOppositeTravel).toBe(true)
    expect(required(hints.preview?.at(-1)).x).toBeGreaterThan(player.x)
  })

  it('does not look past the start of an open route when traveling back', () => {
    const path = buildRoadPath([
      { x: 0, y: 0, surface: 'street' },
      { x: 1000, y: 0, surface: 'street' },
    ], EMPTY_TERRAIN, undefined, 'point-to-point')
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
    const point = required(path.points[0])
    const player = { ...required(race.vehicles[0]), x: point.x, y: point.y, pathIndex: 0,
      angle: Math.PI, vx: -100, vy: 0, speed: 100 }
    const previous = { ...race.cameraHints, followingOppositeTravel: true }
    const hints = buildRaceCameraHints(path, player, false, previous, 1 / 60)
    expect(hints.target.x).toBeCloseTo(player.x)
    expect(hints.target.y).toBeCloseTo(player.y)
    expect(hints.preview).toHaveLength(1)
  })

  it('looks in the direction of travel while returning to a missed checkpoint', () => {
    const path = straightStage()
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
    const sample = required(nearestPathPoint(path, { x: 1200, y: 0 }))
    const player = {
      ...required(race.vehicles[0]), x: 1200, y: 0, angle: Math.PI,
      vx: -100, vy: 0, speed: 100, pathIndex: sample.index, nextSector: 1 as const,
    }
    let state = { ...race, phase: 'running' as const, vehicles: [player] }
    let camera = createRaceCamera({ x: player.x, y: player.y, angle: 0 })
    for (let frame = 0; frame < 120; frame += 1) {
      state = stepRace(state, { steering: 0, throttle: 1, braking: false }, 1 / 60, { next: () => 0.5 }).state as typeof state
      camera = advanceRaceCamera(camera, state.cameraHints,
        { dynamicZoom: true, steering: 0, viewport: { width: 393, height: 852 } }, 1 / 60)
    }
    const current = required(state.vehicles[0])
    const lastPreview = required(state.cameraHints.preview?.at(-1))
    const error = Math.atan2(Math.sin(camera.angle - Math.PI), Math.cos(camera.angle - Math.PI))
    expect(current.nextSector).toBe(1)
    expect(lastPreview.x).toBeLessThan(current.x - 10)
    expect(Math.abs(error)).toBeLessThan(0.2)
  })

  it('keeps the camera near the direction of motion when cutting across a road', () => {
    const path = straightStage()
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
    const sample = required(nearestPathPoint(path, { x: 1000, y: 0 }))
    const travelAngle = 100 * Math.PI / 180
    const player = {
      ...required(race.vehicles[0]), x: 1000, y: 0, angle: travelAngle,
      vx: Math.cos(travelAngle) * 100, vy: Math.sin(travelAngle) * 100,
      speed: 100, pathIndex: sample.index,
    }
    const result = stepRace({ ...race, phase: 'running', vehicles: [player] },
      { steering: 0, throttle: 0, braking: false }, 1 / 60, { next: () => 0.5 }).state
    const current = required(result.vehicles[0])
    const motion = Math.atan2(current.vy, current.vx)
    const error = Math.atan2(Math.sin(result.cameraHints.roadAngle - motion), Math.cos(result.cameraHints.roadAngle - motion))
    expect(Math.abs(error)).toBeLessThan(0.8)
    expect(required(result.cameraHints.preview?.at(-1)).x).toBeGreaterThan(current.x)
  })

  it.each([false, true])(
    'keeps simulation on the current arm of a closed hairpin (reversed: %s)',
    (reversed) => {
      const path = closedHairpin()
      const index = path.points.findIndex(point => point.segment === 0 && point.x >= 432)
      const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, handling: 'simulation', reversed })
      const angle = reversed ? Math.PI : 0
      const player = {
        ...required(race.vehicles[0]), x: 432, y: 30, angle,
        vx: reversed ? -100 : 100, vy: 0, speed: 100,
        pathIndex: index, pathDistance: required(path.points[index]).distance,
      }
      const result = stepRace(
        { ...race, phase: 'running', vehicles: [player] },
        { steering: 0, throttle: 0, braking: false },
        1 / 60,
        { next: () => 0.5 },
      ).state
      const current = required(result.vehicles[0])
      const error = Math.atan2(
        Math.sin(result.cameraHints.roadAngle - angle),
        Math.cos(result.cameraHints.roadAngle - angle),
      )
      expect(required(path.points[current.pathIndex]).segment).toBe(0)
      expect(Math.abs(error)).toBeLessThan(0.3)
    },
  )

  it('reacquires a distant road after leaving the current road on a closed circuit', () => {
    const path = closedHairpin()
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, handling: 'simulation' })
    const destinationIndex = 262
    const destination = required(path.points[destinationIndex])
    const player = {
      ...required(race.vehicles[0]), x: destination.x, y: destination.y,
      pathIndex: path.points.findIndex(point => point.segment === 0 && point.x >= 432),
      speed: 0, vx: 0, vy: 0,
    }
    const result = stepRace(
      { ...race, phase: 'running', vehicles: [player] },
      { steering: 0, throttle: 0, braking: false },
      1 / 60,
      { next: () => 0.5 },
    ).state
    expect(Math.abs(required(result.vehicles[0]).pathIndex - destinationIndex)).toBeLessThan(3)
  })

  it('updates the camera’s player position immediately on manual recovery', () => {
    const path = straightStage()
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
    const sample = required(nearestPathPoint(path, { x: 1800, y: 0 }))
    const contact = required(nearestPathPoint(path, { x: 1200, y: 0 }))
    const player = { ...required(race.vehicles[0]), x: 1800, y: 100, pathIndex: sample.index, lastRoadContactIndex: contact.index, nextSector: 4 as const, recoveryCheckpoint: null }
    const recovered = recoverRacePlayer({
      ...race,
      phase: 'running',
      recoveryCheckpoints: [10],
      vehicles: [player],
      cameraHints: { ...race.cameraHints, target: player, preview: [player], followingOppositeTravel: true, directionChangeSeconds: 0.2 },
    })
    const after = required(recovered.vehicles[0])
    expect(after.x).toBe(contact.point.x)
    expect(recovered.cameraHints.preview?.[0]).toMatchObject({ x: after.x, y: after.y })
    expect(recovered.cameraHints.followingOppositeTravel).toBe(false)
    expect(recovered.cameraHints.directionChangeSeconds).toBe(0)
  })

  it('clears reverse camera travel when the player is automatically recovered', () => {
    const path = straightStage()
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point' })
    const sample = required(nearestPathPoint(path, { x: 1800, y: 0 }))
    const contact = required(nearestPathPoint(path, { x: 1200, y: 0 }))
    const player = { ...required(race.vehicles[0]), x: 1800, y: 100, pathIndex: sample.index,
      lastRoadContactIndex: contact.index, nextSector: 4 as const,
      recoveryCheckpoint: null, stuckDuration: 0.66, speed: 0, vx: 0, vy: 0 }
    const result = stepRace({ ...race, phase: 'running', elapsed: 2, vehicles: [player], recoveryCheckpoints: [10],
      cameraHints: { ...race.cameraHints, followingOppositeTravel: true, directionChangeSeconds: 0.2 } },
      { steering: 0, throttle: 1, braking: false }, 1 / 60, { next: () => 0.5 })
    expect(result.events.some(event => event.type === 'vehicle-recovered')).toBe(true)
    expect(required(result.state.vehicles[0]).x).toBe(contact.point.x)
    expect(result.state.cameraHints.followingOppositeTravel).toBe(false)
    expect(result.state.cameraHints.directionChangeSeconds).toBe(0)
  })

  it.each([
    { name: 'approaching the bend', position: { x: 132, y: -443 } },
    { name: 'leaving the bend', position: { x: 121, y: -520 } },
  ])('follows the player’s road when $name', ({ position }) => {
    const path = buildRoadPath(controls, EMPTY_TERRAIN, undefined, 'point-to-point')
    const race = createRace({
      path, playerCar: 'blue', difficulty: 'normal', laps: 1, routeKind: 'point-to-point',
    })
    const sample = required(nearestPathPoint(path, position))
    const before = required(path.points[sample.index - 2])
    const after = required(path.points[sample.index + 2])
    const angle = Math.atan2(after.y - before.y, after.x - before.x)
    const player = {
      ...required(race.vehicles[0]),
      x: sample.point.x + Math.sin(angle) * 42,
      y: sample.point.y - Math.cos(angle) * 42,
      angle, speed: 100, vx: Math.cos(angle) * 100, vy: Math.sin(angle) * 100,
      pathIndex: sample.index, pathDistance: sample.point.distance,
    }
    const result = stepRace(
      { ...race, phase: 'running', vehicles: [player] },
      { steering: 0, throttle: 0, braking: false },
      1 / 60,
      { next: () => 0.5 },
    ).state
    const error = Math.atan2(
      Math.sin(result.cameraHints.roadAngle - angle),
      Math.cos(result.cameraHints.roadAngle - angle),
    )
    expect(Math.abs(error)).toBeLessThan(0.8)
  })
})
