import { STARTER_TREES, TAU } from '@/domain/config'
import type { SurfaceId, Track, TrackId, TrackPoint } from '@/domain/model'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

export function createStarterTrack(id: TrackId, now: number): Track {
  const points: TrackPoint[] = []

  for (let index = 0; index <= 31; index += 1) {
    const angle = (index / 31) * TAU
    const wobble = 1 + 0.13 * Math.sin(angle * 3) + 0.05 * Math.cos(angle * 5)
    let surface: SurfaceId = 'street'
    if (index >= 8 && index < 14) {
      surface = 'dirt'
    } else if (index >= 20 && index < 25) {
      surface = 'ice'
    }
    points.push({
      x: Math.cos(angle) * 150 * wobble,
      y: 10 + Math.sin(angle) * 235,
      surface,
      id: `point-${index}`,
      curve: 'smooth',
      tension: 0.5,
    })
  }

  return {
    id,
    name: 'Starter Circuit',
    version: 8,
    points,
    trees: STARTER_TREES.map((tree) => ({ ...tree })),
    terrain: EMPTY_TERRAIN,
    start: { ratio: 0, reversed: false },
    lighting: 'day',
    createdAt: now,
    updatedAt: now,
  }
}
