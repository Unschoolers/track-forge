import { describe, expect, it } from 'vitest'
import {
  stepVehicleVerticalDynamics,
  type VehicleVerticalEnvironment,
  type VehicleVerticalState,
} from '@/domain/race/vehicleVerticalDynamics'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { gradeForTravel } from '@/domain/race/trackContext'

function groundedAt(z: number): VehicleVerticalState {
  return {
    z,
    verticalVelocity: 0,
    grounded: true,
    suspensionCompression: 0,
    landingIntensity: 0,
  }
}

function environment(
  overrides: Partial<VehicleVerticalEnvironment> = {},
): VehicleVerticalEnvironment {
  return {
    previousSurfaceHeight: 9.8,
    surfaceHeight: 10,
    grade: 0,
    longitudinalSpeed: 40,
    previousOverRoad: true,
    overRoad: true,
    ...overrides,
  }
}

describe('vehicle vertical dynamics', () => {
  it('launches from an authored lip even when the landing road remains underneath', () => {
    const launch = (speed: number) => stepVehicleVerticalDynamics(
      { ...groundedAt(23), verticalVelocity: 12 },
      environment({
        previousSurfaceHeight: 23, surfaceHeight: 0,
        longitudinalSpeed: speed, grade: 0,
        jumpTakeoff: { height: 24, grade: 0.3 },
      }),
      1 / 60,
    )

    const slow = launch(60)
    const fast = launch(160)
    expect(slow.z).toBe(24)
    expect(slow.grounded).toBe(false)
    expect(slow.contactLoad).toBe(0)
    expect(slow.verticalVelocity).toBeGreaterThan(0)
    expect(fast.verticalVelocity).toBeGreaterThan(slow.verticalVelocity)

    const fly = (initial: VehicleVerticalState) => {
      let state = initial
      let ticks = 0
      let peak = state.z
      while (!state.grounded && ticks < 600) {
        state = stepVehicleVerticalDynamics(state, environment({
          previousSurfaceHeight: 0, surfaceHeight: 0,
          longitudinalSpeed: 100,
        }), 1 / 60)
        peak = Math.max(peak, state.z)
        ticks += 1
      }
      expect(state.grounded).toBe(true)
      expect(state.z).toBe(0)
      expect(state.landingIntensity).toBeGreaterThan(0)
      return { ticks, peak }
    }

    const slowFlight = fly(slow)
    const fastFlight = fly(fast)
    expect(fastFlight.peak).toBeGreaterThan(slowFlight.peak)
    expect(fastFlight.ticks).toBeGreaterThan(slowFlight.ticks)
  })

  it('does not launch from an unsupported or descending lip', () => {
    const common = {
      previousSurfaceHeight: 24, surfaceHeight: 0,
      longitudinalSpeed: 120, overRoad: false,
    }
    const fall = stepVehicleVerticalDynamics(
      { ...groundedAt(24), verticalVelocity: 30 },
      environment({ ...common, jumpTakeoff: { height: 24, grade: -0.3 } }),
      1 / 60,
    )
    expect(fall.grounded).toBe(false)
    expect(fall.verticalVelocity).toBe(0)

    const unsupported = stepVehicleVerticalDynamics(
      groundedAt(0),
      environment({
        ...common, previousSurfaceHeight: 0, previousOverRoad: false,
        jumpTakeoff: { height: 24, grade: 0.3 },
      }),
      1 / 60,
    )
    expect(unsupported.grounded).toBe(true)
    expect(unsupported.z).toBe(0)
  })

  it('does not relaunch an already airborne car from a repeated lip event', () => {
    const result = stepVehicleVerticalDynamics(
      { ...groundedAt(26), grounded: false, verticalVelocity: 10 },
      environment({
        previousSurfaceHeight: 0, surfaceHeight: 0, longitudinalSpeed: 200,
        jumpTakeoff: { height: 24, grade: 0.3 },
      }),
      1 / 60,
    )
    expect(result.grounded).toBe(false)
    expect(result.verticalVelocity).toBeLessThan(10)
  })

  it('absorbs a crest at low speed as suspension movement', () => {
    const result = stepVehicleVerticalDynamics(
      groundedAt(9.8),
      environment(),
      1 / 60,
    )

    expect(result.grounded).toBe(true)
    expect(result.z).toBeCloseTo(10)
    expect(result.suspensionCompression).toBeGreaterThan(0)
    expect(result.contactLoad).toBeGreaterThan(1)
  })

  it('follows the crest at high speed with the tires still loaded', () => {
    const result = stepVehicleVerticalDynamics(
      { ...groundedAt(9.8), verticalVelocity: 42 },
      environment({ longitudinalSpeed: 250 }),
      1 / 60,
    )

    expect(result.grounded).toBe(true)
    expect(result.z).toBe(10)
    expect(result.contactLoad).toBeGreaterThan(0)
  })

  it('applies gravity throughout an airborne arc', () => {
    const result = stepVehicleVerticalDynamics(
      {
        ...groundedAt(14),
        grounded: false,
        verticalVelocity: 18,
      },
      environment({
        previousSurfaceHeight: 0,
        surfaceHeight: 0,
        grade: 0,
        overRoad: false,
      }),
      0.1,
    )

    expect(result.grounded).toBe(false)
    expect(result.verticalVelocity).toBeLessThan(18)
    expect(result.z).toBeGreaterThan(14)
    expect(result.contactLoad).toBe(0)
  })

  it('lands on the receiving surface and reports the impact', () => {
    const result = stepVehicleVerticalDynamics(
      {
        ...groundedAt(0.25),
        grounded: false,
        verticalVelocity: -18,
      },
      environment({
        previousSurfaceHeight: 0,
        surfaceHeight: 0,
        grade: 0,
        overRoad: false,
      }),
      1 / 30,
    )

    expect(result.grounded).toBe(true)
    expect(result.z).toBe(0)
    expect(result.verticalVelocity).toBe(0)
    expect(result.landingIntensity).toBeGreaterThan(0)
    expect(result.contactLoad).toBeGreaterThan(1)
  })

  it('catches an ascending car when its continuing ramp rises into its flight', () => {
    const result = stepVehicleVerticalDynamics(
      { ...groundedAt(14), grounded: false, verticalVelocity: 10 },
      environment({
        previousSurfaceHeight: 14, surfaceHeight: 16,
        grade: 0.35, longitudinalSpeed: 200,
      }),
      1 / 60,
    )
    expect(result.z).toBe(16)
    expect(result.grounded).toBe(true)
    expect(result.contactLoad).toBeGreaterThan(0)
  })

  it.each([0, 30, -30])('falls after losing lateral support with vertical speed %s', (verticalVelocity) => {
    const departed = stepVehicleVerticalDynamics(
      { ...groundedAt(24), verticalVelocity },
      environment({
        previousSurfaceHeight: 24,
        surfaceHeight: 0,
        grade: 0,
        longitudinalSpeed: 0,
        previousOverRoad: true,
        overRoad: false,
      }),
      1 / 60,
    )

    expect(departed.grounded).toBe(false)
    expect(departed.z).toBe(24)
    expect(departed.verticalVelocity).toBe(Math.min(0, verticalVelocity))

    let state = departed
    for (let step = 0; step < 180 && !state.grounded; step += 1) {
      state = stepVehicleVerticalDynamics(
        state,
        environment({
          previousSurfaceHeight: 0,
          surfaceHeight: 0,
          grade: 0,
          previousOverRoad: false,
          overRoad: false,
        }),
        1 / 60,
      )
    }

    expect(state.grounded).toBe(true)
    expect(state.z).toBe(0)
  })

  it('normalizes invalid state and environment values', () => {
    const result = stepVehicleVerticalDynamics(
      {
        z: Number.NaN,
        verticalVelocity: Number.POSITIVE_INFINITY,
        grounded: true,
        suspensionCompression: Number.NaN,
        landingIntensity: Number.NaN,
      },
      environment({
        previousSurfaceHeight: Number.NaN,
        surfaceHeight: Number.NaN,
        grade: Number.NaN,
        longitudinalSpeed: Number.NaN,
      }),
      Number.NaN,
    )

    expect(Object.values(result).every((value) =>
      typeof value === 'boolean' || Number.isFinite(value),
    )).toBe(true)
    expect(result.z).toBeGreaterThanOrEqual(0)
    expect(result.contactLoad).toBeGreaterThanOrEqual(0)
  })

  it('follows an eased bridge profile in both directions over a range of speeds', () => {
    const path = buildRoadPath(
      [
        { x: 0, y: 0, surface: 'street', structure: 'surface' },
        { x: 160, y: 0, surface: 'street', structure: 'overpass' },
        { x: 520, y: 0, surface: 'street', structure: 'overpass' },
        { x: 680, y: 0, surface: 'street', structure: 'surface' },
        { x: 840, y: 0, surface: 'street', structure: 'surface' },
      ],
      EMPTY_TERRAIN,
    )

    const simulate = (speed: number, reversed = false): boolean => {
      const startIndex = reversed ? path.points.length - 1 : 0
      let previousSurface = path.roadSurface.at(startIndex)
      let state = groundedAt(previousSurface.height)
      let distance = reversed ? path.totalLength : 0
      for (
        ;
        reversed ? distance > 0 : distance < path.totalLength;
      ) {
        distance = reversed
          ? Math.max(0, distance - speed / 60)
          : Math.min(path.totalLength, distance + speed / 60)
        const foundIndex = reversed
          ? path.points.findLastIndex((point) => point.distance <= distance)
          : path.points.findIndex((point) => point.distance >= distance)
        const index = foundIndex < 0
          ? reversed
            ? 0
            : path.points.length - 1
          : foundIndex
        if (index < 0) break
        const surface = path.roadSurface.at(index, { x: distance, y: 0 })
        state = stepVehicleVerticalDynamics(
          state,
          {
            previousSurfaceHeight: previousSurface.height,
            surfaceHeight: surface.height,
            grade: gradeForTravel(surface.grade, reversed),
            longitudinalSpeed: speed,
            previousOverRoad: true,
            overRoad: true,
          },
          1 / 60,
        )
        if (!state.grounded) return true
        previousSurface = surface
      }
      return false
    }

    expect(simulate(55)).toBe(false)
    expect(simulate(240)).toBe(false)
    expect(simulate(55, true)).toBe(false)
    expect(simulate(240, true)).toBe(false)

    const rampIndex = path.points.findIndex(
      (_, index) => path.roadSurface.gradeAt(index) > 0.01,
    )
    const canonicalGrade = path.roadSurface.gradeAt(rampIndex)
    expect(gradeForTravel(canonicalGrade, false)).toBe(canonicalGrade)
    expect(gradeForTravel(canonicalGrade, true)).toBe(-canonicalGrade)
  })
})
