import { ROAD_GEOMETRY } from '@/domain/config'
import { crossesRoadGate, passedPendingCheckpoint } from '@/domain/race/progress'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'

const MISSED_GATE_GRACE_SECONDS = 5

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
  // On a stage the route runs in one direction, so rejoining well past
  // the pending gate is also a miss even if the car went around its line.
  if (!crossedLine && (path.closed || !onRoad || !passedPendingCheckpoint(path, vehicle))) {
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

