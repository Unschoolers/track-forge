import { ROAD_GEOMETRY } from '@/domain/config'
import { crossesRoadGate, timingGateCrossingRadius } from '@/domain/race/progress'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'

const MISSED_GATE_GRACE_SECONDS = 2

/** 1..N are editor-authored checkpoints; N+1 is the actual start/finish line. */
export function finishGateNumber(race: Pick<RaceState, 'timingGates'>): number {
  return (race.timingGates?.length ?? 0) + 1
}

export function pendingTimingGateIndex(
  race: Pick<RaceState, 'path' | 'startPathIndex' | 'timingGates'>,
  gate: number,
): number {
  return race.timingGates?.[gate - 1] ??
    (race.path.closed ? race.startPathIndex : race.path.points.length - 1)
}

function directedProgress(index: number, count: number, start: number, reversed: boolean): number {
  const value = (reversed ? start - index : index - start) % count
  return (value + count) % count
}

/** Do not equate a large nearest-road jump with passing a checkpoint. */
function passedCircuitGateByProgress(
  count: number, startIndex: number, reversed: boolean,
  gateIndex: number, finish: boolean, previousIndex: number, currentIndex: number,
): boolean {
  const before = directedProgress(previousIndex, count, startIndex, reversed)
  const after = directedProgress(currentIndex, count, startIndex, reversed)
  const advance = (after - before + count) % count
  const window = Math.max(2, Math.min(12, Math.floor(count / 16)))
  if (advance === 0 || advance > window) return false
  const tolerance = Math.min(2, window / 2)
  if (finish) return before > count - window && after > tolerance && after < window
  const required = directedProgress(gateIndex, count, startIndex, reversed)
  return before <= required + tolerance && after > required + tolerance && after < count - tolerance
}

function clearlyBeyondGate(
  path: RaceState['path'], position: number,
  vehicle: Pick<RaceVehicle, 'x' | 'y'>, reversed: boolean,
): boolean {
  const count = path.points.length
  const lower = Math.min(path.closed ? count - 1 : count - 2, Math.floor(position))
  const a = path.points[lower]
  const b = path.points[(lower + 1) % count]
  if (!a || !b) return false
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 0.001) return false
  const fraction = position - lower
  const gx = a.x + dx * fraction
  const gy = a.y + dy * fraction
  const forward = ((vehicle.x - gx) * dx + (vehicle.y - gy) * dy) / length
  return (reversed ? -forward : forward) > 12
}

function passedStageFinish(path: RaceState['path'], vehicle: RaceVehicle): boolean {
  const last = path.points.length - 1
  const a = path.points[last - 1]
  const b = path.points[last]
  if (!a || !b || vehicle.pathIndex < last - 12) return false
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.hypot(dx, dy) < 0.001) return false
  return (vehicle.x - b.x) * dx + (vehicle.y - b.y) * dy > 0
}

export function advanceArcadeTimingGate(
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
  const finish = gate === finishGateNumber(race)
  const position = pendingTimingGateIndex(race, gate)
  if (count < 2 || previous.finishedAt !== null) return { vehicle, missedCheckpoint }
  const crossedLine = crossesRoadGate(path, previous, vehicle, position, Infinity, reversed)
  const passedGate = path.closed
    ? previous.recoveryAnchorIndex === undefined && vehicle.recoveryAnchorIndex === undefined &&
      passedCircuitGateByProgress(count, startPathIndex, reversed, position, finish, previous.pathIndex, vehicle.pathIndex)
    : finish ? passedStageFinish(path, vehicle) : previous.pathIndex <= position + 2 && vehicle.pathIndex > position + 2
  const confirmedBypass = passedGate && (!path.closed && finish ||
    clearlyBeyondGate(path, position, vehicle, reversed))
  if (!crossedLine && !confirmedBypass) return { vehicle, missedCheckpoint }

  const crossingRadius = timingGateCrossingRadius(ROAD_GEOMETRY.onRoadRadius, onRoad && wasOnRoad())
  if (crossedLine && crossesRoadGate(path, previous, vehicle, position, crossingRadius, reversed)) {
    if (finish) {
      const lap = previous.lap + 1
      return {
        vehicle: { ...vehicle, lap, nextSector: 1, finishedAt: lap >= race.totalLaps ? elapsed : null },
        missedCheckpoint: undefined,
      }
    }
    return { vehicle: { ...vehicle, nextSector: gate + 1 }, missedCheckpoint: undefined }
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
