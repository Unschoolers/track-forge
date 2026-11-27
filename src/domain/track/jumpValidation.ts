import { ROAD_GEOMETRY } from '@/domain/config'
import type { Track, TrackPoint } from '@/domain/model'
import { buildRoadPath, trackPointSectionId, type RoadPath } from '@/domain/track/pathBuilder'
import { findRoadWaterExposure } from '@/domain/track/waterExposure'
import { EXTRA_NEARBY_GRID } from '@/domain/race/startGrid'

const cache = new WeakMap<readonly TrackPoint[], { terrain: Track['terrain']; routeKind: Track['routeKind']; path: RoadPath }>()
const MAX_GRID_BACK = Math.max(...ROAD_GEOMETRY.startGrid.map(grid => grid.back), ...EXTRA_NEARBY_GRID.map(grid => grid.back))

/** Only jump tracks need the additional geometry checks; ordinary tracks keep their existing path. */
export function jumpValidationMessage(track: Track, compiledPath?: RoadPath): string | undefined {
  if (!track.points.some(point => point.structure === 'jump')) return undefined
  if (track.routeKind !== 'point-to-point' && track.start?.reversed) return 'Jump ramps must be raced in the forward direction.'
  let path = compiledPath
  if (!path) {
    const cached = cache.get(track.points)
    if (cached && cached.terrain === track.terrain && cached.routeKind === track.routeKind) path = cached.path
    else {
      path = buildRoadPath(track.points, track.terrain, undefined, track.routeKind)
      cache.set(track.points, { terrain: track.terrain, routeKind: track.routeKind, path })
    }
  }
  const jumpSections = new Set(track.points.flatMap((point, index) =>
    point.structure === 'jump' ? [trackPointSectionId(point, index)] : []))
  const compiledSections = new Set(path.points.filter(point => point.structure === 'jump').map(point => point.sectionId))
  if ([...jumpSections].some(id => !compiledSections.has(id))) return 'A jump section is too short or has no outgoing road.'
  const lips = path.roadSurface.jumpLips
  const jumpRunIds = new Set(path.points.flatMap((point, index) => {
    if (point.structure !== 'jump') return []
    const id = path.roadSurface.at(index).structureRunId
    return id ? [id] : []
  }))
  if (!lips.length || jumpRunIds.size !== lips.length) return 'Each jump must end on ordinary surface road.'
  const byRun = new Map(lips.map(lip => [lip.runId, lip]))
  for (const lip of lips) {
    if (lip.length < ROAD_GEOMETRY.surfaceWidth || lip.grade <= 0) return 'Jump ramp is too short or does not rise toward its lip.'
    const approachIndex = lip.startIndex === 0 ? path.closed ? path.points.length - 1 : -1 : lip.startIndex - 1
    if (path.points[approachIndex]?.structure !== 'surface') return 'Place a jump after an ordinary road approach.'
    const lipDistance = path.points[lip.afterIndex]?.distance ?? 0
    if (!path.closed && path.totalLength - lipDistance < ROAD_GEOMETRY.surfaceWidth * 2) return 'Leave more landing road before the finish.'
  }
  const startDistance = path.closed ? path.totalLength * (track.start?.ratio ?? 0) : 0
  const jumpSegments = new Set<number>()
  for (const [index, point] of path.points.entries()) {
    if (point.structure !== 'jump') continue
    jumpSegments.add(point.segment)
    const lip = byRun.get(path.roadSurface.at(index).structureRunId ?? '')
    if (!lip) return 'Each jump needs a valid takeoff lip.'
    if (findRoadWaterExposure(path, index)) return 'Jump ramps must be placed on dry terrain.'
    const approachDistance = startDistance - point.distance
    const aheadOfGrid = path.closed ? (approachDistance + path.totalLength) % path.totalLength : approachDistance
    if (aheadOfGrid >= 0 && aheadOfGrid <= MAX_GRID_BACK + ROAD_GEOMETRY.surfaceWidth / 2) return 'Move the start grid away from the jump ramp.'
  }
  if (path.crossings.some(crossing => jumpSegments.has(crossing.firstSegment) || jumpSegments.has(crossing.secondSegment))) {
    return 'Jump ramps cannot overlap a road crossing.'
  }
  return undefined
}
