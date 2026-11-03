import type { RaceVehicle } from '@/domain/race/raceState'

export function updateProgress(
  vehicle: RaceVehicle,
  nextPathIndex: number,
  pathLength: number,
  elapsed: number,
  totalLaps: number,
  startPathIndex = 0,
  reversed = false,
): RaceVehicle {
  if (pathLength <= 0 || vehicle.finishedAt !== null) return vehicle
  const directed = (index: number): number => {
    const value = reversed
      ? startPathIndex - index
      : index - startPathIndex
    return ((value % pathLength) + pathLength) % pathLength
  }
  const previous = directed(vehicle.pathIndex)
  const next = directed(nextPathIndex)
  const travel = (next - previous + pathLength) % pathLength
  if (travel > pathLength / 2) {
    return { ...vehicle, pathIndex: nextPathIndex }
  }
  const crossed = (gate: number): boolean => {
    const distance = (gate - previous + pathLength) % pathLength
    return distance > 0 && distance <= travel
  }
  let nextSector = vehicle.nextSector
  for (const sector of [1, 2, 3] as const) {
    if (
      nextSector === sector &&
      crossed((pathLength * sector) / 4)
    ) {
      nextSector = (sector + 1) as 2 | 3 | 4
    }
  }
  const crossedStart = next < previous && travel > 0
  const completedLap = crossedStart && nextSector === 4
  const lap = vehicle.lap + (completedLap ? 1 : 0)
  if (crossedStart) nextSector = 1
  return {
    ...vehicle,
    pathIndex: nextPathIndex,
    lap,
    nextSector,
    finishedAt: lap >= totalLaps ? elapsed : null,
  }
}
