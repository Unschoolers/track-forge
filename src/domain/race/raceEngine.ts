import type { RandomSource } from '@/application/ports/random'
import { rivalCatchUp } from '@/domain/race/ai/catchUp'
import { stepAiVehicle } from '@/domain/race/ai/aiDriver'
import { getTrafficState } from '@/domain/race/ai/traffic'
import { solveCollisionFrame } from '@/domain/race/collisions'
import { authoredRecoveryTarget, reachedRecoveryCheckpoint, type RecoveryCourse } from '@/domain/race/recoveryCheckpoints'
import { hitScenery } from '@/domain/race/sceneryCollisions'
import { lastSampleBeforeCheckpoint, passedPendingCheckpoint, updateOpenRouteProgress, updateProgress } from '@/domain/race/progress'
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
  type VehicleStepContext,
} from '@/domain/race/trackContext'
import { stepVehicle, type SpeedAssist } from '@/domain/race/vehiclePhysics'
import { advanceRaceEffects } from '@/domain/race/effects'
import { solveBridgeBarrierFrame } from '@/domain/race/bridgeBarriers'
import { ROAD_GEOMETRY } from '@/domain/config'
import { stepVehicleVerticalDynamics } from '@/domain/race/vehicleVerticalDynamics'
import { hasVehicleWaterContact } from '@/domain/track/waterExposure'

export type RaceEvent =
  | { readonly type: 'gate-crossed'; readonly vehicleId: string; readonly gate: 1 | 2 | 3 | 4; readonly lap: number; readonly time: number }
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
      readonly reason: 'off-road' | 'water' | 'wreck' | 'scenery'
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

function raceVehicleContext(race: RaceState, vehicle: RaceVehicle, previous?: VehicleStepContext) {
  // An Arcade car moves only a few samples per step. Restrict local matching
  // to its route so a nearby return arm cannot change which road supports it.
  const radius = race.routeKind === 'point-to-point' || (vehicle.player && race.handling !== 'simulation') ? 12 : undefined
  return getVehicleStepContext(race.path, vehicle, previous, radius)
}

export function resetRaceVehicle(
  vehicle: RaceVehicle,
  race: RecoveryCourse,
): RaceVehicle {
  const checkpoint = resetAtAuthoredCheckpoint(vehicle, race)
  if (checkpoint) return checkpoint
  if (race.routeKind !== 'point-to-point') {
    return resetVehicleToTrack(vehicle, race.path, { reversed: race.reversed })
  }
  const limit = lastSampleBeforeCheckpoint(race.path, vehicle.nextSector)
  const pathIndex = findNearestSafeTrackIndex(race.path, vehicle, false, limit)
  return pathIndex === undefined ? vehicle : resetVehicleToTrack(vehicle, race.path, { pathIndex })
}

function resetAtAuthoredCheckpoint(vehicle: RaceVehicle, race: RecoveryCourse): RaceVehicle | undefined {
  const pathIndex = authoredRecoveryTarget(race, vehicle)
  if (pathIndex === undefined) return undefined
  return resetVehicleToTrack({
    ...vehicle,
    waterRecoveryProtected: false,
    ...(vehicle.wrecked ? { wrecked: false, damage: 0, damageCooldown: 0.55 } : {}),
  }, race.path, { pathIndex, reversed: race.reversed })
}

function restoreFrameProgress(vehicle: RaceVehicle, previous: RaceVehicle): RaceVehicle {
  return {
    ...vehicle,
    nextSector: previous.nextSector,
    lap: previous.lap,
    finishedAt: previous.finishedAt,
    ...(vehicle.recoveryCheckpoint === undefined && previous.recoveryCheckpoint === undefined
      ? {} : { recoveryCheckpoint: previous.recoveryCheckpoint ?? null }),
  }
}

