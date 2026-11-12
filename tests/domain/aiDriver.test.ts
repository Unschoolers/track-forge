import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { getTrafficState } from '@/domain/race/ai/traffic'
import {
  choosePassingLane,
  scorePassingLane,
} from '@/domain/race/ai/lanePlanner'
import { stepAiVehicle } from '@/domain/race/ai/aiDriver'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import type { RaceVehicle } from '@/domain/race/raceState'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import type { RoadPath } from '@/domain/track/pathBuilder'

const track = createStarterTrack(asTrackId('starter'), 1)
const path = buildRoadPath(track.points, track.terrain)

function cars() {
  return createRace({
    path,
    playerCar: 'blue',
    difficulty: 'normal',
    laps: 3,
  }).vehicles
}

function onPath(
  vehicle: RaceVehicle,
  road: RoadPath,
  index: number,
  lane: number,
  speed: number,
  reversed = false,
): RaceVehicle {
  const point = road.points[index]
  const before =
    road.points[(index - 1 + road.points.length) % road.points.length]
  const after = road.points[(index + 1) % road.points.length]
  if (!point || !before || !after) throw new Error('Missing path fixture')
  const length = Math.hypot(after.x - before.x, after.y - before.y)
  const tx = (after.x - before.x) / length
  const ty = (after.y - before.y) / length
  const position = { x: point.x - ty * lane, y: point.y + tx * lane }
  const direction = reversed ? -1 : 1
  return {
    ...vehicle,
    ...position,
    pathIndex: index,
    pathDistance: point.distance,
    lane,
    z: road.roadSurface.at(index, position).height,
    angle: Math.atan2(direction * ty, direction * tx),
    vx: direction * tx * speed,
    vy: direction * ty * speed,
    speed,
    ai: createAiDriverState(lane),
  }
}

function driveWithTraffic(
  vehicle: RaceVehicle,
  traffic: ReturnType<typeof getTrafficState>,
) {
  return stepAiVehicle(vehicle, path, traffic, 'normal', 0.05, {
    next: () => 0.5,
  })
}

