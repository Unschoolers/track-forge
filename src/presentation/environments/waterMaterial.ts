import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'

export const WATER_TEXTURE_SIZE = 256
type RGB = readonly [number, number, number]
interface WaterStyle {
  readonly day: RGB
  readonly night: RGB
  readonly ripple: number
  readonly caustics: number
}

const styles: Record<TrackEnvironmentId, WaterStyle> = {
  grass: { day: [28, 112, 125], night: [22, 62, 80], ripple: 0.7, caustics: 1 },
  desert: { day: [32, 155, 158], night: [25, 83, 98], ripple: 0.52, caustics: 1.1 },
  cityscape: { day: [31, 85, 112], night: [17, 44, 65], ripple: 1, caustics: 0.35 },
  'kids-room': { day: [163, 62, 101], night: [79, 36, 68], ripple: 0.38, caustics: 0.55 },
}

const TAU = Math.PI * 2

/** Periodic multiscale waves and refracted light, authored at native
 * resolution rather than interpolating the old tiny bitmap. All coordinates
 * wrap exactly; no random speckles or high-contrast repeated objects. */
export function waterMaterialPixels(environment: TrackEnvironmentId, night: boolean): Uint8ClampedArray {
  const style = styles[environment]
  const base = night ? style.night : style.day
  const pixels = new Uint8ClampedArray(WATER_TEXTURE_SIZE * WATER_TEXTURE_SIZE * 4)
  const light = night ? 0.6 : 1
  for (let y = 0; y < WATER_TEXTURE_SIZE; y++) {
    const v = y / (WATER_TEXTURE_SIZE - 1) * TAU
    for (let x = 0; x < WATER_TEXTURE_SIZE; x++) {
      const u = x / (WATER_TEXTURE_SIZE - 1) * TAU
      const distortion = Math.sin(2 * u + v) * 0.62 + Math.sin(u - 3 * v) * 0.3
      const swell = Math.sin(2 * u + 3 * v) * 5 + Math.cos(3 * u - v) * 4
      const waves = Math.sin(3 * u + 11 * v + distortion) * 8 +
        Math.cos(8 * u - 17 * v + 1.2 * distortion) * 3.5 +
        Math.sin(17 * u + 29 * v) * 1.6
      const a = Math.sin(5 * u + 7 * v + distortion * 1.7)
      const b = Math.sin(9 * u - 4 * v + Math.cos(u + 2 * v))
      const caustic = Math.pow(Math.max(0, 1 - Math.abs(a * b) * 1.7), 8) * 24
      const value = (swell + waves * style.ripple + caustic * style.caustics) * light
      const index = (y * WATER_TEXTURE_SIZE + x) * 4
      pixels[index] = base[0] + value * 0.75
      pixels[index + 1] = base[1] + value
      pixels[index + 2] = base[2] + value * 1.05
      pixels[index + 3] = 255
    }
  }
  return pixels
}
