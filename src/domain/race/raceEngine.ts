import type { RandomSource } from '@/application/ports/random'
import { rivalCatchUp } from '@/domain/race/ai/catchUp'
import { stepAiVehicle } from '@/domain/race/ai/aiDriver'
import { getTrafficState } from '@/domain/race/ai/traffic'
import { solveCollisionFrame } from '@/domain/race/collisions'
import { authoredRecoveryTarget, reachedRecoveryCheckpoint, safeFallbackRecoveryTarget, type RecoveryCourse } from '@/domain/race/recoveryCheckpoints'
import { hitScenery } from '@/domain/race/sceneryCollisions'
import { crossesRoadGate, lastSampleBeforeCheckpoint, passedPendingCheckpoint, updateOpenRouteProgress, updateProgress } from '@/domain/race/progress'
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
  | { readonly type: 'vehicle-landed'; readonly vehicleId: string; readonly strength: number }
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
      readonly reason: 'off-road' | 'water' | 'wreck' | 'scenery' | 'missed-checkpoint'
      /** Position and followed road sample before automatic recovery. */
      readonly x: number
      readonly y: number
      readonly pathIndex: number
    }
  | {
      readonly type: 'race-finished'
      readonly reason: RaceOutcome
    }

export const RACE_TICK_SECONDS = 1 / 60

const NEUTRAL_INPUT: DriverInput = { steering: 0, throttle: 0, braking: false }

