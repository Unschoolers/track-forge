import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace, samplePathBehindStart } from '@/domain/race/raceFactory'
import { getTrafficState } from '@/domain/race/ai/traffic'
import { stepAiVehicle } from '@/domain/race/ai/aiDriver'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { stepRace } from '@/domain/race/raceEngine'
import { buildRaceCameraHints } from '@/domain/race/trackContext'

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test fixture')
  return value
}

const track = createStarterTrack(asTrackId('reverse'), 1)
const path = buildRoadPath(track.points, track.terrain)
const race = () =>
  createRace({
    path,
    playerCar: 'blue',
    difficulty: 'normal',
    laps: 3,
    startRatio: 0.35,
    reversed: true,
  })
const angleDiff = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
const reverseAngle = (index: number) => {
  const point = required(path.points[index])
  const ahead = required(
    path.points[(index - 4 + path.points.length) % path.points.length],
  )
  return Math.atan2(ahead.y - point.y, ahead.x - point.x)
}

describe('reverse races', () => {
  it('places grid samples at their actual index and faces the reverse direction', () => {
    const start = race().startPathIndex
    const sample = samplePathBehindStart(path, 110, start, true)
    const nearest = path.points.reduce(
      (best, point, index) =>
        Math.hypot(point.x - sample.x, point.y - sample.y) <
        Math.hypot(
          required(path.points[best]).x - sample.x,
          required(path.points[best]).y - sample.y,
        )
          ? index
          : best,
      0,
    )
    expect(sample.pathIndex).toBe(nearest)
    expect(
      angleDiff(
        Math.atan2(sample.tangent.y, sample.tangent.x),
        reverseAngle(nearest),
      ),
    ).toBeLessThan(0.35)
  })
  it('detects reverse traffic across the wrap boundary in samples and world distance', () => {
    const [ego, rival] = race().vehicles
    const a = { ...required(ego), pathIndex: 3 }
    const b = { ...required(rival), pathIndex: path.points.length - 4 }
    expect(
      getTrafficState(a, [b], path.points.length, true).ahead?.distance,
    ).toBe(7)
    const expected =
      required(path.points[3]).distance +
      path.totalLength -
      required(path.points[b.pathIndex]).distance
    expect(getTrafficState(a, [b], path, true).ahead?.distance).toBeCloseTo(
      expected,
    )
  })
  it.each([
    { reversed: true, egoIndex: 51, rivalIndex: 49 },
    { reversed: false, egoIndex: 49, rivalIndex: 51 },
  ])(
    'detects physical traffic across a relocated lap boundary (reversed: $reversed)',
    ({ reversed, egoIndex, rivalIndex }) => {
      const [ego, rival] = race().vehicles
      const car = { ...required(ego), pathIndex: egoIndex, lap: 0, speed: 100 }
      const ahead = {
        ...required(rival),
        pathIndex: rivalIndex,
        lap: 1,
        speed: 20,
      }
      const gap = Math.abs(
        required(path.points[egoIndex]).distance -
          required(path.points[rivalIndex]).distance,
      )
      const traffic = getTrafficState(car, [ahead], path, reversed)
      expect(traffic.ahead?.distance).toBeCloseTo(gap)
      expect(traffic.ahead?.timeToCollision).toBeCloseTo(gap / 80)
    },
  )
  it('pursues decreasing indices when already aligned for reverse travel', () => {
    const index = race().startPathIndex
    const point = required(path.points[index])
    const car = {
      ...required(race().vehicles[1]),
      x: point.x,
      y: point.y,
      pathIndex: index,
      angle: reverseAngle(index),
      lane: 0,
      ai: createAiDriverState(0),
    }
    const stepped = stepAiVehicle(
      car,
      path,
      getTrafficState(car, [], path),
      'normal',
      0.2,
      { next: () => 0.5 },
      true,
    )
    expect(Math.abs(required(stepped.ai).steer)).toBeLessThan(0.4)
  })
  it('faces reverse after automatic player and off-road AI recovery', () => {
    const base = race()
    const player = { ...required(base.vehicles[0]), stuckDuration: 0.7 }
    const ai = {
      ...required(base.vehicles[1]),
      x: required(base.vehicles[1]).x + 250,
      y: required(base.vehicles[1]).y + 250,
    }
    const result = stepRace(
      { ...base, phase: 'running', elapsed: 2, vehicles: [player, ai] },
      { steering: 0, throttle: 1, braking: false },
      0.05,
      { next: () => 0.5 },
    ).state
    for (const car of result.vehicles)
      expect(angleDiff(car.angle, reverseAngle(car.pathIndex))).toBeLessThan(
        0.01,
      )
  })
  it('looks along reverse travel at a relocated start', () => {
    const base = race()
    const player = required(base.vehicles[0])
    const hints = buildRaceCameraHints(path, player, true)
    expect(
      angleDiff(hints.roadAngle, reverseAngle(player.pathIndex)),
    ).toBeLessThan(0.35)
    expect(
      (hints.target.x - player.x) * Math.cos(hints.roadAngle) +
        (hints.target.y - player.y) * Math.sin(hints.roadAngle),
    ).toBeGreaterThan(0)
    const stepped = stepRace(
      { ...base, phase: 'running', vehicles: [player] },
      { steering: 0, throttle: 0, braking: false },
      0.05,
      { next: () => 0.5 },
    ).state
    expect(
      angleDiff(
        stepped.cameraHints.roadAngle,
        reverseAngle(required(stepped.vehicles[0]).pathIndex),
      ),
    ).toBeLessThan(0.35)
  })
})
