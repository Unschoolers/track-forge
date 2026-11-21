import { ROAD_GEOMETRY } from '@/domain/config'
import { crossesRoadGate, passedPendingCheckpoint } from '@/domain/race/progress'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'

const MISSED_GATE_GRACE_SECONDS = 5

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
  if (progress > window) return false
  const tolerance = Math.min(2, window / 2)
  if (gate === 4) {
    return before > count - window && after > tolerance && after < window
  }
  return after > count * gate / 4 + tolerance && after < count - window
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
    ? passedCircuitGateByProgress(count, startPathIndex, reversed, gate, previous.pathIndex, vehicle.pathIndex)
    : passedPendingCheckpoint(path, vehicle)
  if (!crossedLine && !passedGate) {
    return { vehicle, missedCheckpoint }
  }
  // Road classification at a diagonal gate can change on the crossing frame.
  // If either endpoint falls off the road, require the actual swept crossing
  // to intersect the painted stripe rather than granting a grass shortcut.
  const crossingRadius = onRoad && wasOnRoad()
    ? ROAD_GEOMETRY.onRoadRadius
    : ROAD_GEOMETRY.checkpointHalfWidth
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

