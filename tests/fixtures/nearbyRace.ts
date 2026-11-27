import { assert } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { decodeTrack } from '@/domain/track/trackCodec'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import type { CarId, CreatorGhostChallenge, Track } from '@/domain/model'
import { createTrackSigningKey, serializeSignedTrack } from '@/application/library/trackSignature'
import trackExport from './figureEight.trackforge.json'
import { requireFixture } from './requireFixture'

export const nearbyTrack = requireFixture(decodeTrack(trackExport, 1))
export const nearbyPath = new TrackGeometryService().get(nearbyTrack).path

export function nearbyTestSigner(): (track: Track, challenge?: CreatorGhostChallenge) => Promise<string> {
  let keys: Promise<CryptoKeyPair> | undefined
  return (track, challenge) => serializeSignedTrack(challenge ? { ...track, creatorChallenge: challenge } : track, () => keys ??= createTrackSigningKey(), track.signedSource)
}

/** Valid gameplay vehicle used by orchestration and wire-contract tests. */
export function nearbyCar(car: CarId, x: number, z = 0, structureRunId: string | null = null) {
  const vehicle = createRace({ path: nearbyPath, playerCar: car, difficulty: 'hard', laps: 1 })
    .vehicles.find((candidate) => candidate.player)
  assert(vehicle, 'Expected a player vehicle')
  return { ...vehicle, x, y: -3.25, z, angle: 2 * Math.PI - 0.01, structureRunId }
}
