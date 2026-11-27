import { describe, expect, it } from 'vitest'
import { HILL_FIELD_PADDING, HILL_FIELD_STEP, hillMaterialWeights, smoothHillField } from '@/presentation/environments/hillMaterialField'

function raster(width: number, height: number, pixel: (x: number, y: number) => readonly number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  }
  return data
}

describe('continuous mountain material field', () => {
  it('turns a hard slope and lighting step into a gradual transition', () => {
    const width = 40
    const source = raster(width, 1, x => x < 20 ? [255, 255, 0, 255] : [0, 0, 0, 255])
    const result = smoothHillField(source, width, 1)
    const at = (x: number) => hillMaterialWeights(result, x * 4)
    expect(at(0).rock).toBe(1)
    expect(at(39).rock).toBe(0)
    expect(at(17).rock).toBeGreaterThan(at(19).rock)
    expect(at(19).rock).toBeGreaterThan(at(21).rock)
    expect(at(21).rock).toBeGreaterThan(0)
    expect(at(19).light).toBe(at(19).rock)
    expect(at(19).coverage).toBe(1)
  })

  it('feathers the foot without introducing color from transparent ground', () => {
    const data = raster(40, 1, x => x < 20 ? [0, 255, 0, 0] : [255, 0, 0, 255])
    const result = smoothHillField(data, 40, 1)
    const at = (x: number) => hillMaterialWeights(result, x * 4)
    expect(at(0).coverage).toBe(0)
    expect(at(20).coverage).toBeGreaterThan(0)
    expect(at(20).coverage).toBeLessThan(at(24).coverage)
    expect(at(39).coverage).toBe(1)
    expect(at(20).light).toBe(0)
    expect(at(20).rock).toBe(1)
  })

  it('produces the same samples across separately baked padded tiles', () => {
    const tile = 64
    const pad = HILL_FIELD_PADDING / HILL_FIELD_STEP
    const size = tile + 2 * pad
    const pixel = (x: number, y: number) => x + y < 100 ? [255, 0, 220, 255] : [0, 0, 0, 255]
    const left = smoothHillField(raster(size, size, (x, y) => pixel(x - pad, y - pad)), size, size)
    const right = smoothHillField(raster(size, size, (x, y) => pixel(x + tile - pad, y - pad)), size, size)
    // Compare the overlapping world samples on both sides of the tile seam.
    for (let y = pad; y < pad + tile; y++) {
      for (let dx = -1; dx <= 1; dx++) {
        const a = (y * size + pad + tile + dx) * 4
        const b = (y * size + pad + dx) * 4
        expect(left.slice(a, a + 4)).toEqual(right.slice(b, b + 4))
      }
    }
  })
})
