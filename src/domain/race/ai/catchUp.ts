import { CAR_SPECS } from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import { raceProgress } from '@/domain/race/ranking'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import type { SpeedAssist } from '@/domain/race/vehiclePhysics'

const BOOST_START_SECONDS = 0.5
const FULL_BOOST_SECONDS = 5
const INITIAL_BONUS = 0.01
const MAX_SPEED_BONUS = 0.12

/** Every difficulty uses the same quadratic catch-up curve. */
export function catchUpBonus(gapSeconds: number): number {
  if (!Number.isFinite(gapSeconds) || gapSeconds < BOOST_START_SECONDS) return 0
  const t = clamp((gapSeconds - BOOST_START_SECONDS) / (FULL_BOOST_SECONDS - BOOST_START_SECONDS), 0, 1)
  return INITIAL_BONUS + (MAX_SPEED_BONUS - INITIAL_BONUS) * t * t
}

/** The assist belongs to each trailing car, not the closest rival as a group. */
export function rivalCatchUp(race: RaceState, rival: RaceVehicle): SpeedAssist | undefined {
  const player = race.vehicles.find((vehicle) => vehicle.player)
  if (!player || !rival || rival.player || player.wrecked || rival.wrecked ||
    player.finishedAt !== null || rival.finishedAt !== null ||
    !player.grounded || player.currentSurface === 'grass') return undefined

  const pointCount = race.path.points.length
  if (pointCount < 2) return undefined

  const playerProgress = raceProgress(player, pointCount, race.startPathIndex, race.reversed, race.routeKind)
  const rivalProgress = raceProgress(rival, pointCount, race.startPathIndex, race.reversed, race.routeKind)
  const sampleSpacing = race.path.totalLength / (race.path.closed ? pointCount : pointCount - 1)
  const distanceBehind = (playerProgress - rivalProgress) * sampleSpacing

  // Convert progress into time gap using road speed. A speed floor avoids
  // artificial boost spikes when either car brakes or recovers.
  const referenceSpeed = Math.max(player.speed, rival.speed, CAR_SPECS[player.car].max * 0.5)
  const bonus = catchUpBonus(distanceBehind / referenceSpeed)
  return bonus > 0 ? { multiplier: 1 + bonus, ceiling: Number.POSITIVE_INFINITY } : undefined
}
