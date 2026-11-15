import { clamp } from '@/domain/geometry/math'
import { raceProgress } from '@/domain/race/ranking'
import type { RaceState } from '@/domain/race/raceState'
import type { SpeedAssist } from '@/domain/race/vehiclePhysics'

const MAX_SPEED_BONUS = 0.05
const MINIMUM_LEAD = 48
const LEAD_FOR_FULL_BONUS = 180

export function rivalCatchUp(race: RaceState): SpeedAssist | undefined {
  const player = race.vehicles.find((vehicle) => vehicle.player)
  if (!player || player.wrecked || player.finishedAt !== null ||
    !player.grounded || player.currentSurface === 'grass') return undefined

  const pointCount = race.path.points.length
  if (pointCount < 2) return undefined
  const playerProgress = raceProgress(player, pointCount, race.startPathIndex, race.reversed)
  let closestRival = Number.NEGATIVE_INFINITY
  for (const rival of race.vehicles) {
    if (rival.player) continue
    if (rival.finishedAt !== null) return undefined
    if (rival.wrecked) continue
    closestRival = Math.max(closestRival,
      raceProgress(rival, pointCount, race.startPathIndex, race.reversed))
  }
  if (closestRival === Number.NEGATIVE_INFINITY) return undefined

  // Road samples are evenly spaced. Fade the assist before the closest rival
  // gets near enough to challenge the leader.
  const sampleSpacing = race.path.totalLength / (race.path.closed ? pointCount : pointCount - 1)
  const lead = (playerProgress - closestRival) * sampleSpacing
  if (lead <= MINIMUM_LEAD) return undefined
  const strength = clamp((lead - MINIMUM_LEAD) / (LEAD_FOR_FULL_BONUS - MINIMUM_LEAD), 0, 1)
  const multiplier = 1 + MAX_SPEED_BONUS * strength
  return { multiplier, ceiling: player.speed * multiplier }
}
