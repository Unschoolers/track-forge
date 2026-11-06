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
    previousGrade: 0.18,
    grade: 0,
    longitudinalSpeed: 40,
    previousOverRoad: true,
    overRoad: true,
    ...overrides,
  }
}

describe('vehicle vertical dynamics', () => {
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

  it('launches from the same crest at high speed', () => {
    const result = stepVehicleVerticalDynamics(
      groundedAt(9.8),
      environment({ longitudinalSpeed: 250 }),
      1 / 60,
    )

    expect(result.grounded).toBe(false)
    expect(result.z).toBeGreaterThanOrEqual(10)
    expect(result.verticalVelocity).toBeGreaterThan(20)
    expect(result.contactLoad).toBe(0)
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
        previousGrade: 0,
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
        previousGrade: 0,
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
        previousGrade: 0.38, grade: 0.35, longitudinalSpeed: 200,
      }),
      1 / 60,
    )
    expect(result.z).toBe(16)
    expect(result.grounded).toBe(true)
    expect(result.contactLoad).toBeGreaterThan(0)
  })

  it('preserves deck height and becomes airborne after losing lateral support', () => {
    const departed = stepVehicleVerticalDynamics(
      groundedAt(24),
      environment({
        previousSurfaceHeight: 24,
        surfaceHeight: 0,
        previousGrade: 0,
        grade: 0,
        longitudinalSpeed: 0,
        previousOverRoad: true,
        overRoad: false,
      }),
      1 / 60,
    )

    expect(departed.grounded).toBe(false)
    expect(departed.z).toBe(24)

    let state = departed
    for (let step = 0; step < 180 && !state.grounded; step += 1) {
      state = stepVehicleVerticalDynamics(
        state,
        environment({
          previousSurfaceHeight: 0,
          surfaceHeight: 0,
          previousGrade: 0,
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
        previousGrade: Number.NaN,
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

  it('turns a real eased bridge crest into a speed-dependent jump', () => {
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
      let previousIndex = reversed ? path.points.length - 1 : 0
      let previousHeight = path.roadSurface.at(previousIndex).height
      let state = groundedAt(previousHeight)
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
        const height = path.roadSurface.at(index).height
        state = stepVehicleVerticalDynamics(
          state,
          {
            previousSurfaceHeight: previousHeight,
            surfaceHeight: height,
            previousGrade: gradeForTravel(
              path.roadSurface.gradeAt(previousIndex),
              reversed,
            ),
            grade: gradeForTravel(
              path.roadSurface.gradeAt(index),
              reversed,
            ),
            longitudinalSpeed: speed,
            previousOverRoad: true,
            overRoad: true,
          },
          1 / 60,
        )
        if (!state.grounded) return true
        previousIndex = index
        previousHeight = height
      }
      return false
    }

    expect(simulate(55)).toBe(false)
    expect(simulate(240)).toBe(true)
    expect(simulate(55, true)).toBe(false)
    expect(simulate(240, true)).toBe(true)

    const rampIndex = path.points.findIndex(
      (_, index) => path.roadSurface.gradeAt(index) > 0.01,
    )
    const canonicalGrade = path.roadSurface.gradeAt(rampIndex)
    expect(gradeForTravel(canonicalGrade, false)).toBe(canonicalGrade)
    expect(gradeForTravel(canonicalGrade, true)).toBe(-canonicalGrade)
  })
})
