import type { RandomSource } from '@/domain/race/randomSource'
import { rivalCatchUp } from '@/domain/race/ai/catchUp'
import { lastRoadRecoveryTarget, reachedRecoveryCheckpoint, safeFallbackRecoveryTarget } from '@/domain/race/recoveryCheckpoints'
import { lastSampleBeforeCheckpoint } from '@/domain/race/progress'
import {
  manualRecoveryTicksRemaining,
  type DriverInput,
  type RaceOutcome,
  type RaceState,
  type RaceVehicle,
} from '@/domain/race/raceState'
import {
  buildRaceCameraHints,
  findNearestSafeTrackIndex,
  reconcileSupportAfterCollision,
  resetVehicleToTrack,
} from '@/domain/race/trackContext'
import { advanceRaceEffects } from '@/domain/race/effects'
import { ROAD_GEOMETRY } from '@/domain/config'
import { hasVehicleWaterContact, isSafeRoadRecoverySample } from '@/domain/track/waterExposure'
import { resetRaceVehicle, recoverRacePlayer, recoverRaceVehicle, resetMissedCheckpoint, restoreFrameProgress, RECOVERY_TUNING, advanceRivalOffRoadRecovery } from '@/domain/race/raceRecovery'
import { advanceArcadeTimingGate, finishGateNumber } from '@/domain/race/arcadeTimingGate'
import { BRIDGE_FALL_RESPAWN_SECONDS, trackBridgeFall } from '@/domain/race/bridgeFallRecovery'
import { advanceVehicle, raceVehicleContext, PLAYER_ROUTE_WINDOW } from '@/domain/race/raceVehicleStepper'

// Preserve existing engine imports after moving recovery rules to their owner.
export { resetRaceVehicle, recoverRacePlayer } from '@/domain/race/raceRecovery'

export type RaceEvent =
  | { readonly type: 'gate-crossed'; readonly vehicleId: string; readonly gate: number; readonly lap: number; readonly time: number }
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
      readonly type: 'vehicle-finished'
      readonly vehicleId: string
      readonly time: number
    }
  | {
      readonly type: 'vehicle-recovered'
      readonly vehicleId: string
      readonly reason: 'off-road' | 'water' | 'missed-checkpoint'
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
  /** Explicit manual recovery requests for any controlled vehicle. */
  readonly recoverVehicleIds?: readonly string[]
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

function controlsForVehicle(
  controls: RaceTickInput['controls'],
  id: string,
): DriverInput | undefined {
  return Object.hasOwn(controls, id) ? controls[id] : undefined
}

export const stepRace: RaceStep = advanceRace

export function isRivalRacing(vehicle: RaceVehicle): boolean {
  return !vehicle.player && vehicle.finishedAt === null
}

/** Advance only active rivals after the player has finished. */
export function stepFinishingRivals(state: RaceState, random: RandomSource): RaceState {
  const rivals = state.vehicles.filter(isRivalRacing)
  if (rivals.length === 0) return state
  const frame = advanceRace({ ...state, phase: 'running', vehicles: rivals }, NEUTRAL_INPUT, RACE_TICK_SECONDS, random)
  let index = 0
  return {
    ...frame.state,
    phase: 'finished',
    vehicles: state.vehicles.map((vehicle) => isRivalRacing(vehicle) ? frame.state.vehicles[index++] ?? vehicle : vehicle),
  }
}

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
  let beforeStep = input.recoverPlayer ? recoverRacePlayer(state) : state
  for (const id of input.recoverVehicleIds ?? []) beforeStep = recoverRaceVehicle(beforeStep, id)
  return advanceRace(beforeStep, NEUTRAL_INPUT, RACE_TICK_SECONDS, random, input.controls)
}

/** Projects road support and bridge-fall state, then updates gate progress and
 * applies off-road recovery after rolling back any progress made on this tick.
 */
