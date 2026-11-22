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
 * authoritative SURFACE_SPECS physics, regardless of environment decoration.
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

const DESERT_ROADS: Readonly<Record<SurfaceId, RoadColors>> = {
  street: {
    road: '#5c554e', edge: '#dfc59f', stripe: '#f6d684',
    nightRoad: '#393636', nightEdge: '#8d7760', nightStripe: '#d2b67e',
  },
  dirt: {
    road: '#aa7a46', edge: '#d8b47b', stripe: '#f4db9f',
    nightRoad: '#644a35', nightEdge: '#9e825e', nightStripe: '#c5a57b',
  },
  ice: {
    road: '#b6d8da', edge: '#edf4ec', stripe: '#ffffff',
    nightRoad: '#668b9b', nightEdge: '#a2c1c8', nightStripe: '#e5f5f8',
  },
}

const CITY_ROADS: Readonly<Record<SurfaceId, RoadColors>> = {
  street: {
    road: '#444e57', edge: '#aeb7b7', stripe: '#f2da78',
    nightRoad: '#293741', nightEdge: '#6f858e', nightStripe: '#f0ca73',
  },
  dirt: {
    road: '#77746b', edge: '#b1aaa0', stripe: '#cfc7ac',
    nightRoad: '#454947', nightEdge: '#747e7d', nightStripe: '#a4a59a',
  },
  ice: {
    road: '#89c4d2', edge: '#d4e9e9', stripe: '#ffffff',
    nightRoad: '#426f83', nightEdge: '#93bdc8', nightStripe: '#e4f3fa',
  },
}

export function roadColorsForEnvironment(surface: SurfaceId, environmentId: TrackEnvironmentId = 'grass'): RoadColors {
  switch (environmentId) {
    case 'kids-room': return KIDS_ROOM_ROADS[surface]
    case 'desert': return DESERT_ROADS[surface]
    case 'cityscape': return CITY_ROADS[surface]
    case 'grass': return SURFACE_SPECS[surface]
  }
}
