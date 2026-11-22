import { SURFACE_SPECS } from '@/domain/config'
import type { SurfaceId } from '@/domain/model'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'

interface RoadColors {
  readonly road: string
  readonly edge: string
  readonly stripe: string
  readonly nightRoad: string
  readonly nightEdge: string
  readonly nightStripe: string
}

/**
 * Visual skins only. Vehicle grip, speed and road topology always use the
 * authoritative SURFACE_SPECS physics, regardless of bedroom decoration.
 */
const KIDS_ROOM_ROADS: Readonly<Record<SurfaceId, RoadColors>> = {
  street: {
    road: '#526d8d', edge: '#d9c29d', stripe: '#ffe5a9',
    nightRoad: '#2d4361', nightEdge: '#a18e7e', nightStripe: '#f4d4a0',
  },
  dirt: {
    road: '#bd946c', edge: '#ebc89c', stripe: '#f8e4c2',
    nightRoad: '#71583f', nightEdge: '#b89b76', nightStripe: '#e4c8a5',
  },
  ice: {
    road: '#66bfd6', edge: '#d7f2fa', stripe: '#f6ffff',
    nightRoad: '#2d668a', nightEdge: '#85c3d7', nightStripe: '#daeffa',
  },
}

export function roadColorsForEnvironment(surface: SurfaceId, environmentId: TrackEnvironmentId = 'grass'): RoadColors {
  return environmentId === 'kids-room' ? KIDS_ROOM_ROADS[surface] : SURFACE_SPECS[surface]
}
