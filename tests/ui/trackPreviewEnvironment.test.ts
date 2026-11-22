// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { createTrackPreview } from '@/ui/modals/trackPreview'

describe('track preview presentation', () => {
  it('keeps every environment transparent while showing the entire neon circuit', () => {
    const track = createStarterTrack(asTrackId('preview'), 1)
    const path = new TrackGeometryService().get(track).path
    const defaultPreview = createTrackPreview(path)
    expect(defaultPreview.style.backgroundColor).toBe('')
    expect(defaultPreview.querySelectorAll('path')).toHaveLength(2)
    expect(defaultPreview.querySelector('.track-preview-halo')?.getAttribute('d'))
      .toBe(defaultPreview.querySelector('.track-preview-route')?.getAttribute('d'))
    expect(defaultPreview.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    for (const environment of ['grass', 'cityscape', 'desert'] as const) {
      const preview = createTrackPreview(path, track.points[0], environment)
      expect(preview.style.backgroundColor).toBe('')
      expect(preview.dataset.environment).toBe(environment)
      expect(preview.getAttribute('viewBox')).toBe(defaultPreview.getAttribute('viewBox'))
    }
  })
})