function aiRampSpeedLimit(
  race: RaceState,
  vehicle: RaceVehicle,
  startIndex: number,
): number {
  // Anticipate climbs in the travel direction; descents keep their speed.
  const lookAhead = Math.min(40, Math.max(12, Math.ceil(vehicle.speed / 6)))
  if (gradeForTravel(race.path.roadSurface.gradeAt(startIndex), race.reversed) < -0.025) {
    return Number.POSITIVE_INFINITY
  }
  for (let offset = 0; offset <= lookAhead; offset++) {
    const index = startIndex + offset * (race.reversed ? -1 : 1)
    if (!race.path.closed && (index < 0 || index >= race.path.points.length)) continue
    if (gradeForTravel(race.path.roadSurface.gradeAt(index), race.reversed) > 0.025) {
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
  catchUp: SpeedAssist | undefined,
): RaceVehicle {
  const previousContext = raceVehicleContext(race, vehicle)
  let moved: RaceVehicle
  if (vehicle.player) {
    moved = stepVehicle(
      vehicle,
      input,
      previousContext,
      deltaSeconds,
      race.handling ?? 'arcade',
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
      aiRampSpeedLimit(race, vehicle, previousContext.nearest.index),
      race.handling ?? 'arcade',
      catchUp,
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
  const catchUp = rivalCatchUp(state)
  const moved = state.vehicles.map((vehicle) =>
    vehicle.finishedAt !== null ? vehicle : advanceVehicle(vehicle, state, input, dt, random, catchUp),
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
    const context = raceVehicleContext(state, vehicle)
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
    const prepared = {
      ...vehicle,
      lane:
        (vehicle.x - context.nearest.point.x) * context.normal.x +
        (vehicle.y - context.nearest.point.y) * context.normal.y,
      currentSurface: context.surface,
      onCurb: context.onCurb,
      pathDistance: context.nearest.point.distance,
      structureRunId: context.structureRunId,
      stuckDuration,
    }
    const usesCheckpoints = prepared.player && Boolean(state.recoveryCheckpoints?.length)
    const onRoadBefore = previous && (state.routeKind === 'point-to-point' || usesCheckpoints)
      ? raceVehicleContext(state, previous).onRoad : false
    let updated = state.routeKind === 'point-to-point' && previous
      ? updateOpenRouteProgress(
          previous, prepared, state.path, context.nearest.index, elapsed,
          onRoadBefore, context.onRoad, ROAD_GEOMETRY.onRoadRadius,
        )
      : updateProgress(
          prepared, context.nearest.index, state.path.points.length, elapsed,
          state.totalLaps, state.startPathIndex, state.reversed,
        )
    if (usesCheckpoints && previous) {
      const checkpoint = reachedRecoveryCheckpoint(state, previous, updated, onRoadBefore && context.onRoad)
      updated = { ...updated, recoveryCheckpoint: checkpoint }
    }
    const playerStuck = updated.player && updated.stuckDuration > 0.65
    const lostRival = !updated.player && updated.grounded &&
      (context.nearest.distance > ROAD_GEOMETRY.onRoadRadius + 30 ||
        (state.routeKind === 'point-to-point' && passedPendingCheckpoint(state.path, updated)))
    if (playerStuck || lostRival) {
      const candidate = (state.routeKind === 'point-to-point' || usesCheckpoints) && previous
        ? restoreFrameProgress(updated, previous)
        : updated
      const reset = resetRaceVehicle(candidate, state)
      if (reset !== candidate) {
        events.push({
          type: 'vehicle-recovered', vehicleId: updated.id, reason: 'off-road',
          x: updated.x, y: updated.y, pathIndex: updated.pathIndex,
        })
        updated = reset
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
    const prior = state.vehicles[index]
    if (prior && !prior.player && prior.finishedAt !== null) return prior
    const context = raceVehicleContext(state, collided)
    const vehicle = reconcileSupportAfterCollision(collided, context)
    const usesCheckpoints = vehicle.player && Boolean(state.recoveryCheckpoints?.length)
    if (vehicle.player && !arcade && !usesCheckpoints) return vehicle
    const waterContact = hasVehicleWaterContact({
      grounded: vehicle.grounded,
      terrainMaterial: context.terrainMaterial,
      safeAboveWater: context.safeAboveWater,
    })
    const previous = state.vehicles[index]
    const sceneryHit = usesCheckpoints && previous && state.sceneryColliders &&
      !events.some(event => event.type === 'vehicle-recovered' && event.vehicleId === vehicle.id) &&
      hitScenery(state.sceneryColliders, previous, vehicle)
    if (usesCheckpoints && (waterContact || vehicle.wrecked || sceneryHit)) {
      const candidate = previous ? restoreFrameProgress(vehicle, previous) : vehicle
      const reset = resetAtAuthoredCheckpoint(candidate, state)
      if (reset) {
        events.push({
          type: 'vehicle-recovered', vehicleId: vehicle.id,
          reason: waterContact ? 'water' : vehicle.wrecked ? 'wreck' : 'scenery',
          x: vehicle.x, y: vehicle.y, pathIndex: vehicle.pathIndex,
        })
        return reset
      }
    }
    if (vehicle.player && !arcade) return vehicle
    if (arcade && vehicle.player && vehicle.waterRecoveryProtected) {
      return vehicle.grounded && !waterContact
        ? { ...vehicle, waterRecoveryProtected: false }
        : vehicle
    }
    if (!waterContact) {
      return vehicle
    }
    const recoverySector = previous?.nextSector ?? vehicle.nextSector
    const pathIndex = findNearestSafeTrackIndex(
      state.path,
      vehicle,
      state.reversed,
      state.routeKind === 'point-to-point' ? lastSampleBeforeCheckpoint(state.path, recoverySector) : undefined,
    )
    events.push({
      type: 'vehicle-recovered', vehicleId: vehicle.id, reason: 'water',
      x: vehicle.x, y: vehicle.y, pathIndex: vehicle.pathIndex,
    })
    // Water recovery must not award a lap, sector or finish from the fall.
    const recovering = previous
      ? { ...restoreFrameProgress(vehicle, previous), waterRecoveryProtected: pathIndex === undefined }
      : vehicle
    if (state.routeKind === 'point-to-point' && pathIndex === undefined) {
      return { ...recovering, vx: 0, vy: 0, speed: 0, yawRate: 0 }
    }
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
    ? raceVehicleContext(state, player)
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
    const recovered = events.some((event) => event.type === 'vehicle-recovered' && event.vehicleId === vehicle.id)
    if (recovered && (vehicle.nextSector !== previous.nextSector || vehicle.lap !== previous.lap)) {
      vehicles[index] = { ...vehicle, nextSector: previous.nextSector, lap: previous.lap, finishedAt: previous.finishedAt }
      continue
    }
    if (!recovered) {
      const endGate = vehicle.lap > previous.lap ? 4 : vehicle.nextSector - 1
      for (let gate = previous.nextSector; gate <= endGate; gate++) {
        events.push({ type: 'gate-crossed', vehicleId: vehicle.id, gate: gate as 1 | 2 | 3 | 4, lap: previous.lap, time: elapsed })
      }
    }
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
  player = vehicles.find((vehicle) => vehicle.player)
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
