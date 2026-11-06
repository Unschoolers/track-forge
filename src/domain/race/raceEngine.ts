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
  turnAmountAt,
} from '@/domain/race/trackContext'
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { advanceRaceEffects } from '@/domain/race/effects'
import { solveBridgeBarrierFrame } from '@/domain/race/bridgeBarriers'
import { ROAD_GEOMETRY } from '@/domain/config'
import { stepVehicleVerticalDynamics } from '@/domain/race/vehicleVerticalDynamics'
import { hasVehicleWaterContact } from '@/domain/track/waterExposure'

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
  | {
      readonly type: 'vehicle-recovered'
      readonly vehicleId: string
      readonly reason: 'off-road' | 'water'
      /** Position and followed road sample before automatic recovery. */
      readonly x: number
      readonly y: number
      readonly pathIndex: number
    }
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

function rampSpeedLimit(race: RaceState, vehicle: RaceVehicle): number {
  // Look ahead far enough to brake before either end of a ramp, in either direction.
  const lookAhead = Math.min(40, Math.max(12, Math.ceil(vehicle.speed / 6)))
  const startIndex = getVehicleStepContext(race.path, vehicle).nearest.index
  for (let offset = 0; offset <= lookAhead; offset++) {
    const index = startIndex + offset * (race.reversed ? -1 : 1)
    if (!race.path.closed && (index < 0 || index >= race.path.points.length)) continue
    if (Math.abs(race.path.roadSurface.gradeAt(index)) > 0.025) {
      return 110
    }
  }
  return Number.POSITIVE_INFINITY
}

function advanceVehicle(
  vehicle: RaceVehicle,
  race: RaceState,
  input: DriverInput,
  deltaSeconds: number,
  random: RandomSource,
): RaceVehicle {
  const previousContext = getVehicleStepContext(race.path, vehicle)
  const speedLimit = rampSpeedLimit(race, vehicle)
  let moved: RaceVehicle
  if (vehicle.player) {
    moved = stepVehicle(
      vehicle,
      input,
      previousContext,
      deltaSeconds,
      race.handling ?? 'simulation',
      speedLimit,
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
      speedLimit,
    )
  }
  const nextContext = getVehicleStepContext(race.path, moved, previousContext)
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
      allowTakeoff: [0, 6, 12, 18].every((offset) =>
        Math.abs(turnAmountAt(race.path, nextContext.nearest.index + offset * (race.reversed ? -1 : 1), 6)) < 0.08,
      ),
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
  const moved = state.vehicles.map((vehicle) =>
    advanceVehicle(vehicle, state, input, dt, random),
  )
  const barrierFrame = arcade
    ? { vehicles: moved, activeContacts: [], events: [] }
    : solveBridgeBarrierFrame(
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
      events.push({
        type: 'vehicle-recovered', vehicleId: updated.id, reason: 'off-road',
        x: updated.x, y: updated.y, pathIndex: updated.pathIndex,
      })
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
        events.push({
          type: 'vehicle-recovered', vehicleId: updated.id, reason: 'off-road',
          x: updated.x, y: updated.y, pathIndex: updated.pathIndex,
        })
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
  const collisionFrame = arcade
    ? { vehicles: progressed, activeContacts: [], events: [] }
    : solveCollisionFrame(
    progressed,
    state.activeContacts,
    dt,
  )
  let vehicles = collisionFrame.vehicles.map((collided, index) => {
    const context = getVehicleStepContext(state.path, collided)
    const vehicle = reconcileSupportAfterCollision(collided, context)
    if (vehicle.player && !arcade) return vehicle
    const waterContact = hasVehicleWaterContact({
      grounded: vehicle.grounded,
      terrainMaterial: context.terrainMaterial,
      safeAboveWater: context.safeAboveWater,
    })
    if (arcade && vehicle.player && vehicle.waterRecoveryProtected) {
      return vehicle.grounded && !waterContact
        ? { ...vehicle, waterRecoveryProtected: false }
        : vehicle
    }
    if (!waterContact) {
      return vehicle
    }
    const pathIndex = findNearestSafeTrackIndex(
      state.path,
      vehicle,
      state.reversed,
    )
    events.push({
      type: 'vehicle-recovered', vehicleId: vehicle.id, reason: 'water',
      x: vehicle.x, y: vehicle.y, pathIndex: vehicle.pathIndex,
    })
    // Water recovery must not award a lap, sector or finish from the fall.
    const previous = state.vehicles[index]
    const recovering = vehicle.player && previous
      ? { ...vehicle, lap: previous.lap, nextSector: previous.nextSector,
          finishedAt: previous.finishedAt, waterRecoveryProtected: pathIndex === undefined }
      : vehicle
    return resetVehicleToTrack(recovering, state.path, {
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
    !(arcade && player.waterRecoveryProtected) &&
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
