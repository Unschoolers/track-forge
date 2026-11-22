import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { CITYSCAPE_ENVIRONMENT } from './cityscape'
import { DESERT_ENVIRONMENT } from './desert'
import { GRASS_ENVIRONMENT, GRASS_SCENERY, getGrassTexture } from './grass'
import { KIDS_ROOM_ENVIRONMENT } from './kidsRoom'
import type { TrackEnvironmentDefinition } from './types'

const grass: TrackEnvironmentDefinition = {
  label: 'Grass', ...GRASS_ENVIRONMENT, scenery: GRASS_SCENERY,
  groundArt: (variant, night) => getGrassTexture(variant, night).map((mark) => ({ kind: 'ellipse' as const, ...mark })),
}

export function getTrackEnvironment(id?: TrackEnvironmentId): TrackEnvironmentDefinition {
  return id === 'cityscape' ? CITYSCAPE_ENVIRONMENT : id === 'desert' ? DESERT_ENVIRONMENT : id === 'kids-room' ? KIDS_ROOM_ENVIRONMENT : grass
}
