import { ROAD_GEOMETRY } from '@/domain/config'
import { crossesRoadGate, passedPendingCheckpoint, timingGateCrossingRadius } from '@/domain/race/progress'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'

const MISSED_GATE_GRACE_SECONDS = 2

/** A sustained position beyond a circuit gate also counts as a miss.
 * The small direction-aware window avoids mistaking a crossing-road index
 * jump or the starting grid just behind Start for skipped progress.
 */
function passedCircuitGateByProgress(
  count: number,
  startIndex: number,
  reversed: boolean,
  gate: RaceVehicle['nextSector'],
  previousIndex: number,
  currentIndex: number,
): boolean {
  const wrap = (value: number): number => ((value % count) + count) % count
  const direction = reversed ? -1 : 1
  const before = wrap(direction * (previousIndex - startIndex))
  const after = wrap(direction * (currentIndex - startIndex))
  const window = Math.max(2, Math.min(12, Math.floor(count / 16)))
  const progress = wrap(after - before)
  const startApproach = Math.max(window, Math.floor(count / 8))
  if (progress > window) return false
  const tolerance = Math.min(2, window / 2)
  if (gate === 4) {
    return before > count - window && after > tolerance && after < window
  }
  return after > count * gate / 4 + tolerance && after < count - startApproach
}

/** A route-index jump can lead the visible car by several samples near
 * bends and intersections. Never announce a missed checkpoint until the
 * chassis is clearly past its physical plane, not merely past its index.
 */
function clearlyBeyondGate(
  path: RaceState['path'],
  position: number,
  vehicle: Pick<RaceVehicle, 'x' | 'y'>,
  reversed: boolean,
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

/** Open routes cannot advance to a road sample *after* Finish.
 * Detect a car that has gone beyond the finish plane without crossing
 * its painted stripe; the driver still has time to turn back and retry.
 */
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
  const direction = reversed ? -1 : 1
  // Award timing at the gate line, since path sampling alone can round ahead.
  const position = path.closed
    ? ((startPathIndex + direction * count * gate / 4) % count + count) % count
    : (count - 1) * gate / 4
  if (count < 2 || previous.finishedAt !== null) {
    return { vehicle, missedCheckpoint }
  }
  const crossedLine = crossesRoadGate(path, previous, vehicle, position, Infinity, reversed)
  // The line check alone misses cars that go around a gate and only regain
  // a followed road index after its stripe. Use route progress as a second
  // signal, without letting a nearby crossing arm or the start grid count.
  const passedGate = path.closed
    ? previous.recoveryAnchorIndex === undefined && vehicle.recoveryAnchorIndex === undefined &&
      passedCircuitGateByProgress(count, startPathIndex, reversed, gate, previous.pathIndex, vehicle.pathIndex)
    : gate === 4 ? passedStageFinish(path, vehicle) : passedPendingCheckpoint(path, vehicle)
  // Open-stage finish bypass already checks the actual finish plane.
  // Do not apply the circuit/index-jump clearance rule twice at the finish.
  const confirmedBypass = passedGate && (!path.closed && gate === 4 ||
    clearlyBeyondGate(path, position, vehicle, reversed))
  if (!crossedLine && !confirmedBypass) {
    return { vehicle, missedCheckpoint }
  }
  // Require the swept path to pass near the stripe, with a small edge
  // allowance even if one frame is classified off-road.
  const crossingRadius = timingGateCrossingRadius(ROAD_GEOMETRY.onRoadRadius, onRoad && wasOnRoad())
  if (crossedLine &&
      crossesRoadGate(path, previous, vehicle, position, crossingRadius, reversed)) {
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

