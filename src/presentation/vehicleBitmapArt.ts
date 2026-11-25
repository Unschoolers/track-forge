import { CAR_IDS, type CarId } from '@/domain/model'
import blueUrl from '@/assets/vehicles/blue.webp?url&no-inline'
import redUrl from '@/assets/vehicles/red.webp?url&no-inline'
import greenUrl from '@/assets/vehicles/green.webp?url&no-inline'
import yellowUrl from '@/assets/vehicles/yellow.webp?url&no-inline'

/** Cropped transparent source pixels; the original world-space length is retained. */
const ART = {
  blue: { url: blueUrl, pixels: [768, 374], length: 42, centerX: 1 },
  red: { url: redUrl, pixels: [768, 324], length: 45, centerX: 0.5 },
  green: { url: greenUrl, pixels: [768, 448], length: 36, centerX: 0 },
  yellow: { url: yellowUrl, pixels: [768, 363], length: 49, centerX: -0.5 },
} as const satisfies Record<CarId, { url: string; pixels: readonly [number, number]; length: number; centerX: number }>

export function vehicleBitmapUrl(car: CarId): string {
  return ART[car].url
}

export function vehicleBitmapBounds(car: CarId): { x: number; y: number; width: number; height: number } {
  const { pixels, length, centerX } = ART[car]
  const height = length * pixels[1] / pixels[0]
  return { x: centerX - length / 2, y: -height / 2, width: length, height }
}

let artwork: ReadonlyMap<CarId, HTMLImageElement> | undefined
let loading: Promise<void> | undefined

/** Decode and validate once at startup, before either presentation can paint. */
export function loadVehicleBitmapArt(): Promise<void> {
  loading ??= Promise.all(CAR_IDS.map(car => new Promise<readonly [CarId, HTMLImageElement]>((resolve, reject) => {
    const image = new Image()
    const [width, height] = ART[car].pixels
    image.onload = () => {
      if (image.naturalWidth !== width || image.naturalHeight !== height) {
        reject(new Error(`Unexpected vehicle artwork dimensions for ${car}`))
        return
      }
      resolve([car, image])
    }
    image.onerror = () => reject(new Error(`Could not load vehicle artwork for ${car}`))
    image.src = vehicleBitmapUrl(car)
  }))).then(images => { artwork = new Map(images) })
  return loading
}

/** Undefined only before boot, allowing isolated vector geometry tests. */
export function getVehicleBitmap(car: CarId): HTMLImageElement | undefined {
  if (!artwork) return undefined
  const image = artwork.get(car)
  if (!image) throw new Error(`Missing vehicle artwork for ${car}`)
  return image
}
