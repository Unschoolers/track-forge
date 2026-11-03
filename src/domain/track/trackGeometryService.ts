import type { Track } from '@/domain/model'
import {
  buildTrackGeometry,
  type TrackGeometry,
} from '@/domain/track/trackGeometry'
import {
  TrackGeometryCache,
  trackGeometrySignature,
} from '@/domain/track/trackGeometryCache'

export class TrackGeometryService {
  private readonly cache = new TrackGeometryCache()

  get<T extends Pick<Track, 'points' | 'start' | 'terrain'>>(
    track: T,
  ): TrackGeometry {
    let key: string | undefined
    const cached = this.cache.get(track, () => {
      key = trackGeometrySignature(track)
      return key
    })
    if (cached) return cached
    key ??= trackGeometrySignature(track)
    const geometry = buildTrackGeometry(track)
    this.cache.set(track, key, geometry)
    return geometry
  }

  clear(): void {
    this.cache.clear()
  }
}
