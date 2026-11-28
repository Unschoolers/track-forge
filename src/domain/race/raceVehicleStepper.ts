import type { RandomSource } from '@/domain/race/randomSource'
import { stepAiVehicle, type AiDecisionObserver } from '@/domain/race/ai/aiDriver'
import { getTrafficState } from '@/domain/race/ai/traffic'
import { manualRecoveryTicksRemaining, type DriverInput, type RaceState, type RaceVehicle } from '@/domain/race/raceState'
import { gradeForTravel, getVehicleStepContext, type VehicleStepContext } from '@/domain/race/trackContext'
import { stepVehicle, type SpeedAssist } from '@/domain/race/vehiclePhysics'
import { stepVehicleVerticalDynamics } from '@/domain/race/vehicleVerticalDynamics'
import { findJumpTakeoff } from '@/domain/race/jumpTakeoff'
import { advanceDriftBoost } from '@/domain/race/driftBoost'

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
  observeAiDecision?: AiDecisionObserver,
): RaceVehicle {
  const previousContext = raceVehicleContext(race, vehicle)
  let moved: RaceVehicle
  if (input) {
    const boost = race.driftBoostRules
      ? advanceDriftBoost(vehicle.driftBoost, race.driftBoostRules, {
          angle: vehicle.angle,
          vx: vehicle.vx,
          vy: vehicle.vy,
          onRoad: previousContext.onRoad,
          grounded: vehicle.grounded,
          collision: false,
          recovering: manualRecoveryTicksRemaining(vehicle, race.tick) > 0,
          braking: input.braking,
        }, deltaSeconds, input.boostRequested)
      : undefined
    moved = stepVehicle(
      vehicle,
      input,
      previousContext,
      deltaSeconds,
      undefined,
      undefined,
      boost && race.driftBoostRules
        ? {
            rules: race.driftBoostRules,
            activated: boost.activated,
            active: boost.snapshot.phase === 'active',
            speedCeilingMultiplier: boost.snapshot.phase === 'active'
              ? race.driftBoostRules.speedCeilingMultiplier
              : boost.snapshot.phase === 'returning'
                ? 1 + (race.driftBoostRules.speedCeilingMultiplier - 1) *
                  boost.snapshot.remainingTicks / Math.max(1, Math.ceil(race.driftBoostRules.returnSeconds * 60))
                : 1,
          }
        : undefined,
    )
    if (boost) moved = { ...moved, driftBoost: boost.snapshot }
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
      previousContext,
      observeAiDecision,
    )
  }
  const nextContext = raceVehicleContext(race, moved, previousContext)
  const longitudinalSpeed = Math.abs(
    moved.vx * nextContext.tangent.x +
      moved.vy * nextContext.tangent.y,
  )
  const jumpTakeoff = !race.reversed && previousContext.onRoad && nextContext.onRoad &&
    previousContext.structureRunId !== nextContext.structureRunId
    ? findJumpTakeoff(race.path, vehicle, moved, previousContext.structureRunId)
    : undefined
  const vertical = stepVehicleVerticalDynamics(
    vehicle,
    {
      previousSurfaceHeight: previousContext.surfaceHeight,
      surfaceHeight: nextContext.surfaceHeight,
      grade: gradeForTravel(nextContext.grade, race.reversed),
      longitudinalSpeed,
      previousOverRoad: previousContext.onRoad,
      overRoad: nextContext.onRoad,
      ...(jumpTakeoff ? { jumpTakeoff } : {}),
    },
    deltaSeconds,
  )
  const jumpLaunched = !!jumpTakeoff && !vertical.grounded && vertical.verticalVelocity > 0
  return { ...moved, ...vertical, jumpLaunched, jumpFlight: !vertical.grounded && (jumpLaunched || vehicle.jumpFlight === true) }
}