export interface RaceTickInput {
  /** Running ticks are consecutive and begin at 1. */
  readonly tick: number
  /** Vehicle IDs with direct controls. Omitted rivals use AI and the primary car coasts. */
  readonly controls: Readonly<Record<string, DriverInput | undefined>>
  /** Apply manual recovery for the primary car before advancing this tick. */
  readonly recoverPlayer?: boolean
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

const PLAYER_ROUTE_WINDOW = 12

function raceVehicleContext(race: RaceState, vehicle: RaceVehicle, previous?: VehicleStepContext) {
  // A car moves only a few samples per step. Keep the player on its current
  // road when a nearby return arm is closer; off-road reacquisition remains
  // available for closed circuits in getVehicleStepContext.
  const radius = race.routeKind === 'point-to-point' || vehicle.player ? PLAYER_ROUTE_WINDOW : undefined
  return getVehicleStepContext(race.path, vehicle, previous, radius)
}

export function resetRaceVehicle(
  vehicle: RaceVehicle,
  race: RecoveryCourse,
): RaceVehicle {
  const checkpoint = resetAtAuthoredCheckpoint(vehicle, race)
  if (checkpoint) return checkpoint
  if (vehicle.player) {
    const pathIndex = safeFallbackRecoveryTarget(race, vehicle)
    return pathIndex === undefined ? vehicle : resetVehicleToTrack(vehicle, race.path, { pathIndex, reversed: race.reversed })
  }
  if (race.routeKind !== 'point-to-point') {
    return resetVehicleToTrack(vehicle, race.path, { reversed: race.reversed })
  }
  const limit = lastSampleBeforeCheckpoint(race.path, vehicle.nextSector)
  const pathIndex = findNearestSafeTrackIndex(race.path, vehicle, false, limit)
  return pathIndex === undefined ? vehicle : resetVehicleToTrack(vehicle, race.path, { pathIndex })
}

export function recoverRacePlayer(state: RaceState): RaceState {
  if (state.phase !== 'running' || state.paused) return state
  const index = state.vehicles.findIndex((vehicle) => vehicle.player)
  const player = state.vehicles[index]
  if (!player) return state
  const recovered = state.missedCheckpoint ? resetMissedCheckpoint(player, state) : resetRaceVehicle(player, state)
  if (recovered === player) return state
  const vehicles = [...state.vehicles]
  vehicles[index] = recovered
  return {
    ...state,
    vehicles,
    missedCheckpoint: undefined,
    cameraHints: buildRaceCameraHints(state.path, recovered, state.reversed),
  }
}

const MISSED_GATE_GRACE_SECONDS = 5

function advanceArcadeTimingGate(
  race: RaceState,
  previous: RaceVehicle,
  vehicle: RaceVehicle,
  elapsed: number,
  onRoad: boolean,
  wasOnRoad: () => boolean,
): { vehicle: RaceVehicle; missedCheckpoint: RaceState['missedCheckpoint'] } {
  const { path, startPathIndex, reversed, missedCheckpoint } = race
  const count = path.points.length
  const gate = previous.nextSector
  const direction = reversed ? -1 : 1
  // Award timing at the gate line, since path sampling alone can round ahead.
  const position = path.closed
    ? ((startPathIndex + direction * count * gate / 4) % count + count) % count
    : (count - 1) * gate / 4
  if (count < 2 || previous.finishedAt !== null) {
    return { vehicle, missedCheckpoint }
  }
  const crossedLine = crossesRoadGate(path, previous, vehicle, position, Infinity, reversed)
  // On a stage the route runs in one direction, so rejoining well past
  // the pending gate is also a miss even if the car went around its line.
  if (!crossedLine && (path.closed || !onRoad || !passedPendingCheckpoint(path, vehicle))) {
    return { vehicle, missedCheckpoint }
  }
  if (crossedLine && onRoad && wasOnRoad() &&
      crossesRoadGate(path, previous, vehicle, position, ROAD_GEOMETRY.onRoadRadius, reversed)) {
    if (gate === 4) {
      const lap = previous.lap + 1
      return {
        vehicle: { ...vehicle, lap, nextSector: 1, finishedAt: lap >= race.totalLaps ? elapsed : null },
        missedCheckpoint: undefined,
      }
    }
    return { vehicle: { ...vehicle, nextSector: (gate + 1) as 2 | 3 | 4 }, missedCheckpoint: undefined }
  }
  if (missedCheckpoint) return { vehicle, missedCheckpoint }

  const lower = Math.min(path.closed ? count - 1 : count - 2, Math.floor(position))
  const a = path.points[lower]
  const b = path.points[(lower + 1) % count]
  if (!a || !b) return { vehicle, missedCheckpoint: undefined }
  const fraction = position - lower
  return {
    vehicle,
    missedCheckpoint: {
      gate,
      remainingSeconds: MISSED_GATE_GRACE_SECONDS,
      position: { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction },
    },
  }
}

function resetMissedCheckpoint(vehicle: RaceVehicle, race: RaceState): RaceVehicle {
  const authored = vehicle.recoveryCheckpoint == null ? undefined : resetAtAuthoredCheckpoint(vehicle, race)
  if (authored) return authored
  const count = race.path.points.length
  const previousGate = vehicle.nextSector - 1
  const progress = Math.floor((race.path.closed ? count : count - 1) * previousGate / 4)
  const target = race.path.closed
    ? ((race.startPathIndex + (race.reversed ? -1 : 1) * progress) % count + count) % count
    : progress
  const candidate = { ...vehicle, pathIndex: target, recoveryAnchorIndex: target }
  const safe = safeFallbackRecoveryTarget(race, candidate)
  return safe === undefined ? vehicle : resetVehicleToTrack(candidate, race.path, { pathIndex: safe, reversed: race.reversed })
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
  // Practiced lines account for ramps at each pace. Arcade Hard rivals on
  // other circuits can also carry their speed over climbs.
  if (vehicle.racingLine || (race.difficulty === 'hard' && (race.handling ?? 'arcade') === 'arcade')) {
    return Number.POSITIVE_INFINITY
  }
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

function controlsForVehicle(
  controls: RaceTickInput['controls'],
  id: string,
): DriverInput | undefined {
  return Object.hasOwn(controls, id) ? controls[id] : undefined
}

function advanceVehicle(
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
      grade: gradeForTravel(nextContext.grade, race.reversed),
      longitudinalSpeed,
      previousOverRoad: previousContext.onRoad,
      overRoad: nextContext.onRoad,
    },
    deltaSeconds,
  )
  return { ...moved, ...vertical }
}

export const stepRace: RaceStep = advanceRace

/** Advances one 60 Hz tick while the race is running and unpaused. */
export function stepRaceTick(
  state: RaceState,
  input: RaceTickInput,
  random: RandomSource,
): RaceStepResult {
  const expectedTick = state.tick + 1
  if (input.tick !== expectedTick) {
    throw new RangeError(`Expected race tick ${expectedTick}, received ${input.tick}`)
  }
  const beforeStep = input.recoverPlayer ? recoverRacePlayer(state) : state
  return advanceRace(beforeStep, NEUTRAL_INPUT, RACE_TICK_SECONDS, random, input.controls)
}

