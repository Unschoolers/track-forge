import { describe, expect, it, vi } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import * as arcadePlanner from '@/domain/race/arcadeSpeedPlanner'
import {
  getVehicleStepContext,
  resetVehicleToTrack,
} from '@/domain/race/trackContext'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { validateTrack } from '@/domain/track/trackValidation'

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test fixture')
  return value
}

// A race-ready route with two crossing branches only 73 path samples apart.
const points = [
  { x: -84, y: -70, surface: 'street' },
  { x: 84, y: 70, surface: 'street' },
  { x: -84, y: 70, surface: 'street', structure: 'overpass' },
  { x: 84, y: -70, surface: 'street' },
  { x: 300, y: -70, surface: 'street' },
  { x: 300, y: -300, surface: 'street' },
  { x: -300, y: -300, surface: 'street' },
  { x: -300, y: -70, surface: 'street' },
  { x: -84, y: -70, surface: 'street' },
] as const
const path = buildRoadPath(points, EMPTY_TERRAIN)
const crossing = required(path.crossings.find(({ key }) => key === '0:2'))
const noInput = { steering: 0, throttle: 0, braking: false }
const random = { next: () => 0.99 }

function raceAtCrossing(lane: number, reversed: boolean) {
  const direction = reversed ? -1 : 1
  const index = crossing.firstPathIndex - direction * 10
  const point = required(path.points[index])
  const next = required(path.points[index + direction])
  const length = Math.hypot(next.x - point.x, next.y - point.y)
  const tx = (next.x - point.x) / length
  const ty = (next.y - point.y) / length
  const base = createRace({
    path,
    playerCar: 'blue',
    difficulty: 'normal',
    laps: 3,
    reversed,
  })
  const vehicle = {
    ...required(base.vehicles[0]),
    x: point.x - ty * lane,
    y: point.y + tx * lane,
    angle: Math.atan2(ty, tx),
    vx: tx * 120,
    vy: ty * 120,
    speed: 120,
    pathIndex: index,
    z: 0,
    grounded: true,
    verticalVelocity: 0,
    contactLoad: 1,
  }
  return {
    ...base,
    vehicles: [vehicle],
    phase: 'running' as const,
    countdown: 0,
  }
}

