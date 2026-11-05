import type { RandomSource } from '@/application/ports/random'
import { stepAiVehicle } from '@/domain/race/ai/aiDriver'
import { getTrafficState } from '@/domain/race/ai/traffic'
import { solveCollisionFrame } from '@/domain/race/collisions'
import { updateProgress } from '@/domain/race/progress'
import type {
  DriverInput,
  RaceOutcome,
  RaceState,
  RaceVehicle,
} from '@/domain/race/raceState'
import {
  buildRaceCameraHints,
  findNearestSafeTrackIndex,
  gradeForTravel,
  getVehicleStepContext,
  reconcileSupportAfterCollision,
  resetVehicleToTrack,
} from '@/domain/race/trackContext'
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { advanceRaceEffects } from '@/domain/race/effects'
import { solveBridgeBarrierFrame } from '@/domain/race/bridgeBarriers'
import { ROAD_GEOMETRY } from '@/domain/config'
import { stepVehicleVerticalDynamics } from '@/domain/race/vehicleVerticalDynamics'
import { hasVehicleWaterContact } from '@/domain/track/waterExposure'
import { advanceArcadeBoost } from '@/domain/race/arcadeBoost'

export type RaceEvent =
  | {
      readonly type: 'surface-changed'
      readonly vehicleId: string
      readonly surface: RaceVehicle['currentSurface']
    }
  | {
      readonly type: 'curb-hit'
      readonly vehicleId: string
      readonly speed: number
    }
  | {
      readonly type: 'collision'
      readonly leftId: string
      readonly rightId: string
      readonly strength: number
    }
  | {
      readonly type: 'barrier-collision'
      readonly vehicleId: string
      readonly strength: number
    }
  | {
      readonly type: 'vehicle-finished'
      readonly vehicleId: string
      readonly time: number
    }
  | { readonly type: 'vehicle-wrecked'; readonly vehicleId: string }
  | { readonly type: 'boost-activated' }
  | {
      readonly type: 'race-finished'
      readonly reason: RaceOutcome
    }

export interface RaceStepResult {
  readonly state: RaceState
  readonly events: readonly RaceEvent[]
}

export type RaceStep = (
  state: RaceState,
  input: DriverInput,
  deltaSeconds: number,
  random: RandomSource,
) => RaceStepResult

function advanceVehicle(
  vehicle: RaceVehicle,
  race: RaceState,
  input: DriverInput,
  deltaSeconds: number,
  random: RandomSource,
): RaceVehicle {
  const previousContext = getVehicleStepContext(race.path, vehicle)
  let moved: RaceVehicle
  if (vehicle.player) {
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
    )
  }
  const nextContext = getVehicleStepContext(race.path, moved)
  const longitudinalSpeed = Math.abs(
    moved.vx * nextContext.tangent.x +
      moved.vy * nextContext.tangent.y,
  )
  const vertical = stepVehicleVerticalDynamics(
    vehicle,
    {
      previousSurfaceHeight: previousContext.surfaceHeight,
      surfaceHeight: nextContext.surfaceHeight,
      previousGrade: gradeForTravel(previousContext.grade, race.reversed),
      grade: gradeForTravel(nextContext.grade, race.reversed),
      longitudinalSpeed,
      previousOverRoad: previousContext.onRoad,
      overRoad: nextContext.onRoad,
    },
    deltaSeconds,
  )
  return { ...moved, ...vertical }
}

