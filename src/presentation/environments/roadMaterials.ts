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
    road: '#637e96', edge: '#e0c9aa', stripe: '#fff2bf',
    nightRoad: '#344556', nightEdge: '#877c7b', nightStripe: '#e1d3a7',
  },
  dirt: {
    road: '#b48965', edge: '#e4bd83', stripe: '#f8ddb0',
    nightRoad: '#69513f', nightEdge: '#a58a69', nightStripe: '#d4b895',
  },
  ice: {
    road: '#77ced0', edge: '#dcf7eb', stripe: '#faffdf',
    nightRoad: '#376e7e', nightEdge: '#8bc4c5', nightStripe: '#d6f5e6',
  },
}

export function roadColorsForEnvironment(surface: SurfaceId, environmentId: TrackEnvironmentId = 'grass'): RoadColors {
  return environmentId === 'kids-room' ? KIDS_ROOM_ROADS[surface] : SURFACE_SPECS[surface]
}
