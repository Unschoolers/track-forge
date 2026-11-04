import type { RaceVehicle } from '@/domain/race/raceState'

export function raceProgress(
  vehicle: RaceVehicle,
  pathLength: number,
  startPathIndex = 0,
  reversed = false,
): number {
  const length = Math.max(1, pathLength)
  const offset = reversed
    ? startPathIndex - vehicle.pathIndex
    : vehicle.pathIndex - startPathIndex
  let progress = ((offset % length) + length) % length
  // Before reaching the first checkpoint, the last quarter is behind the line.
  if (vehicle.nextSector === 1 && progress >= length * 0.75) progress -= length
  return vehicle.lap * length + progress
}

export function rankVehicles(
  vehicles: readonly RaceVehicle[],
  pathLength: number,
  startPathIndex = 0,
  reversed = false,
): readonly RaceVehicle[] {
  return vehicles
    .map((vehicle, gridIndex) => ({ vehicle, gridIndex }))
    .sort((left, right) => {
      const leftFinished = left.vehicle.finishedAt !== null
      const rightFinished = right.vehicle.finishedAt !== null
      if (leftFinished !== rightFinished) return leftFinished ? -1 : 1
      if (leftFinished && rightFinished) {
        const timeDifference =
          (left.vehicle.finishedAt ?? 0) - (right.vehicle.finishedAt ?? 0)
        return timeDifference || left.gridIndex - right.gridIndex
      }
      const lapDifference = right.vehicle.lap - left.vehicle.lap
      if (lapDifference !== 0) return lapDifference
      const progressDifference =
        raceProgress(right.vehicle, pathLength, startPathIndex, reversed) -
        raceProgress(left.vehicle, pathLength, startPathIndex, reversed)
      return progressDifference || left.gridIndex - right.gridIndex
    })
    .map(({ vehicle }) => vehicle)
}