function advanceRace(
  state: RaceState,
  playerInput: DriverInput,
  deltaSeconds: number,
  random: RandomSource,
  controls?: RaceTickInput['controls'],
): RaceStepResult {
  if (state.phase !== 'running' || state.paused || deltaSeconds <= 0) {
    return { state, events: [] }
  }
  const dt = Math.min(0.05, deltaSeconds)
  const elapsed = state.elapsed + dt
  const events: RaceEvent[] = []
  const arcade = !('handling' in state) || state.handling !== 'simulation'
  let missedCheckpoint = state.missedCheckpoint
  const catchUp = rivalCatchUp(state)
  const moved = state.vehicles.map((vehicle) => {
    if (vehicle.finishedAt !== null) return vehicle
    const directInput = controls && controlsForVehicle(controls, vehicle.id)
    const input = directInput ?? (vehicle.player ? playerInput : undefined)
    return advanceVehicle(vehicle, state, input, dt, random, catchUp)
  })
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
    const stuckInput = vehicle.player && elapsed > 1.1 && vehicle.speed < 13 && !vehicle.wrecked
      ? (controls && controlsForVehicle(controls, vehicle.id)) ?? playerInput
      : undefined
    const stuckDuration = stuckInput && stuckInput.throttle > 0 && !stuckInput.braking
      ? vehicle.stuckDuration + dt
      : Math.max(0, vehicle.stuckDuration - dt * 2.5)
    const prepared = {
      ...vehicle,
      lane:
        (vehicle.x - context.nearest.point.x) * context.normal.x +
        (vehicle.y - context.nearest.point.y) * context.normal.y,
      currentSurface: context.surface,
      onCurb: context.onCurb,
      structureRunId: context.structureRunId,
      stuckDuration,
    }
    // Physical support can reacquire a different arm after going off-road.
    // Only an arm within the local driving window can change circuit progress.
    const indexDelta = Math.abs(vehicle.pathIndex - context.nearest.index)
    const unrelatedArm = vehicle.player && state.path.closed &&
      Math.min(indexDelta, state.path.points.length - indexDelta) > PLAYER_ROUTE_WINDOW
    const progressIndex = unrelatedArm ? vehicle.pathIndex : context.nearest.index
    const reacquiredDistance = vehicle.recoveryReacquiredIndex === undefined ? 0 : Math.abs(context.nearest.index - vehicle.recoveryReacquiredIndex)
    const travelledOnNewArm = vehicle.recoveryReacquiredIndex !== undefined && context.onRoad &&
      Math.min(reacquiredDistance, state.path.points.length - reacquiredDistance) > PLAYER_ROUTE_WINDOW
    const recoveryAnchorIndex = travelledOnNewArm ? undefined :
      vehicle.recoveryAnchorIndex ?? (unrelatedArm ? vehicle.pathIndex : undefined)
    const recoveryReacquiredIndex = travelledOnNewArm ? undefined :
      vehicle.recoveryReacquiredIndex ?? (unrelatedArm ? context.nearest.index : undefined)
    const usesCheckpoints = prepared.player && Boolean(state.recoveryCheckpoints?.length)
    const onRoadBefore = previous && (state.routeKind === 'point-to-point' || usesCheckpoints)
      ? raceVehicleContext(state, previous).onRoad : false
    const withPath = {
      ...prepared,
      pathDistance: state.path.points[progressIndex]?.distance ?? prepared.pathDistance,
    }
    let updated: RaceVehicle
    if (arcade && vehicle.player && previous &&
        (state.path.closed || state.routeKind === 'point-to-point')) {
      const progress = advanceArcadeTimingGate(
        state,
        previous,
        { ...withPath, pathIndex: progressIndex },
        elapsed,
        context.onRoad,
        () => state.path.closed && !usesCheckpoints
          ? raceVehicleContext(state, previous).onRoad
          : onRoadBefore,
      )
      updated = progress.vehicle
      missedCheckpoint = progress.missedCheckpoint
    } else if (state.routeKind === 'point-to-point' && previous) {
      updated = updateOpenRouteProgress(
        previous, withPath, state.path, context.nearest.index, elapsed,
        onRoadBefore, context.onRoad, ROAD_GEOMETRY.onRoadRadius,
      )
    } else {
      updated = updateProgress(
        withPath, progressIndex, state.path.points.length, elapsed,
        state.totalLaps, state.startPathIndex, state.reversed,
      )
    }
    if (vehicle.player && state.path.closed) {
      updated = { ...updated, pathIndex: context.nearest.index, pathDistance: context.nearest.point.distance,
        recoveryAnchorIndex, recoveryReacquiredIndex }
    }
    if (usesCheckpoints && previous) {
      const checkpoint = reachedRecoveryCheckpoint(state, previous, updated, onRoadBefore && context.onRoad)
      updated = { ...updated, recoveryCheckpoint: checkpoint }
    }
    const playerStuck = updated.player && updated.stuckDuration > 0.65
    const rivalBelowDeck = !updated.player && !context.onRoad &&
      context.nearest.distance <= ROAD_GEOMETRY.onRoadRadius
    const lostRival = !updated.player && updated.grounded &&
      (rivalBelowDeck || context.nearest.distance > ROAD_GEOMETRY.onRoadRadius + 30 ||
        (state.routeKind === 'point-to-point' && passedPendingCheckpoint(state.path, updated)))
    if (playerStuck || lostRival) {
      const candidate = previous && (rivalBelowDeck || updated.player || state.routeKind === 'point-to-point')
        ? restoreFrameProgress({ ...updated, pathIndex: previous.pathIndex }, previous)
        : updated
      const reset = rivalBelowDeck
        ? resetVehicleToTrack(candidate, state.path, { pathIndex: candidate.pathIndex, reversed: state.reversed })
        : resetRaceVehicle(candidate, state)
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
      const candidate = previous
        ? restoreFrameProgress({ ...vehicle, pathIndex: previous.pathIndex }, previous)
        : vehicle
      const reset = resetRaceVehicle(candidate, state)
      if (reset !== candidate) {
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
    const pathIndex = vehicle.player
      ? safeFallbackRecoveryTarget(state, {
          ...vehicle, pathIndex: previous?.pathIndex ?? vehicle.pathIndex, nextSector: recoverySector,
        })
      : findNearestSafeTrackIndex(
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
    if (pathIndex === undefined && (vehicle.player || state.routeKind === 'point-to-point')) {
      return { ...recovering, vx: 0, vy: 0, speed: 0, yawRate: 0 }
    }
    return resetVehicleToTrack(recovering, state.path, {
      ...(pathIndex === undefined ? {} : { pathIndex }),
      reversed: state.reversed,
    })
  })
  if (missedCheckpoint) {
    const playerIndex = vehicles.findIndex(vehicle => vehicle.player)
    const player = vehicles[playerIndex]
    const alreadyRecovered = player && events.some(event => event.type === 'vehicle-recovered' && event.vehicleId === player.id)
    if (alreadyRecovered) {
      missedCheckpoint = undefined
    } else if (state.missedCheckpoint && player) {
      const remainingSeconds = Math.max(0, missedCheckpoint.remainingSeconds - dt)
      if (remainingSeconds <= 1e-9) {
        const recovered = resetMissedCheckpoint(player, state)
        if (recovered !== player) {
          vehicles[playerIndex] = recovered
          events.push({ type: 'vehicle-recovered', vehicleId: player.id, reason: 'missed-checkpoint', x: player.x, y: player.y, pathIndex: player.pathIndex })
          missedCheckpoint = undefined
        } else {
          missedCheckpoint = { ...missedCheckpoint, remainingSeconds }
        }
      } else {
        missedCheckpoint = { ...missedCheckpoint, remainingSeconds }
      }
    }
  }
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
      if (!previous.grounded && vehicle.grounded && vehicle.landingIntensity > 0.1) {
        events.push({ type: 'vehicle-landed', vehicleId: vehicle.id, strength: vehicle.landingIntensity })
      }
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
      missedCheckpoint: terminalReason ? undefined : missedCheckpoint,
      tick: state.tick + 1,
      elapsed,
      phase: terminalReason ? 'finished' : 'running',
      activeContacts: [
        ...collisionFrame.activeContacts,
        ...barrierFrame.activeContacts,
      ],
      cameraHints: player
        ? {
            ...buildRaceCameraHints(
              state.path,
              player,
              state.reversed,
              events.some((event) => event.type === 'vehicle-recovered' && event.vehicleId === player.id)
                ? undefined
                : state.cameraHints,
              dt,
            ),
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