function advanceTickCheckpointProgressAndRoadRecovery(
  state: RaceState,
  moved: readonly RaceVehicle[],
  held: ReadonlySet<string>,
  playerInput: DriverInput,
  controls: RaceTickInput['controls'] | undefined,
  dt: number,
  elapsed: number,
  events: RaceEvent[],
): { vehicles: RaceVehicle[]; missedCheckpoint: RaceState['missedCheckpoint'] } {
  let missedCheckpoint = state.missedCheckpoint
  const progressed = moved.map((vehicle, index) => {
    if (held.has(vehicle.id) || vehicle.finishedAt !== null) return state.vehicles[index] ?? vehicle
    const context = raceVehicleContext(state, vehicle)
    const previous = state.vehicles[index]
    const stuckInput = vehicle.player && elapsed > 1.1 && vehicle.speed < 13
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
    // All drivers must supply real previous support, even when recovery
    // markers are only recorded for the local player.
    let previousOnRoad: boolean | undefined
    const wasOnRoad = () => previousOnRoad ??= previous ? raceVehicleContext(state, previous).onRoad : false
    const withPath = previous
      ? trackBridgeFall(
          previous,
          { ...prepared, pathDistance: state.path.points[progressIndex]?.distance ?? prepared.pathDistance },
          context.onRoad, context.structureRunId, context.surfaceHeight, dt,
        )
      : { ...prepared, pathDistance: state.path.points[progressIndex]?.distance ?? prepared.pathDistance }
    let updated: RaceVehicle = { ...withPath, pathIndex: progressIndex }
    if (previous) {
      const progress = advanceArcadeTimingGate(
        state, previous, updated, elapsed, context.onRoad, wasOnRoad,
      )
      updated = progress.vehicle
      if (vehicle.player) missedCheckpoint = progress.missedCheckpoint
      else if (progress.missedCheckpoint || previous.missedCheckpoint)
        updated = { ...updated, missedCheckpoint: progress.missedCheckpoint }
    }
    if (vehicle.player && state.path.closed) {
      updated = { ...updated, pathIndex: context.nearest.index, pathDistance: context.nearest.point.distance,
        recoveryAnchorIndex, recoveryReacquiredIndex }
    }
    if (updated.player && updated.bridgeFallSeconds === undefined && context.onRoad &&
        updated.grounded && !unrelatedArm &&
        isSafeRoadRecoverySample(state.path, context.nearest.index)) {
      updated = { ...updated, lastRoadContactIndex: context.nearest.index }
    }
    if (usesCheckpoints && previous) {
      const checkpoint = reachedRecoveryCheckpoint(state, previous, updated, wasOnRoad() && context.onRoad)
      updated = { ...updated, recoveryCheckpoint: checkpoint }
    }
    const playerStuck = updated.player && updated.bridgeFallSeconds === undefined &&
      updated.stuckDuration >= RECOVERY_TUNING.playerStuckSeconds - 1e-9
    const bridgeFallExpired = updated.player &&
      (updated.bridgeFallSeconds ?? 0) >= BRIDGE_FALL_RESPAWN_SECONDS
    const rivalBelowDeck = !updated.player && !context.onRoad &&
      context.nearest.distance <= ROAD_GEOMETRY.onRoadRadius
    const offRoadRecovery = advanceRivalOffRoadRecovery(updated, context, dt)
    updated = offRoadRecovery.vehicle
    const lostRival = !updated.player && updated.finishedAt === null && updated.grounded &&
      (rivalBelowDeck || offRoadRecovery.expired)
    if (playerStuck || bridgeFallExpired || lostRival) {
      // Roll back timing before selecting the respawn target, not afterwards.
      // Otherwise a gate crossed in the recovery frame can leave the rival
      // past the now-pending stripe even though the final event pass revokes it.
      const candidate = previous
        ? restoreFrameProgress({
            ...updated,
            pathIndex: rivalBelowDeck || updated.player || state.routeKind === 'point-to-point'
              ? previous.pathIndex : updated.pathIndex,
            ...(updated.player ? {} : { missedCheckpoint: updated.missedCheckpoint ?? previous.missedCheckpoint }),
          }, previous)
        : updated
      const pending = candidate.player ? missedCheckpoint ?? state.missedCheckpoint : candidate.missedCheckpoint
      const reset = rivalBelowDeck && !pending && !state.timingGates?.length
        ? resetVehicleToTrack(candidate, state.path, { pathIndex: candidate.pathIndex, reversed: state.reversed })
        : resetRaceVehicle(candidate, { ...state, missedCheckpoint: pending })
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
  return { vehicles: progressed, missedCheckpoint }
}

/** Reconciles post-motion support and applies water recovery after gate progress. */
function reconcileTickSupportAndRecoverFromWater(
  state: RaceState,
  progressed: readonly RaceVehicle[],
  held: ReadonlySet<string>,
  missedCheckpoint: RaceState['missedCheckpoint'],
  events: RaceEvent[],
): RaceVehicle[] {
  const vehicles = progressed.map((collided, index) => {
    const prior = state.vehicles[index]
    if (prior && (held.has(prior.id) || (!prior.player && prior.finishedAt !== null))) return prior
    const context = raceVehicleContext(state, collided)
    const vehicle = reconcileSupportAfterCollision(collided, context)
    const usesCheckpoints = vehicle.player && Boolean(state.recoveryCheckpoints?.length)
    const waterContact = hasVehicleWaterContact({
      grounded: vehicle.grounded,
      terrainMaterial: context.terrainMaterial,
      safeAboveWater: context.safeAboveWater,
    })
    // A bridge plunge (including into water) gets the full two-second
    // recovery window rather than teleporting as soon as it hits the surface.
    if (vehicle.player && vehicle.bridgeFallSeconds !== undefined &&
        vehicle.bridgeFallSeconds < BRIDGE_FALL_RESPAWN_SECONDS) return vehicle
    const previous = state.vehicles[index]
    if (usesCheckpoints && waterContact && !vehicle.waterRecoveryProtected) {
      const candidate = previous
        ? restoreFrameProgress({ ...vehicle, pathIndex: previous.pathIndex }, previous)
        : vehicle
      const reset = resetRaceVehicle(candidate, { ...state, missedCheckpoint })
      if (reset !== candidate) {
        events.push({
          type: 'vehicle-recovered', vehicleId: vehicle.id,
          reason: 'water',
          x: vehicle.x, y: vehicle.y, pathIndex: vehicle.pathIndex,
        })
        return reset
      }
    }
    if (vehicle.waterRecoveryProtected) {
      return vehicle.grounded && !waterContact
        ? { ...vehicle, waterRecoveryProtected: false }
        : vehicle
    }
    if (!waterContact) {
      return vehicle
    }
    const pending = vehicle.player ? missedCheckpoint : vehicle.missedCheckpoint
    if (pending) {
      // Even an off-road/water recovery during the grace period must land
      // before the missed stripe, not at a later contact on the next lap.
      const recovering = previous ? restoreFrameProgress(vehicle, previous) : vehicle
      const reset = resetMissedCheckpoint(recovering, { ...state, missedCheckpoint: pending })
      if (reset === recovering) return recovering
      events.push({
        type: 'vehicle-recovered', vehicleId: vehicle.id, reason: 'water',
        x: vehicle.x, y: vehicle.y, pathIndex: vehicle.pathIndex,
      })
      return reset
    }
    const recoverySector = previous?.nextSector ?? vehicle.nextSector
    const pathIndex = vehicle.player
      ? (lastRoadRecoveryTarget(state, vehicle) ?? safeFallbackRecoveryTarget(state, {
          ...vehicle, pathIndex: previous?.pathIndex ?? vehicle.pathIndex, nextSector: recoverySector,
        }))
      : state.timingGates?.length
        ? safeFallbackRecoveryTarget(state, { ...vehicle, nextSector: recoverySector })
        : findNearestSafeTrackIndex(
            state.path, vehicle, state.reversed,
            state.routeKind === 'point-to-point' ? lastSampleBeforeCheckpoint(state.path, recoverySector, state.timingGates) : undefined,
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
  return vehicles
}

/** Owns one tick's ordered progress/recovery phases: project road support and
 * bridge-fall state; update gates; roll back before off-road recovery; reconcile
 * support and water recovery; then expire missed-gate countdowns.
 */
function advanceRaceTickProgressAndRecovery(
  state: RaceState,
  moved: readonly RaceVehicle[],
  held: ReadonlySet<string>,
  playerInput: DriverInput,
  controls: RaceTickInput['controls'] | undefined,
  dt: number,
  elapsed: number,
  events: RaceEvent[],
): { vehicles: RaceVehicle[]; missedCheckpoint: RaceState['missedCheckpoint'] } {
  const progress = advanceTickCheckpointProgressAndRoadRecovery(
    state, moved, held, playerInput, controls, dt, elapsed, events,
  )
  let missedCheckpoint = progress.missedCheckpoint
  let vehicles = reconcileTickSupportAndRecoverFromWater(
    state, progress.vehicles, held, missedCheckpoint, events,
  )
  // Both human and AI countdowns use the same clock and recovery target.
  vehicles = vehicles.map((vehicle, index) => {
    const pending = vehicle.player ? missedCheckpoint : vehicle.missedCheckpoint
    if (!pending) return vehicle
    const alreadyRecovered = events.some(event => event.type === 'vehicle-recovered' && event.vehicleId === vehicle.id)
    const previousPending = vehicle.player ? state.missedCheckpoint : state.vehicles[index]?.missedCheckpoint
    const clear = (result: RaceVehicle): RaceVehicle => {
      if (vehicle.player) { missedCheckpoint = undefined; return result }
      return { ...result, missedCheckpoint: undefined }
    }
    if (alreadyRecovered) return clear(vehicle)
    if (!previousPending || previousPending.gate !== pending.gate) return vehicle
    const remainingSeconds = Math.max(0, pending.remainingSeconds - dt)
    if (remainingSeconds <= 1e-9) {
      const recovered = resetMissedCheckpoint(vehicle, { ...state, missedCheckpoint: pending })
      if (recovered !== vehicle) {
        events.push({ type: 'vehicle-recovered', vehicleId: vehicle.id, reason: 'missed-checkpoint', x: vehicle.x, y: vehicle.y, pathIndex: vehicle.pathIndex })
        return clear(recovered)
      }
    }
    const countdown = { ...pending, remainingSeconds }
    if (vehicle.player) { missedCheckpoint = countdown; return vehicle }
    return { ...vehicle, missedCheckpoint: countdown }
  })
  return { vehicles, missedCheckpoint }
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
  const held = new Set(state.vehicles.filter(vehicle => manualRecoveryTicksRemaining(vehicle, state.tick) > 0).map(vehicle => vehicle.id))
  const moved = state.vehicles.map((vehicle) => {
    if (vehicle.finishedAt !== null || held.has(vehicle.id)) return vehicle
    const directInput = controls && controlsForVehicle(controls, vehicle.id)
    const input = directInput ?? (vehicle.player ? playerInput : undefined)
    return advanceVehicle(vehicle, state, input, dt, random,
      input ? undefined : rivalCatchUp(state, vehicle))
  })
  const tickProgress = advanceRaceTickProgressAndRecovery(
    state, moved, held, playerInput, controls, dt, elapsed, events,
  )
  let vehicles = tickProgress.vehicles
  const missedCheckpoint = tickProgress.missedCheckpoint
  let player = vehicles.find((vehicle) => vehicle.player)
  const playerContext = player
    ? raceVehicleContext(state, player)
    : undefined
  const playerWaterContact =
    player !== undefined &&
    playerContext !== undefined &&
    !player.waterRecoveryProtected &&
    (player.bridgeFallSeconds === undefined || player.bridgeFallSeconds >= BRIDGE_FALL_RESPAWN_SECONDS) &&
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
      const endGate = vehicle.lap > previous.lap ? finishGateNumber(state) : vehicle.nextSector - 1
      for (let gate = previous.nextSector; gate <= endGate; gate++) {
        events.push({ type: 'gate-crossed', vehicleId: vehicle.id, gate, lap: previous.lap, time: elapsed })
      }
    }
    if (previous.finishedAt === null && vehicle.finishedAt !== null) {
      events.push({
        type: 'vehicle-finished',
        vehicleId: vehicle.id,
        time: vehicle.finishedAt,
      })
    }
  }
  player = vehicles.find((vehicle) => vehicle.player)
  const impactShake = Math.min(
    6,
    Math.max(
      0,
      (player?.landingIntensity ?? 0) * 4.5,
    ),
  )
  const terminalReason =
    playerWaterContact
      ? 'water'
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