describe('overtaking AI', () => {
  it.each(['road path', 'sample count'] as const)(
    'ignores finished opponents when finding traffic using %s',
    (pathKind) => {
      const [, first, second, third] = cars()
      if (!first || !second || !third) throw new Error('Missing race fixtures')
      const ego = onPath(first, path, 30, 0, 120)
      const finisher = { ...onPath(second, path, 33, 0, 0), finishedAt: 0 }
      const rival = onPath(third, path, 34, 0, 10)
      const trafficPath = pathKind === 'road path' ? path : path.points.length

      const clear = getTrafficState(ego, [finisher], trafficPath)
      const blocked = getTrafficState(ego, [finisher, rival], trafficPath)

      expect(clear.ahead).toBeNull()
      expect(clear.nearby).toEqual([])
      expect(driveWithTraffic(ego, clear).braking).toBe(false)
      expect(blocked.ahead?.vehicle.id).toBe(rival.id)
      expect(blocked.nearby.map(({ vehicle }) => vehicle.id)).toEqual([rival.id])
      expect(driveWithTraffic(ego, blocked).braking).toBe(true)
    },
  )

  it('does not brake for a safe adjacent car but keeps it for lane planning', () => {
    const [, first, second] = cars()
    if (!first || !second) throw new Error('Missing race fixtures')
    const ego = onPath(first, path, 30, -20, 120)
    const rival = onPath(second, path, 33, 20, 10)
    const traffic = getTrafficState(ego, [rival], path)
    const clear = driveWithTraffic(ego, getTrafficState(ego, [], path))
    const observed = driveWithTraffic(ego, traffic)

    expect(getVehicleStepContext(path, ego).onRoad).toBe(true)
    expect(getVehicleStepContext(path, rival).onRoad).toBe(true)
    expect(traffic.nearby[0]?.distance).toBeCloseTo(18, 0)
    expect(Math.hypot(rival.x - ego.x, rival.y - ego.y)).toBeCloseTo(44, 0)
    expect(clear.braking).toBe(false)
    expect(observed.braking).toBe(false)
    expect(observed.speed).toBeCloseTo(clear.speed)
    expect(traffic.ahead).toBeNull()
    expect(traffic.nearby.map(({ vehicle }) => vehicle.id)).toContain(rival.id)
    expect(scorePassingLane(20, traffic, 'normal')).toBeLessThan(
      scorePassingLane(-20, traffic, 'normal'),
    )
  })

  it('brakes for the nearest blocking car even if an adjacent car is closer', () => {
    const [blockingCar, first, second] = cars()
    if (!blockingCar || !first || !second)
      throw new Error('Missing race fixtures')
    const ego = onPath(first, path, 30, -20, 120)
    const adjacent = onPath(second, path, 33, 20, 10)
    const blocker = onPath(blockingCar, path, 34, -20, 10)
    const traffic = getTrafficState(ego, [adjacent, blocker], path)
    const stepped = driveWithTraffic(ego, traffic)

    expect(traffic.ahead?.vehicle.id).toBe(blocker.id)
    expect(traffic.nearby.map(({ vehicle }) => vehicle.id)).toEqual([
      adjacent.id,
      blocker.id,
    ])
    expect(stepped.braking).toBe(true)
    expect(stepped.speed).toBeLessThan(
      driveWithTraffic(ego, getTrafficState(ego, [], path)).speed,
    )
  })

  it('brakes when the car ahead overlaps the vehicle clearance corridor', () => {
    const [, first, second] = cars()
    if (!first || !second) throw new Error('Missing race fixtures')
    const ego = onPath(first, path, 30, -8, 120)
    const rival = onPath(second, path, 33, 8, 10)
    const traffic = getTrafficState(ego, [rival], path)

    expect(traffic.ahead?.vehicle.id).toBe(rival.id)
    expect(driveWithTraffic(ego, traffic).braking).toBe(true)
  })

  it.each([
    { egoLane: -20, rivalLane: 20 },
    { egoLane: 20, rivalLane: -20 },
  ])(
    'keeps a side-by-side car in the same path sample for lane planning',
    ({ egoLane, rivalLane }) => {
      const [, first, second] = cars()
      if (!first || !second) throw new Error('Missing race fixtures')
      const ego = onPath(first, path, 30, egoLane, 120)
      const rival = onPath(second, path, 30, rivalLane, 10)
      const traffic = getTrafficState(ego, [rival], path)

      expect(traffic.nearby[0]?.distance).toBeCloseTo(0, 3)
      expect(traffic.ahead).toBeNull()
      expect(driveWithTraffic(ego, traffic).braking).toBe(false)
      expect(scorePassingLane(rivalLane, traffic, 'normal')).toBeLessThan(
        scorePassingLane(egoLane, traffic, 'normal'),
      )
    },
  )

  it('treats an overlapping car in the same path sample as an obstruction', () => {
    const [, first, second] = cars()
    if (!first || !second) throw new Error('Missing race fixtures')
    const ego = onPath(first, path, 30, 0, 120)
    const rival = onPath(second, path, 30, 0, 10)
    const traffic = getTrafficState(ego, [rival], path)

    expect(traffic.ahead?.vehicle.id).toBe(rival.id)
    expect(traffic.ahead?.distance).toBe(0)
    expect(driveWithTraffic(ego, traffic).braking).toBe(true)
  })

  it.each(['height', 'off road'] as const)(
    'does not react to a phantom obstruction separated by %s',
    (separation) => {
      const [, first, second] = cars()
      if (!first || !second) throw new Error('Missing race fixtures')
      const ego = onPath(first, path, 30, 0, 120)
      const placed = onPath(second, path, 33, 0, 10)
      const rival =
        separation === 'height'
          ? { ...placed, z: placed.z + 24, grounded: false }
          : { ...placed, x: placed.x + 1_000 }
      const traffic = getTrafficState(ego, [rival], path)
      const clear = driveWithTraffic(ego, getTrafficState(ego, [], path))
      const observed = driveWithTraffic(ego, traffic)

      expect(clear.braking).toBe(false)
      expect(observed.braking).toBe(false)
      expect(observed.speed).toBeCloseTo(clear.speed)
      expect(traffic.ahead).toBeNull()
      expect(traffic.nearby).toHaveLength(0)
    },
  )

  it('does not classify the other branch of a crossing as traffic ahead', () => {
    const crossingPath = buildRoadPath(
      [
        { x: -84, y: -70, surface: 'street' },
        { x: 84, y: 70, surface: 'street' },
        { x: -84, y: 70, surface: 'street' },
        { x: 84, y: -70, surface: 'street' },
        { x: 300, y: -70, surface: 'street' },
        { x: 300, y: -300, surface: 'street' },
        { x: -300, y: -300, surface: 'street' },
        { x: -300, y: -70, surface: 'street' },
        { x: -84, y: -70, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    const crossing = crossingPath.crossings.find(({ key }) => key === '0:2')
    const [, first, second] = cars()
    if (!crossing || !first || !second)
      throw new Error('Missing crossing fixtures')
    const ego = onPath(first, crossingPath, crossing.firstPathIndex, 0, 120)
    const rival = onPath(second, crossingPath, crossing.secondPathIndex, 0, 10)

    expect(Math.hypot(rival.x - ego.x, rival.y - ego.y)).toBeLessThan(12)
    const traffic = getTrafficState(ego, [rival], crossingPath)
    expect(traffic.ahead).toBeNull()
    expect(traffic.nearby).toHaveLength(0)
  })

  it('keeps traffic on the same rising ramp despite its different absolute height', () => {
    const ramp = buildRoadPath(
      [
        { x: 0, y: 0, surface: 'street' },
        { x: 500, y: 0, surface: 'street', structure: 'overpass' },
        { x: 1000, y: 0, surface: 'street' },
        { x: 1000, y: 500, surface: 'street' },
        { x: 0, y: 500, surface: 'street' },
        { x: 0, y: 0, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    const [, first, second] = cars()
    if (!first || !second) throw new Error('Missing race fixtures')
    const ego = onPath(first, ramp, 85, 0, 120)
    const rival = onPath(second, ramp, 95, 0, 10)
    const traffic = getTrafficState(ego, [rival], ramp)

    expect(rival.z - ego.z).toBeGreaterThan(12)
    expect(traffic.ahead?.vehicle.id).toBe(rival.id)
    expect(traffic.ahead?.distance).toBeCloseTo(60, 0)
  })

  it.each([false, true])(
    'finds a car just ahead in the same path sample (reversed: %s)',
    (reversed) => {
      const [, first, second] = cars()
      if (!first || !second) throw new Error('Missing race fixtures')
      const ego = onPath(first, path, 30, 0, 120, reversed)
      const rival = {
        ...onPath(second, path, 30, 0, 10, reversed),
        x: ego.x + Math.cos(ego.angle) * 2,
        y: ego.y + Math.sin(ego.angle) * 2,
      }
      const traffic = getTrafficState(ego, [rival], path, reversed)
      const stepped = stepAiVehicle(
        ego,
        path,
        traffic,
        'normal',
        0.05,
        { next: () => 0.5 },
        reversed,
      )

      expect(traffic.ahead?.distance).toBeCloseTo(2)
      expect(stepped.braking).toBe(true)
    },
  )

  it.each([false, true])(
    'does not brake for a car just behind in the same path sample (reversed: %s)',
    (reversed) => {
      const [, first, second] = cars()
      if (!first || !second) throw new Error('Missing race fixtures')
      const ego = onPath(first, path, 30, 0, 120, reversed)
      const rival = {
        ...onPath(second, path, 30, 0, 10, reversed),
        x: ego.x - Math.cos(ego.angle) * 2,
        y: ego.y - Math.sin(ego.angle) * 2,
      }
      const traffic = getTrafficState(ego, [rival], path, reversed)
      const stepped = stepAiVehicle(
        ego,
        path,
        traffic,
        'normal',
        0.05,
        { next: () => 0.5 },
        reversed,
      )

      expect(traffic.ahead).toBeNull()
      expect(traffic.nearby[0]?.signedDistance).toBeLessThan(0)
      expect(stepped.braking).toBe(false)
    },
  )

  it.each([false, true])(
    'brakes for a closing car across the physical path wrap (reversed: %s)',
    (reversed) => {
      const [, first, second] = cars()
      if (!first || !second) throw new Error('Missing race fixtures')
      const egoIndex = reversed ? 1 : path.points.length - 2
      const rivalIndex = reversed ? path.points.length - 2 : 1
      const ego = onPath(first, path, egoIndex, 0, 120, reversed)
      const rival = onPath(second, path, rivalIndex, 0, 10, reversed)
      const traffic = getTrafficState(ego, [rival], path, reversed)
      const stepped = stepAiVehicle(
        ego,
        path,
        traffic,
        'normal',
        0.05,
        { next: () => 0.5 },
        reversed,
      )

      expect(traffic.ahead?.vehicle.id).toBe(rival.id)
      expect(traffic.ahead?.distance).toBeCloseTo(18, 0)
      expect(traffic.ahead?.timeToCollision).toBeCloseTo(18 / 110, 2)
      expect(stepped.braking).toBe(true)
    },
  )

  it('finds traffic ahead across the path wrap boundary', () => {
    const [ego, rival] = cars()
    if (!ego || !rival) throw new Error('Missing race fixtures')
    const traffic = getTrafficState(
      { ...ego, pathIndex: path.points.length - 4, lane: 0 },
      [{ ...rival, pathIndex: 3, lane: 0 }],
      path.points.length,
    )

    expect(traffic.ahead?.vehicle.id).toBe(rival.id)
    expect(traffic.ahead?.distance).toBe(7)
  })

  it('rejects an occupied lane and chooses the clearest alternative', () => {
    const [ego, rival] = cars()
    if (!ego || !rival) throw new Error('Missing race fixtures')
    const traffic = getTrafficState(
      { ...ego, lane: 0, pathIndex: 10 },
      [{ ...rival, lane: -24, pathIndex: 15 }],
      path.points.length,
    )

    expect(scorePassingLane(-24, traffic, 'normal')).toBeLessThan(
      scorePassingLane(24, traffic, 'normal'),
    )
    expect(choosePassingLane({ ...ego, lane: 0 }, traffic, 'normal')).toBe(-8)
  })

  it('steers an AI car toward the path and brakes for emergency traffic', () => {
    const [ego, rival] = cars()
    if (!ego || !rival) throw new Error('Missing race fixtures')
    const moving = { ...ego, player: false, speed: 120, pathIndex: 10 }
    const traffic = getTrafficState(
      moving,
      [{ ...rival, speed: 10, pathIndex: 11 }],
      path.points.length,
    )
    const stepped = stepAiVehicle(
      {
        ...moving,
        ai: createAiDriverState(0),
        vx: 120,
      },
      path,
      traffic,
      'hard',
      0.1,
      { next: () => 0.5 },
    )

    expect(stepped.speed).toBeLessThan(moving.speed)
    expect(Number.isFinite(stepped.angle)).toBe(true)
  })

  it('commits to a passing lane and does not oscillate while holding it', () => {
    const [, ego, rival] = cars()
    if (!ego || !rival) throw new Error('Missing race fixtures')
    const moving = {
      ...ego,
      speed: 110,
      vx: 110,
      lane: 0,
      pathIndex: 10,
      ai: createAiDriverState(0),
    }
    const traffic = getTrafficState(
      moving,
      [{ ...rival, speed: 45, pathIndex: 16, lane: 0 }],
      path.points.length,
    )
    const passing = stepAiVehicle(
      moving,
      path,
      traffic,
      'normal',
      0.1,
      { next: () => 0.5 },
    )
    const committedLane = passing.ai?.passLane
    const changedTraffic = getTrafficState(
      passing,
      [{ ...rival, speed: 45, pathIndex: 17, lane: committedLane ?? 0 }],
      path.points.length,
    )
    const held = stepAiVehicle(
      passing,
      path,
      changedTraffic,
      'normal',
      0.1,
      { next: () => 0.5 },
    )

    expect(passing.ai).toMatchObject({
      phase: 'passing',
      targetLane: committedLane,
    })
    expect(committedLane).not.toBe(0)
    expect(held.ai?.passLane).toBe(committedLane)
  })

  it('does not brake a hard rival at 240 on a long flat straight', () => {
    const [, ego] = cars()
    if (!ego) throw new Error('Missing race fixture')
    const straight = buildRoadPath([
      { x: 0, y: 0, surface: 'street', curve: 'corner' },
      { x: 3000, y: 0, surface: 'street', curve: 'corner' },
      { x: 3000, y: 1000, surface: 'street', curve: 'corner' },
      { x: 0, y: 1000, surface: 'street', curve: 'corner' },
      { x: 0, y: 0, surface: 'street', curve: 'corner' },
    ], EMPTY_TERRAIN)
    const index = straight.points.findIndex((point) => point.distance > 600)
    const moving = onPath({ ...ego, car: 'red', aiPace: 1 }, straight, index, 0, 240)
    const result = stepAiVehicle(moving, straight, getTrafficState(moving, [], straight), 'hard', 0.05)
    expect(result.braking).toBe(false)
  })

  it('brakes earlier for a street-to-ice bend than a street bend', () => {
    const [, ego] = cars()
    if (!ego) throw new Error('Missing race fixture')
    const street = buildRoadPath([
      { x: 0, y: 0, surface: 'street', curve: 'corner' },
      { x: 1000, y: 0, surface: 'street', curve: 'corner' },
      { x: 1000, y: 600, surface: 'street', curve: 'corner' },
      { x: 0, y: 600, surface: 'street', curve: 'corner' },
      { x: 0, y: 0, surface: 'street', curve: 'corner' },
    ], EMPTY_TERRAIN)
    const ice = { ...street, points: street.points.map((point) => ({ ...point,
      surface: point.distance >= 900 && point.distance < 1200 ? 'ice' as const : point.surface })) }
    const onset = (road: RoadPath) => road.points.findIndex((point, index) => {
      if (point.distance < 500 || point.distance > 1000) return false
      const car = onPath({ ...ego, aiPace: 1 }, road, index, 0, 180)
      return stepAiVehicle(car, road, getTrafficState(car, [], road), 'normal', 0.05).braking
    })
    const streetOnset = onset(street)
    const iceOnset = onset(ice)
    expect(streetOnset).toBeGreaterThan(0)
    expect(iceOnset).toBeGreaterThan(0)
    expect(iceOnset).toBeLessThan(streetOnset)
  })

  it('does not cut back while the passed target is still ahead in the base lane', () => {
    const [, ego, rival] = cars()
    if (!ego || !rival) throw new Error('Missing race fixtures')
    const passing = { ...ego, lane: 40, pathIndex: 10, ai: {
      ...createAiDriverState(0), phase: 'passing' as const, targetLane: 40,
      passLane: 40, holdRemaining: 0, clearTime: 0.3, passTargetId: rival.id,
    } }
    const blocker = { ...rival, lane: 0, pathIndex: 16 }
    const result = driveWithTraffic(passing, getTrafficState(passing, [blocker], path.points.length))
    expect(result.ai?.phase).toBe('passing')
  })

  it.each(['passing', 'rejoin'] as const)('keeps clear of near-edge traffic during %s', (phase) => {
    const [, first, second] = cars()
    if (!first || !second) throw new Error('Missing race fixtures')
    const ego = onPath(first, path, 30, 35, 100)
    const passing = { ...ego, ai: { ...createAiDriverState(0), phase, passLane: 35,
      targetLane: phase === 'rejoin' ? 0 : 35, holdRemaining: 0, clearTime: 0.3 } }
    const rival = onPath(second, path, 31, 17, 100)
    const result = stepAiVehicle(passing, path, getTrafficState(passing, [rival], path), 'normal', 0.05)
    expect(result.ai?.phase).toBe('passing')
    expect(result.ai?.targetLane).toBe(35)
  })

  it('does not wrap gaps on an open road', () => {
    const [, first, second] = cars()
    if (!first || !second) throw new Error('Missing race fixtures')
    const open = { ...path, closed: false }
    const ego = onPath(first, open, 30, 0, 100)
    const behind = onPath(second, open, 20, 0, 100)
    const traffic = getTrafficState(ego, [behind], open)
    expect(traffic.nearby[0]?.signedDistance).toBeLessThan(0)
    expect(traffic.ahead).toBeNull()
  })

  it('applies seeded mistakes only through the injected random source', () => {
    const [, ego] = cars()
    if (!ego) throw new Error('Missing AI fixture')
    const base = {
      ...ego,
      ai: {
        ...createAiDriverState(0),
        mistakeRemaining: 0,
      },
    }
    const traffic = getTrafficState(base, [], path.points.length)
    const mistake = stepAiVehicle(
      base,
      path,
      traffic,
      'easy',
      1,
      { next: () => 0 },
    )
    const clean = stepAiVehicle(
      base,
      path,
      traffic,
      'easy',
      1,
      { next: () => 0.99 },
    )

    expect(mistake.ai?.mistakeOffset).not.toBe(0)
    expect(clean.ai?.mistakeOffset).toBe(0)
  })

  it('rejoins its base lane after clearance and starts a cooldown', () => {
    const [, ego] = cars()
    if (!ego) throw new Error('Missing AI fixture')
    const passing = {
      ...ego,
      lane: 20,
      ai: {
        ...createAiDriverState(0),
        phase: 'passing' as const,
        targetLane: 20,
        passLane: 20,
        holdRemaining: 0,
      },
    }
    const cleared = stepAiVehicle(
      passing,
      path,
      getTrafficState(passing, [], path.points.length),
      'normal',
      0.3,
      { next: () => 0.5 },
    )
    expect(cleared.ai).toMatchObject({
      phase: 'rejoin',
      targetLane: 0,
    })

    const centered = { ...cleared, lane: 1 }
    const rejoined = stepAiVehicle(
      centered,
      path,
      getTrafficState(centered, [], path.points.length),
      'normal',
      0.1,
      { next: () => 0.5 },
    )
    expect(rejoined.ai?.phase).toBe('follow')
    expect(rejoined.ai?.cooldownRemaining).toBeGreaterThan(0)
  })
})
