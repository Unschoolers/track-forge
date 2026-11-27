import { ROAD_GEOMETRY } from '@/domain/config'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'

/** Only an actual forward sweep across the supported ramp's finite lip launches a car. */
export function findJumpTakeoff(
  path: RoadPath,
  previous: Pick<RaceVehicle, 'x' | 'y' | 'grounded' | 'pathIndex'>,
  moved: Pick<RaceVehicle, 'x' | 'y' | 'vx' | 'vy'>,
  previousRunId: string | null,
): { readonly height: number; readonly grade: number } | undefined {
  if (!previous.grounded || !previousRunId?.startsWith('jump:')) return undefined
  const lip = path.roadSurface.jumpLips.find(candidate => candidate.runId === previousRunId)
  if (!lip || lip.grade <= 0) return undefined
  const delta = Math.abs(previous.pathIndex - lip.beforeIndex)
  if ((path.closed ? Math.min(delta, path.points.length - delta) : delta) > 12) return undefined
  const { center, tangent } = lip
  const along = (point: { x: number; y: number }) => (point.x - center.x) * tangent.x + (point.y - center.y) * tangent.y
  const before = along(previous)
  const after = along(moved)
  if (before >= 0 || after < 0 || moved.vx * tangent.x + moved.vy * tangent.y <= 0) return undefined
  const fraction = -before / (after - before)
  const x = previous.x + (moved.x - previous.x) * fraction - center.x
  const y = previous.y + (moved.y - previous.y) * fraction - center.y
  if (Math.abs(-x * tangent.y + y * tangent.x) > ROAD_GEOMETRY.surfaceWidth / 2) return undefined
  return { height: lip.height, grade: lip.grade }
}
