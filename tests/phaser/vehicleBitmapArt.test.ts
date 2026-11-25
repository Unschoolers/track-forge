import { describe, expect, it, vi } from 'vitest'
import { CAR_IDS, type CarId } from '@/domain/model'
import { getVehicleBitmap, loadVehicleBitmapArt, vehicleBitmapBounds, vehicleBitmapUrl } from '@/presentation/vehicleBitmapArt'
import { drawVehicleArtworkOnCanvas } from '@/presentation/vehicleArtwork'

describe('shared vehicle bitmap assets', () => {
  it('loads once and paints the exact registered bitmap in the flyover', async () => {
    const dimensions: Record<CarId, number> = { blue: 374, red: 324, green: 448, yellow: 363 }
    const created: TestImage[] = []
    class TestImage {
      onload: (() => void) | undefined
      onerror: (() => void) | undefined
      naturalWidth = 768
      naturalHeight = 0
      constructor() { created.push(this) }
      set src(url: string) {
        const car = CAR_IDS.find(id => vehicleBitmapUrl(id) === url)
        if (!car) throw new Error('Unexpected image URL')
        this.naturalHeight = dimensions[car]
        this.onload?.()
      }
    }
    vi.stubGlobal('Image', TestImage)
    try {
      const loading = loadVehicleBitmapArt()
      expect(loadVehicleBitmapArt()).toBe(loading)
      await loading
      expect(created).toHaveLength(4)
      const drawImage = vi.fn()
      const ctx = { drawImage } as unknown as CanvasRenderingContext2D
      for (const car of CAR_IDS) {
        const bitmap = getVehicleBitmap(car)
        expect(bitmap).toBeDefined()
        const bounds = vehicleBitmapBounds(car)
        drawVehicleArtworkOnCanvas(ctx, car)
        expect(drawImage).toHaveBeenLastCalledWith(bitmap, bounds.x, bounds.y, bounds.width, bounds.height)
      }
      expect(drawImage).toHaveBeenCalledTimes(4)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
