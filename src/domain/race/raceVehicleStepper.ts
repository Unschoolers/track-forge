import type { RandomSource } from '@/domain/race/randomSource'
import { stepAiVehicle } from '@/domain/race/ai/aiDriver'
import { getTrafficState } from '@/domain/race/ai/traffic'
import type { DriverInput, RaceState, RaceVehicle } from '@/domain/race/raceState'
import { gradeForTravel, getVehicleStepContext, type VehicleStepContext } from '@/domain/race/trackContext'
import { stepVehicle, type SpeedAssist } from '@/domain/race/vehiclePhysics'
import { stepVehicleVerticalDynamics } from '@/domain/race/vehicleVerticalDynamics'

export const PLAYER_ROUTE_WINDOW = 12

export function raceVehicleContext(race: RaceState, vehicle: RaceVehicle, previous?: VehicleStepContext) {
  // A car moves only a few samples per step. Keep the player on its current
  // road when a nearby return arm is closer; off-road reacquisition remains
  // available for closed circuits in getVehicleStepContext.
  const radius = race.routeKind === 'point-to-point' || vehicle.player ? PLAYER_ROUTE_WINDOW : undefined
  return getVehicleStepContext(race.path, vehicle, previous, radius)
}

export function advanceVehicle(
  vehicle: RaceVehicle,
  race: RaceState,
  input: DriverInput | undefined,
  deltaSeconds: number,
  random: RandomSource,
  catchUp: SpeedAssist | undefined,
): RaceVehicle {
  const previousContext = raceVehicleContext(race, vehicle)
  let moved: RaceVehicle
  if (input) {
    moved = stepVehicle(
      vehicle,
      input,
      previousContext,
      deltaSeconds,
    )
  } else {
    moved = stepAiVehicle(
      vehicle,
      race.path,
      getTrafficState(vehicle, race.vehicles, race.path, race.reversed),
      race.difficulty,
      deltaSeconds,
      random,
      race.reversed,
      race.aiVehicleSpeedLimits?.[vehicle.id] ?? Number.POSITIVE_INFINITY,
      catchUp,
      race.aiProfileOverrides?.[vehicle.car],
      race.aiPassingPolicyOverrides?.[vehicle.car],
      race.aiAiTrafficMode,
    )
  }
  const nextContext = raceVehicleContext(race, moved, previousContext)
  const longitudinalSpeed = Math.abs(
    moved.vx * nextContext.tangent.x +
      moved.vy * nextContext.tangent.y,
  )
  const vertical = stepVehicleVerticalDynamics(
    vehicle,
    {
      previousSurfaceHeight: previousContext.surfaceHeight,
      surfaceHeight: nextContext.surfaceHeight,
      grade: gradeForTravel(nextContext.grade, race.reversed),
      longitudinalSpeed,
      previousOverRoad: previousContext.onRoad,
      overRoad: nextContext.onRoad,
    },
    deltaSeconds,
  )
  return { ...moved, ...vertical }
}

