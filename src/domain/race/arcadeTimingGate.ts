import { ROAD_GEOMETRY } from '@/domain/config'
import { crossesRoadGate, roadGateCrossingFraction, timingGateCrossingRadius } from '@/domain/race/progress'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { roadGateGeometry } from '@/domain/track/trackGeometry'

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
  // A missed stripe can remain behind the car for several frames after a
  // nearest-road index reacquires the correct arm. Do not require crossing
  // this index during the same tick; the physical beyond-plane check below
  // still rejects off-route jumps and a start-grid approach.
  return after > required + tolerance && after < count - Math.max(window, Math.floor(count / 8))
}

function clearlyBeyondGate(
  path: RaceState['path'], position: number,
  vehicle: Pick<RaceVehicle, 'x' | 'y'>, reversed: boolean,
): boolean {
  const geometry = roadGateGeometry(path, position)
  if (!geometry) return false
  const { center, tangent } = geometry
  const forward = (vehicle.x - center.x) * tangent.x + (vehicle.y - center.y) * tangent.y
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
  onCrossing?: (fraction: number) => void,
): { vehicle: RaceVehicle; missedCheckpoint: RaceState['missedCheckpoint'] } {
  const { path, startPathIndex, reversed } = race
  const missedCheckpoint = previous.player ? race.missedCheckpoint : previous.missedCheckpoint
  const count = path.points.length
  if (count < 2 || previous.finishedAt !== null) return { vehicle, missedCheckpoint }
  // Sweep the same physical motion through consecutive gates in chronological
  // order, including tightly spaced authored stripes in a single tick.
  let gate = previous.nextSector
  let lastCrossing = -1
  let pending = missedCheckpoint
  const radius = timingGateCrossingRadius(ROAD_GEOMETRY.onRoadRadius, onRoad && wasOnRoad())
  while (gate <= finishGateNumber(race)) {
    const finish = gate === finishGateNumber(race)
    const position = pendingTimingGateIndex(race, gate)
    const crossing = roadGateCrossingFraction(path, previous, vehicle, position, radius, reversed, ROAD_GEOMETRY.onRoadRadius)
    if (crossing === undefined || crossing <= lastCrossing) break
    onCrossing?.(crossing)
    lastCrossing = crossing
    pending = undefined
    if (finish) {
      const lap = previous.lap + 1
      return { vehicle: { ...vehicle, lap, nextSector: 1, finishedAt: lap >= race.totalLaps ? elapsed : null }, missedCheckpoint: undefined }
    }
    gate++
  }
  if (gate !== previous.nextSector) vehicle = { ...vehicle, nextSector: gate }
  const finish = gate === finishGateNumber(race)
  const position = pendingTimingGateIndex(race, gate)
  const crossedLine = crossesRoadGate(path, previous, vehicle, position, Infinity, reversed)
  const passedGate = path.closed
    ? previous.recoveryAnchorIndex === undefined && vehicle.recoveryAnchorIndex === undefined &&
      passedCircuitGateByProgress(count, startPathIndex, reversed, position, finish, previous.pathIndex, vehicle.pathIndex)
    : finish ? passedStageFinish(path, vehicle) : vehicle.pathIndex > position + 2
  const confirmedBypass = passedGate && (!path.closed && finish ||
    clearlyBeyondGate(path, position, vehicle, reversed))
  // The infinite extension of a stripe can intersect the incoming asphalt
  // of a sharp bend. That alone is not a missed gate while still on the road.
  // A true off-road bypass or confirmed route progression remains a miss.
  const crossedOutsideRoad = crossedLine && (!onRoad || !wasOnRoad())
  if (!crossedOutsideRoad && !confirmedBypass) return { vehicle, missedCheckpoint: pending }
  if (pending) return { vehicle, missedCheckpoint: pending }

  const geometry = roadGateGeometry(path, position)
  if (!geometry) return { vehicle, missedCheckpoint: undefined }
  return {
    vehicle,
    missedCheckpoint: {
      gate,
      remainingSeconds: MISSED_GATE_GRACE_SECONDS,
      position: geometry.center,
    },
  }
}
