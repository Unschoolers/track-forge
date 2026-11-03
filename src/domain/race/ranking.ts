import type { RaceVehicle } from '@/domain/race/raceState'

export function raceProgress(
  vehicle: RaceVehicle,
  pathLength: number,
): number {
  const sectorProgress = (vehicle.nextSector - 1) * Math.max(1, pathLength)
  return (
    vehicle.lap * Math.max(1, pathLength) * 4 +
    sectorProgress +
    vehicle.pathIndex
  )
}

export function rankVehicles(
  vehicles: readonly RaceVehicle[],
  pathLength: number,
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
        if (timeDifference !== 0) return timeDifference
      }
      const progressDifference =
        raceProgress(right.vehicle, pathLength) -
        raceProgress(left.vehicle, pathLength)
      return progressDifference || left.gridIndex - right.gridIndex
    })
    .map(({ vehicle }) => vehicle)
}