export const stepRace: RaceStep = (
  state,
  input,
  deltaSeconds,
  random,
) => {
  if (state.phase !== 'running' || state.paused || deltaSeconds <= 0) {
    return { state, events: [] }
  }
  const dt = Math.min(0.05, deltaSeconds)
  const elapsed = state.elapsed + dt
  const events: RaceEvent[] = []
  const arcade = !('handling' in state) || state.handling !== 'simulation'
  const boosting = arcade && (state.boostRemaining ?? 0) > 0
  const moved = state.vehicles.map((vehicle) => {
    const advanced = advanceVehicle(vehicle, state, input, dt, random)
    // Braking must retain full authority, even during an earned boost.
    if (!vehicle.player || !boosting || input.braking || !advanced.grounded || advanced.wrecked) return advanced
    const push = 180 * dt
    const vx = advanced.vx + Math.cos(advanced.angle) * push
    const vy = advanced.vy + Math.sin(advanced.angle) * push
    return { ...advanced, vx, vy, speed: Math.hypot(vx, vy) }
  })
  const barrierFrame = solveBridgeBarrierFrame(
    state.vehicles,
    moved,
    state.path,
    state.activeContacts,
  )
  for (const event of barrierFrame.events) {
    events.push({
      type: 'barrier-collision',
      vehicleId: event.vehicleId,
      strength: event.strength,
    })
  }
  const progressed = barrierFrame.vehicles.map((vehicle, index) => {
    const context = getVehicleStepContext(state.path, vehicle)
    const previous = state.vehicles[index]
    const stuckDuration =
      vehicle.player &&
      elapsed > 1.1 &&
      vehicle.speed < 13 &&
      input.throttle > 0 &&
      !input.braking &&
      !vehicle.wrecked
        ? vehicle.stuckDuration + dt
        : Math.max(0, vehicle.stuckDuration - dt * 2.5)
    let updated = updateProgress(
      {
        ...vehicle,
        lane:
          (vehicle.x - context.nearest.point.x) * context.normal.x +
          (vehicle.y - context.nearest.point.y) * context.normal.y,
        currentSurface: context.surface,
        onCurb: context.onCurb,
        pathDistance: context.nearest.point.distance,
        structureRunId: context.structureRunId,
        stuckDuration,
      },
      context.nearest.index,
      state.path.points.length,
      elapsed,
      state.totalLaps,
      state.startPathIndex,
      state.reversed,
    )
    if (updated.player && updated.stuckDuration > 0.65) {
      updated = resetVehicleToTrack(updated, state.path, { reversed: state.reversed })
    }
    if (
      !updated.player &&
      context.nearest.distance > ROAD_GEOMETRY.onRoadRadius + 30
    ) {
      // Traffic contact can throw an opponent beyond any recoverable steering
      // arc. Rejoin it at the nearest road sample instead of letting a lost AI
      // circle forever outside the camera.
      if (updated.grounded) {
        updated = resetVehicleToTrack(updated, state.path, { reversed: state.reversed })
      }
    }
    if (previous && previous.currentSurface !== updated.currentSurface) {
      events.push({
        type: 'surface-changed',
        vehicleId: updated.id,
        surface: updated.currentSurface,
      })
    }
    if (previous && !previous.onCurb && updated.onCurb) {
      events.push({
        type: 'curb-hit',
        vehicleId: updated.id,
        speed: updated.speed,
      })
    }
    return updated
  })
  const collisionFrame = solveCollisionFrame(
    progressed,
    state.activeContacts,
    dt,
  )
  let vehicles = collisionFrame.vehicles.map((collided) => {
    const context = getVehicleStepContext(state.path, collided)
    const vehicle = reconcileSupportAfterCollision(collided, context)
    if (vehicle.player) return vehicle
    if (!hasVehicleWaterContact({
      grounded: vehicle.grounded,
      terrainMaterial: context.terrainMaterial,
      safeAboveWater: context.safeAboveWater,
    })) {
      return vehicle
    }
    const pathIndex = findNearestSafeTrackIndex(
      state.path,
      vehicle,
      state.reversed,
    )
    return resetVehicleToTrack(vehicle, state.path, {
      ...(pathIndex === undefined ? {} : { pathIndex }),
      reversed: state.reversed,
    })
  })
  for (const collision of collisionFrame.events) {
    events.push({ type: 'collision', ...collision })
  }
  let player = vehicles.find((vehicle) => vehicle.player)
  const playerContext = player
    ? getVehicleStepContext(state.path, player)
    : undefined
  const playerWaterContact =
    player !== undefined &&
    playerContext !== undefined &&
    hasVehicleWaterContact({
      grounded: player.grounded,
      terrainMaterial: playerContext.terrainMaterial,
      safeAboveWater: playerContext.safeAboveWater,
    })
  if (playerWaterContact) {
    vehicles = vehicles.map((vehicle) =>
      vehicle.player && vehicle.finishedAt !== null
        ? { ...vehicle, finishedAt: null }
        : vehicle,
    )
    player = vehicles.find((vehicle) => vehicle.player)
  }
  for (const [index, vehicle] of vehicles.entries()) {
    const previous = state.vehicles[index]
    if (!previous) continue
    if (previous.finishedAt === null && vehicle.finishedAt !== null) {
      events.push({
        type: 'vehicle-finished',
        vehicleId: vehicle.id,
        time: vehicle.finishedAt,
      })
    }
    if (!previous.wrecked && vehicle.wrecked) {
      events.push({ type: 'vehicle-wrecked', vehicleId: vehicle.id })
    }
  }
  const impactShake = Math.min(
    6,
    Math.max(
      0,
      ...collisionFrame.events.map(({ strength }) => strength / 18),
      (player?.landingIntensity ?? 0) * 4.5,
    ),
  )
  const boost = advanceArcadeBoost(
    { charge: state.boostCharge ?? 0, remaining: state.boostRemaining ?? 0 },
    {
      speed: player?.speed ?? 0,
      slip: player?.slip ?? 0,
      steering: input.steering,
      grounded: player?.grounded ?? false,
    },
    dt,
    arcade && !player?.wrecked && !playerWaterContact,
  )
  if (boost.activated) events.push({ type: 'boost-activated' })
  const terminalReason =
    playerWaterContact
      ? 'water'
      : player?.wrecked === true
      ? 'wrecked'
      : player?.finishedAt !== null && player?.finishedAt !== undefined
        ? 'finished'
        : null
  if (terminalReason) {
    events.push({ type: 'race-finished', reason: terminalReason })
  }
  return {
    state: {
      ...state,
      vehicles,
      elapsed,
      boostCharge: boost.charge,
      boostRemaining: boost.remaining,
      phase: terminalReason ? 'finished' : 'running',
      activeContacts: [
        ...collisionFrame.activeContacts,
        ...barrierFrame.activeContacts,
      ],
      cameraHints: player
        ? {
            ...buildRaceCameraHints(state.path, player, state.reversed),
            shake: impactShake,
          }
        : state.cameraHints,
      effects: advanceRaceEffects(
        state.effects,
        vehicles,
        events,
        dt,
        random,
      ),
    },
    events,
  }
}