describe('road branch continuity', () => {
  it('keeps an Arcade player and its plan on the followed arm of a narrow hairpin', () => {
    const hairpin = buildRoadPath([
      { x: 0, y: 0, surface: 'street' },
      { x: 200, y: 0, surface: 'street' },
      { x: 200, y: 20, surface: 'street' },
      { x: 0, y: 20, surface: 'street' },
    ], EMPTY_TERRAIN)
    const index = hairpin.points.findIndex((point) => point.segment === 0 && point.x > 100)
    const point = required(hairpin.points[index])
    const base = createRace({ path: hairpin, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    let race = {
      ...base,
      handling: 'arcade' as const,
      phase: 'running' as const,
      vehicles: [{ ...required(base.vehicles[0]), x: point.x, y: 15, angle: 0,
        vx: 60, vy: 0, speed: 60, pathIndex: index }],
    }
    const plan = vi.spyOn(arcadePlanner, 'planArcadeSpeed')
    try {
      for (let frame = 0; frame < 20; frame += 1) {
        race = stepRace(race, noInput, 1 / 60, random).state as typeof race
        const current = required(race.vehicles[0])
        const plannedIndex = required(plan.mock.calls.at(-1))[1]
        expect(required(hairpin.points[current.pathIndex]).segment, `frame ${frame}`).toBe(0)
        expect(required(hairpin.points[plannedIndex]).segment, `plan frame ${frame}`).toBe(0)
      }
    } finally {
      plan.mockRestore()
    }
  })

  it('uses the race-ready crossing where both branches lie in the local search window', () => {
    expect(
      validateTrack(
        {
          id: asTrackId('crossing-regression'),
          name: 'Crossing regression',
          version: 8,
          points,
          trees: [],
          terrain: EMPTY_TERRAIN,
          lighting: 'day',
          createdAt: 1,
          updatedAt: 1,
        },
        path.totalLength,
      ).ready,
    ).toBe(true)
    expect(path.totalLength).toBeCloseTo(2164, -1)
    expect(crossing.firstPathIndex).toBe(16)
    expect(crossing.secondPathIndex).toBe(89)
  })

  it.each([false, true])(
    'keeps the lower road and height across lanes while driving (reversed: %s)',
    (reversed) => {
      for (const lane of [-20, -10, 0, 10, 20]) {
        let race = raceAtCrossing(lane, reversed)
        for (let frame = 0; frame < 45; frame += 1) {
          race = stepRace(race, noInput, 1 / 60, random).state as typeof race
          const vehicle = required(race.vehicles[0])
          const context = getVehicleStepContext(path, vehicle)
          expect(
            context.nearest.point.segment,
            `lane ${lane}, frame ${frame}`,
          ).toBe(0)
          expect(context.onRoad, `lane ${lane}, frame ${frame}`).toBe(true)
          expect(vehicle.z, `lane ${lane}, frame ${frame}`).toBeCloseTo(0)
          expect(vehicle.grounded, `lane ${lane}, frame ${frame}`).toBe(true)
          expect(vehicle.lap, `lane ${lane}, frame ${frame}`).toBe(0)
          expect(vehicle.nextSector, `lane ${lane}, frame ${frame}`).toBe(1)
        }
        const direction = reversed ? -1 : 1
        expect(
          direction *
            (required(race.vehicles[0]).pathIndex - crossing.firstPathIndex),
        ).toBeGreaterThan(0)
      }
    },
  )

  it('retains either road when the other crossing branch is closer in 2D', () => {
    const lower = required(path.points[crossing.firstPathIndex])
    const upper = required(path.points[crossing.secondPathIndex])
    const lowerContext = getVehicleStepContext(path, {
      x: upper.x,
      y: upper.y,
      z: 0,
      pathIndex: crossing.firstPathIndex,
    })
    const upperContext = getVehicleStepContext(path, {
      x: lower.x,
      y: lower.y,
      z: 24,
      pathIndex: crossing.secondPathIndex,
    })

    expect(lowerContext.nearest.point.segment).toBe(0)
    expect(lowerContext.surfaceHeight).toBeCloseTo(0)
    expect(upperContext.nearest.point.segment).toBe(2)
    expect(upperContext.surfaceHeight).toBeCloseTo(24)
  })

  it('keeps its route through a same-level crossing when the other arm is closer', () => {
    const flat = buildRoadPath(
      points.map((point) => ({ ...point, structure: 'surface' as const })),
      EMPTY_TERRAIN,
    )
    const flatCrossing = required(
      flat.crossings.find(({ key }) => key === '0:2'),
    )
    const lower = required(flat.points[flatCrossing.firstPathIndex])
    const other = required(flat.points[flatCrossing.secondPathIndex])
    const first = getVehicleStepContext(flat, {
      x: other.x,
      y: other.y,
      z: 0,
      pathIndex: flatCrossing.firstPathIndex,
    })
    const second = getVehicleStepContext(flat, {
      x: lower.x,
      y: lower.y,
      z: 0,
      pathIndex: flatCrossing.secondPathIndex,
    })

    expect(first.nearest.point.segment).toBe(0)
    expect(second.nearest.point.segment).toBe(2)
  })

  it.each([false, true])(
    'tracks an inside lane around a close hairpin with small steps (reversed: %s)',
    (reversed) => {
      const hairpin = buildRoadPath(
        [
          { x: 0, y: 0, surface: 'street' },
          { x: 600, y: 0, surface: 'street' },
          { x: 600, y: 50, surface: 'street' },
          { x: 0, y: 50, surface: 'street' },
          { x: -300, y: 50, surface: 'street' },
          { x: -300, y: -150, surface: 'street' },
          { x: -300, y: -300, surface: 'street' },
          { x: 0, y: -300, surface: 'street' },
          { x: 0, y: 0, surface: 'street' },
        ],
        EMPTY_TERRAIN,
      )
      const count = hairpin.points.length
      const lanePoint = (index: number) => {
        const point = required(hairpin.points[index])
        const before = required(hairpin.points[(index + count - 1) % count])
        const after = required(hairpin.points[(index + 1) % count])
        const length = Math.hypot(after.x - before.x, after.y - before.y)
        return {
          x: point.x - ((after.y - before.y) / length) * 20,
          y: point.y + ((after.x - before.x) / length) * 20,
        }
      }
      const direction = reversed ? -1 : 1
      const start = reversed ? 180 : 0
      const end = reversed ? 0 : 180
      let previousIndex = start
      let previousPosition = lanePoint(start)
      let maximumStep = 0
      for (
        let index = start + direction;
        reversed ? index >= end : index <= end;
        index += direction
      ) {
        const from = lanePoint(index - direction)
        const to = lanePoint(index)
        for (let step = 1; step <= 4; step += 1) {
          const position = {
            x: from.x + ((to.x - from.x) * step) / 4,
            y: from.y + ((to.y - from.y) * step) / 4,
          }
          maximumStep = Math.max(
            maximumStep,
            Math.hypot(
              position.x - previousPosition.x,
              position.y - previousPosition.y,
            ),
          )
          previousPosition = position
          const context = getVehicleStepContext(hairpin, {
            ...position,
            z: 0,
            pathIndex: previousIndex,
          })
          previousIndex = context.nearest.index
          expect(context.onRoad).toBe(true)
        }
        if (index === 95 || index === 115 || index === 150) {
          expect(previousIndex, `sample ${index}`).toBeGreaterThanOrEqual(
            index - 2,
          )
          expect(previousIndex, `sample ${index}`).toBeLessThanOrEqual(
            index + 2,
          )
          expect(
            required(hairpin.points[previousIndex]).segment,
            `sample ${index}`,
          ).toBe(required(hairpin.points[index]).segment)
        }
      }
      expect(maximumStep).toBeLessThan(2.31)
      expect(previousIndex).toBe(end)
    },
  )

  it('retains the lower road at a closely spaced crossing', () => {
    const closePath = buildRoadPath(
      [
        { x: -28, y: -28, surface: 'street' },
        { x: 28, y: 28, surface: 'street' },
        { x: -28, y: 28, surface: 'street', structure: 'overpass' },
        { x: 28, y: -28, surface: 'street' },
        { x: 300, y: -28, surface: 'street' },
        { x: 300, y: -300, surface: 'street' },
        { x: -300, y: -300, surface: 'street' },
        { x: -300, y: -28, surface: 'street' },
        { x: -28, y: -28, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    const closeCrossing = required(
      closePath.crossings.find(({ key }) => key === '0:2'),
    )
    expect(closeCrossing.secondPathIndex - closeCrossing.firstPathIndex).toBe(
      26,
    )
    const upper = required(closePath.points[closeCrossing.secondPathIndex])
    const context = getVehicleStepContext(closePath, {
      x: upper.x,
      y: upper.y,
      z: 0,
      pathIndex: closeCrossing.firstPathIndex,
    })

    expect(context.onRoad).toBe(true)
    expect(context.nearest.point.segment).toBe(0)
    expect(context.surfaceHeight).toBe(0)
  })

  it.each([false, true])(
    'retains the raised deck across the crossing while driving (reversed: %s)',
    (reversed) => {
      const direction = reversed ? -1 : 1
      const index = crossing.secondPathIndex - direction * 4
      const point = required(path.points[index])
      const next = required(path.points[index + direction])
      const length = Math.hypot(next.x - point.x, next.y - point.y)
      const tx = (next.x - point.x) / length
      const ty = (next.y - point.y) / length
      for (const lane of [-10, 0, 10]) {
        const position = { x: point.x - ty * lane, y: point.y + tx * lane }
        const surface = path.roadSurface.at(index, position)
        const base = createRace({
          path,
          playerCar: 'blue',
          difficulty: 'normal',
          laps: 3,
          reversed,
        })
        let race = {
          ...base,
          phase: 'running' as const,
          countdown: 0,
          vehicles: [
            {
              ...required(base.vehicles[0]),
              ...position,
              angle: Math.atan2(ty, tx),
              vx: tx * 40,
              vy: ty * 40,
              speed: 40,
              pathIndex: index,
              z: surface.height,
              structureRunId: surface.structureRunId,
              grounded: true,
              verticalVelocity: 0,
              contactLoad: 1,
            },
          ],
        }
        for (let frame = 0; frame < 60; frame += 1) {
          race = stepRace(race, noInput, 1 / 60, random).state as typeof race
          const vehicle = required(race.vehicles[0])
          const context = getVehicleStepContext(path, vehicle)
          expect(
            context.nearest.point.segment,
            `lane ${lane}, frame ${frame}`,
          ).toBe(2)
          expect(context.onRoad, `lane ${lane}, frame ${frame}`).toBe(true)
          expect(vehicle.z, `lane ${lane}, frame ${frame}`).toBeGreaterThan(15)
          expect(vehicle.grounded, `lane ${lane}, frame ${frame}`).toBe(true)
        }
        expect(
          direction *
            (required(race.vehicles[0]).pathIndex - crossing.secondPathIndex),
        ).toBeGreaterThan(0)
      }
    },
  )

  it.each([
    { level: 'lower', z: 0, targetIndex: crossing.secondPathIndex, segment: 0 },
    { level: 'deck', z: 24, targetIndex: crossing.firstPathIndex, segment: 2 },
  ])(
    'reacquires the $level road at a crossing from a distant route position',
    ({ z, targetIndex, segment }) => {
      const target = required(path.points[targetIndex])
      const context = getVehicleStepContext(path, {
        x: target.x,
        y: target.y,
        z,
        pathIndex: 180,
      })

      expect(context.onRoad).toBe(true)
      expect(context.nearest.point.segment).toBe(segment)
      expect(context.surfaceHeight).toBeCloseTo(z)
    },
  )

  it('finds the lower branch when the route position still points at the deck', () => {
    const lower = required(path.points[crossing.firstPathIndex])
    const context = getVehicleStepContext(path, {
      x: lower.x,
      y: lower.y,
      z: 0,
      pathIndex: crossing.secondPathIndex,
    })

    expect(context.onRoad).toBe(true)
    expect(context.nearest.point.segment).toBe(0)
    expect(context.surfaceHeight).toBe(0)
  })

  it('uses ground support below a deck when there is no lower road', () => {
    const bridge = buildRoadPath(
      [
        { x: 0, y: 0, surface: 'street', structure: 'overpass' },
        { x: 500, y: 0, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    const index = bridge.points.findIndex((point) => point.x > 240)
    const point = required(bridge.points[index])
    const context = getVehicleStepContext(bridge, {
      ...point,
      z: 0,
      pathIndex: index,
    })

    expect(context.onRoad).toBe(false)
    expect(context.surfaceHeight).toBe(0)
    expect(context.safeAboveWater).toBe(false)
  })

  it('resets an under-deck vehicle onto the elevated road', () => {
    const bridge = buildRoadPath(
      [
        { x: 0, y: 0, surface: 'street', structure: 'overpass' },
        { x: 500, y: 0, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    const index = bridge.points.findIndex((point) => point.x > 240)
    const point = required(bridge.points[index])
    const race = createRace({
      path: bridge,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const reset = resetVehicleToTrack(
      {
        ...required(race.vehicles[0]),
        x: point.x,
        y: point.y,
        z: 0,
        pathIndex: index,
        grounded: true,
      },
      bridge,
    )

    expect(reset.pathIndex).toBe(index)
    expect(reset.z).toBe(24)
    expect(reset.grounded).toBe(true)
  })

  it.each([false, true])(
    'falls below the deck onto terrain or water without snapping upward (water: %s)',
    (water) => {
      const terrain = water
        ? {
            cellSize: 32,
            cells: [{ column: 0, row: 0, kind: 'water' as const }],
          }
        : EMPTY_TERRAIN
      const bridge = buildRoadPath(
        [
          { x: -300, y: 16, surface: 'street', structure: 'overpass' },
          { x: 300, y: 16, surface: 'street' },
        ],
        terrain,
      )
      const index = bridge.points.findIndex((point) => point.x >= 16)
      const point = required(bridge.points[index])
      const base = createRace({
        path: bridge,
        playerCar: 'blue',
        difficulty: 'normal',
        laps: 3,
      })
      let race = {
        ...base,
        phase: 'running' as const,
        countdown: 0,
        vehicles: [
          {
            ...required(base.vehicles[0]),
            x: point.x,
            y: point.y,
            z: 13,
            pathIndex: index,
            grounded: false,
            verticalVelocity: -1,
            vx: 0,
            vy: 0,
            speed: 0,
          },
        ],
      }
      let result = stepRace(race, noInput, 1 / 60, random)
      race = result.state as typeof race
      expect(required(race.vehicles[0]).z).toBeLessThan(13)
      expect(required(race.vehicles[0]).grounded).toBe(false)
      expect(race.phase).toBe('running')
      for (
        let frame = 0;
        frame < 90 && !required(race.vehicles[0]).grounded;
        frame += 1
      ) {
        result = stepRace(race, noInput, 1 / 60, random)
        race = result.state as typeof race
      }
      expect(required(race.vehicles[0]).grounded).toBe(true)
      expect(required(race.vehicles[0]).z).toBe(0)
      expect(race.phase).toBe(water ? 'finished' : 'running')
      if (water)
        expect(result.events).toContainEqual({
          type: 'race-finished',
          reason: 'water',
        })
    },
  )

  it('lands on the deck when falling from above it', () => {
    const bridge = buildRoadPath(
      [
        { x: -300, y: 16, surface: 'street', structure: 'overpass' },
        { x: 300, y: 16, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    const index = bridge.points.findIndex((point) => point.x >= 16)
    const point = required(bridge.points[index])
    const base = createRace({
      path: bridge,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    let race = {
      ...base,
      phase: 'running' as const,
      countdown: 0,
      vehicles: [
        {
          ...required(base.vehicles[0]),
          x: point.x,
          y: point.y,
          z: 25,
          pathIndex: index,
          grounded: false,
          verticalVelocity: -20,
          vx: 0,
          vy: 0,
          speed: 0,
        },
      ],
    }
    for (
      let frame = 0;
      frame < 30 && !required(race.vehicles[0]).grounded;
      frame += 1
    ) {
      race = stepRace(race, noInput, 1 / 60, random).state as typeof race
    }
    expect(required(race.vehicles[0]).grounded).toBe(true)
    expect(required(race.vehicles[0]).z).toBe(24)
  })

  it('does not treat water below a deck as safe support', () => {
    const water = {
      cellSize: 32,
      cells: [{ column: 0, row: 0, kind: 'water' as const }],
    }
    const bridge = buildRoadPath(
      [
        { x: -300, y: 16, surface: 'street', structure: 'overpass' },
        { x: 300, y: 16, surface: 'street' },
      ],
      water,
    )
    const index = bridge.points.findIndex((point) => point.x >= 16)
    const point = required(bridge.points[index])
    const base = createRace({
      path: bridge,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const player = {
      ...required(base.vehicles[0]),
      x: point.x,
      y: point.y,
      z: 0,
      pathIndex: index,
      grounded: true,
      vx: 0,
      vy: 0,
      speed: 0,
    }
    const result = stepRace(
      {
        ...base,
        vehicles: [player],
        phase: 'running',
        countdown: 0,
      },
      noInput,
      1 / 60,
      random,
    )

    expect(result.state.phase).toBe('finished')
    expect(result.events).toContainEqual({
      type: 'race-finished',
      reason: 'water',
    })
  })

  it('keeps the on-road route search bounded', () => {
    const index = 6
    const point = required(path.points[index])
    let pointReads = 0
    const points = new Proxy(path.points, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property))
          pointReads += 1
        return Reflect.get(target, property, receiver)
      },
    })
    const context = getVehicleStepContext(
      { ...path, points },
      {
        x: point.x,
        y: point.y,
        z: 0,
        pathIndex: index,
      },
    )

    expect(context.onRoad).toBe(true)
    expect(pointReads).toBeLessThanOrEqual(165)
  })

  it('reacquires another road after departing the current road footprint', () => {
    const parallel = buildRoadPath(
      [
        { x: 0, y: 0, surface: 'street' },
        { x: 600, y: 0, surface: 'street' },
        { x: 600, y: 60, surface: 'street' },
        { x: 0, y: 60, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    const oldIndex = parallel.points.findIndex((point) => point.x > 280)
    const newIndex = parallel.points.findIndex(
      (point) => point.segment === 2 && point.x < 300,
    )
    const target = required(parallel.points[newIndex])
    const context = getVehicleStepContext(parallel, {
      ...target,
      z: 0,
      pathIndex: oldIndex,
    })

    expect(context.onRoad).toBe(true)
    expect(context.nearest.index).toBe(newIndex)
  })

  it('follows ordinary bridge entry and exit in either travel direction', () => {
    const bridge = buildRoadPath(
      [
        { x: 0, y: 0, surface: 'street' },
        { x: 160, y: 0, surface: 'street', structure: 'overpass' },
        { x: 520, y: 0, surface: 'street' },
        { x: 680, y: 0, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    for (const reversed of [false, true]) {
      let index = reversed ? bridge.points.length - 1 : 0
      let z = 0
      const heights: number[] = []
      for (let step = 0; step < bridge.points.length; step += 1) {
        const target = reversed ? bridge.points.length - 1 - step : step
        const point = required(bridge.points[target])
        const context = getVehicleStepContext(bridge, {
          ...point,
          z,
          pathIndex: index,
        })
        expect(context.onRoad).toBe(true)
        expect(context.nearest.index).toBe(target)
        expect(Math.abs(context.surfaceHeight - z)).toBeLessThan(3)
        z = context.surfaceHeight
        index = context.nearest.index
        heights.push(z)
      }
      expect(Math.max(...heights)).toBe(24)
      expect(heights.at(-1)).toBe(0)
    }
  })

  it('reacquires a distant road after leaving the previous route', () => {
    const targetIndex = 180
    const target = required(path.points[targetIndex])
    const context = getVehicleStepContext(path, {
      x: target.x,
      y: target.y,
      z: 0,
      pathIndex: crossing.firstPathIndex,
    })

    expect(context.onRoad).toBe(true)
    expect(context.nearest.index).toBe(targetIndex)
    expect(context.surfaceHeight).toBe(0)
  })
})
