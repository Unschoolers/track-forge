import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { getTrackEnvironment } from '@/presentation/environments'
import { createTrackPreview } from '@/ui/modals/trackPreview'

describe('track preview environment', () => {
  it('preserves grass styling and tints themed previews', () => {
    const track = createStarterTrack(asTrackId('preview'), 1)
    const path = new TrackGeometryService().get(track).path
    expect(createTrackPreview(path).style.backgroundColor).toBe('')
    for (const environment of ['cityscape', 'desert'] as const) {
      const expected = document.createElement('div')
      expected.style.backgroundColor = getTrackEnvironment(environment).day.flyoverGround
      expect(createTrackPreview(path, track.points[0], environment).style.backgroundColor).toBe(expected.style.backgroundColor)
    }
  })
})
