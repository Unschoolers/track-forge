import { assert } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { decodeTrack } from '@/domain/track/trackCodec'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import type { CarId } from '@/domain/model'
import trackExport from './figureEight.trackforge.json'
import { requireFixture } from './requireFixture'

export const nearbyTrack = requireFixture(decodeTrack(trackExport, 1))
export const nearbyPath = new TrackGeometryService().get(nearbyTrack).path

/** Valid gameplay vehicle used by orchestration and wire-contract tests. */
export function nearbyCar(car: CarId, x: number, z = 0, structureRunId: string | null = null) {
  const vehicle = createRace({ path: nearbyPath, playerCar: car, difficulty: 'hard', laps: 1 })
    .vehicles.find((candidate) => candidate.player)
  assert(vehicle, 'Expected a player vehicle')
  return { ...vehicle, x, y: -3.25, z, angle: 2 * Math.PI - 0.01, structureRunId }
}
