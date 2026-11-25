import { CAR_SPECS } from '@/domain/config'
import type { CarId, Vector2 } from '@/domain/model'
import { getVehicleBitmap, vehicleBitmapBounds } from './vehicleBitmapArt'

/** Purely cosmetic size shared by real races and the setup flyover. */
export const VEHICLE_VISUAL_SCALE = 0.88

/**
 * Single visual authority for race and setup flyover. Local +X is the nose.
 * These are presentation polygons only: physics, collisions and car ratings
 * remain owned by the race domain.
 */
export type VehicleBodyStyle = 'sport' | 'muscle' | 'rally' | 'pickup'
export type VehiclePaintTone =
  | 'rubber' | 'body' | 'bodyLight' | 'bodyDark' | 'glass'
  | 'glassLight' | 'trim' | 'bed' | 'metal' | 'stripe'

export interface VehiclePaintLayer {
  readonly tone: VehiclePaintTone
  readonly points: readonly Vector2[]
  readonly outline?: boolean
  readonly alpha?: number
}

export interface VehicleArtwork {
  readonly id: CarId
  readonly style: VehicleBodyStyle
  readonly body: readonly Vector2[]
  readonly cabin: readonly Vector2[]
  readonly headlights: readonly [Vector2, Vector2]
  readonly taillights: readonly [Vector2, Vector2]
  /** Maintains the existing shadow projection proportions, not wheel physics. */
  readonly wheelbase: number
  readonly layers: readonly VehiclePaintLayer[]
}

function poly(...values: number[]): readonly Vector2[] {
  if (values.length % 2 !== 0) throw new Error('Vehicle polygon requires coordinate pairs')
  const points: Vector2[] = []
  for (let i = 0; i < values.length; i += 2) {
    const x = values[i]
    const y = values[i + 1]
    if (x === undefined || y === undefined) throw new Error('Invalid vehicle polygon coordinate')
    points.push({ x, y })
  }
  return points
}

function rect(left: number, top: number, right: number, bottom: number): readonly Vector2[] {
  return poly(left, top, right, top, right, bottom, left, bottom)
}

function part(tone: VehiclePaintTone, points: readonly Vector2[], outline = false): VehiclePaintLayer {
  return { tone, points, outline }
}

interface CarBlueprint {
  readonly style: VehicleBodyStyle
  readonly body: readonly Vector2[]
  readonly cabin: readonly Vector2[]
  readonly windshield: readonly Vector2[]
  readonly rearGlass: readonly Vector2[]
  readonly wheelX: readonly [number, number]
  readonly wheelY: number
  readonly headlights: readonly [Vector2, Vector2]
  readonly taillights: readonly [Vector2, Vector2]
  readonly wheelbase: number
  readonly details: readonly VehiclePaintLayer[]
}

const BLUEPRINTS: Record<CarId, CarBlueprint> = {
  blue: {
    style: 'sport',
    // Low pointed nose, tapered rear and narrow coupe cockpit.
    body: poly(-20, -5, -16, -8, 9, -8, 17, -6, 22, -3, 22, 3, 17, 6, 9, 8, -16, 8, -20, 5),
    cabin: poly(-10, -6, 4, -6, 9, -4, 9, 4, 4, 6, -10, 6, -13, 4, -13, -4),
    windshield: poly(4, -5, 9, -3.5, 9, 3.5, 4, 5),
    rearGlass: poly(-12, -3.5, -9, -5, -9, 5, -12, 3.5),
    wheelX: [-13, 13], wheelY: 9,
    headlights: [{ x: 19, y: -4 }, { x: 19, y: 4 }],
    taillights: [{ x: -19, y: -4 }, { x: -19, y: 4 }],
    wheelbase: 11,
    details: [
      part('bodyLight', poly(8, -7, 15, -5.3, 19, -2.5, 11, -3.7)),
      part('bodyDark', poly(9, 5.5, 17, 4.5, 19, 3, 10, 3.7)),
      part('stripe', rect(13, -1, 19, 1)),
      part('trim', rect(-19, -7, -17, 7)), // rear lip spoiler
    ],
  },
  red: {
    style: 'muscle',
    // Broad square shoulders and long aggressive hood; short set-back roof.
    body: poly(-22, -7, -20, -9, -12, -10, 12, -10, 19, -8, 23, -6, 23, 6, 19, 8, 12, 10, -12, 10, -20, 9, -22, 7),
    cabin: poly(-12, -7, 2, -7, 7, -5, 7, 5, 2, 7, -12, 7),
    windshield: poly(2, -6.5, 7, -4.5, 7, 4.5, 2, 6.5),
    rearGlass: poly(-11, -5.5, -7.5, -5.5, -7.5, 5.5, -11, 5.5),
    wheelX: [-15, 16], wheelY: 11,
    headlights: [{ x: 21, y: -5 }, { x: 21, y: 5 }],
    taillights: [{ x: -20.5, y: -6 }, { x: -20.5, y: 6 }],
    wheelbase: 12,
    details: [
      part('bodyLight', poly(8, -8, 20, -6.5, 20, -4.7, 8, -6.2)),
      part('bodyDark', poly(8, 6.2, 20, 4.7, 20, 6.5, 8, 8)),
      part('stripe', rect(11, -1.6, 20, 1.6)),
      part('trim', rect(21, -3, 22.5, 3)),
      part('bodyDark', rect(-20, -1, -14, 1)),
    ],
  },
  green: {
    style: 'rally',
    // Tall practical hatch with broad fenders and large rear glazing.
    body: poly(-18, -9, -15, -11, 9, -11, 16, -8, 18, -6, 18, 6, 16, 8, 9, 11, -15, 11, -18, 9),
    cabin: poly(-13, -8.5, 5, -8.5, 11, -6, 11, 6, 5, 8.5, -13, 8.5),
    windshield: poly(5, -7.5, 11, -5.5, 11, 5.5, 5, 7.5),
    rearGlass: poly(-12, -7, -8, -7, -8, 7, -12, 7),
    wheelX: [-12, 12], wheelY: 12,
    headlights: [{ x: 16, y: -5 }, { x: 16, y: 5 }],
    taillights: [{ x: -16, y: -7 }, { x: -16, y: 7 }],
    wheelbase: 10,
    details: [
      part('bodyLight', poly(12, -7.5, 16, -5, 16, -3, 12, -5)),
      part('bodyDark', poly(12, 5, 16, 3, 16, 5, 12, 7.5)),
      part('trim', rect(-18, -9.3, -16, 9.3)),
      part('stripe', rect(-6, -1, 3, 1)),
    ],
  },
  yellow: {
    style: 'pickup',
    // Real open bed behind the short cab: not a stretched sedan.
    body: poly(-25, -8, -23, -11, 14, -11, 21, -8.5, 24, -7, 24, 7, 21, 8.5, 14, 11, -23, 11, -25, 8),
    cabin: poly(-7, -9, 8, -9, 12, -7, 12, 7, 8, 9, -7, 9),
    windshield: poly(8, -8, 12, -6, 12, 6, 8, 8),
    rearGlass: poly(-7, -7, -4.5, -7, -4.5, 7, -7, 7),
    wheelX: [-17, 16], wheelY: 12,
    headlights: [{ x: 22, y: -6 }, { x: 22, y: 6 }],
    taillights: [{ x: -23, y: -7 }, { x: -23, y: 7 }],
    wheelbase: 13,
    details: [
      part('bodyDark', rect(-23, -9.5, -8.5, 9.5)), // cargo bed recess
      part('bed', rect(-21, -7.5, -10, 7.5)),
      part('trim', rect(-22, -8, -20.5, 8)),
      part('metal', rect(-19, -5, -18.3, 5)),
      part('metal', rect(-15, -5, -14.3, 5)),
      part('metal', rect(-11, -5, -10.3, 5)),
      part('bodyLight', poly(13, -9, 21, -6.8, 21, -4.5, 13, -6.5)),
      part('bodyDark', poly(13, 6.5, 21, 4.5, 21, 6.8, 13, 9)),
      part('trim', rect(22, -3, 23.5, 3)),
    ],
  },
}

function makeArtwork(id: CarId): VehicleArtwork {
  const design = BLUEPRINTS[id]
  const wheel = (x: number, y: number) => part('rubber', rect(x - 3.5, y - 3, x + 3.5, y + 3))
  const [rearWheel, frontWheel] = design.wheelX
  // Only the pickup has exposed tires; car silhouettes stay clean at mobile zoom.
  const wheels = id === 'yellow'
    ? [
        wheel(rearWheel, -design.wheelY), wheel(rearWheel, design.wheelY),
        wheel(frontWheel, -design.wheelY), wheel(frontWheel, design.wheelY),
      ]
    : []
  return {
    id,
    style: design.style,
    body: design.body,
    cabin: design.cabin,
    headlights: design.headlights,
    taillights: design.taillights,
    wheelbase: design.wheelbase,
    layers: [
      ...wheels,
      part('bodyDark', design.body, true),
      part('body', design.body),
      ...design.details,
      part('glass', design.cabin, true),
      part('glassLight', design.windshield),
      part('glassLight', design.rearGlass),
      part('trim', poly(-3, -design.wheelY + 2, 4, -design.wheelY + 2, 4, -design.wheelY + 3, -3, -design.wheelY + 3)),
    ],
  }
}

const ARTWORK: Record<CarId, VehicleArtwork> = {
  blue: makeArtwork('blue'),
  red: makeArtwork('red'),
  green: makeArtwork('green'),
  yellow: makeArtwork('yellow'),
}

function mix(a: number, b: number, amount: number): number {
  const blend = (shift: number) => Math.round(
    ((a >> shift) & 0xff) * (1 - amount) + ((b >> shift) & 0xff) * amount,
  )
  return (blend(16) << 16) | (blend(8) << 8) | blend(0)
}

function palette(car: CarId): Record<VehiclePaintTone, number> {
  const body = Number.parseInt(CAR_SPECS[car].color.slice(1), 16)
  return {
    rubber: 0x101923,
    body,
    bodyLight: mix(body, 0xffffff, 0.3),
    bodyDark: mix(body, 0x10202b, 0.42),
    glass: 0x223849,
    glassLight: 0x9cc3d1,
    trim: 0x15232e,
    bed: 0x3b4952,
    metal: 0x637781,
    stripe: mix(body, 0xffffff, 0.6),
  }
}

const PALETTES: Record<CarId, Record<VehiclePaintTone, number>> = {
  blue: palette('blue'), red: palette('red'),
  green: palette('green'), yellow: palette('yellow'),
}

export function getVehicleArtwork(car: CarId): VehicleArtwork {
  return ARTWORK[car]
}

export function vehiclePaintColor(car: CarId, tone: VehiclePaintTone): number {
  return PALETTES[car][tone]
}

/** The setup flyover paints the exact shapes and colors used by Phaser races. */
export function drawVehicleArtworkOnCanvas(
  ctx: CanvasRenderingContext2D,
  car: CarId,
  braking = false,
): void {
  const art = getVehicleArtwork(car)
  const bitmap = getVehicleBitmap(car)
  if (bitmap) {
    const bounds = vehicleBitmapBounds(car)
    ctx.drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height)
    if (braking) {
      for (const lamp of art.taillights) {
        ctx.beginPath()
        ctx.arc(lamp.x, lamp.y, 2.1, 0, Math.PI * 2)
        ctx.fillStyle = '#ff3038'
        ctx.fill()
      }
    }
    return
  }
  for (const layer of art.layers) {
    const color = vehiclePaintColor(car, layer.tone).toString(16).padStart(6, '0')
    ctx.beginPath()
    layer.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.closePath()
    ctx.globalAlpha = layer.alpha ?? 1
    ctx.fillStyle = `#${color}`
    ctx.fill()
    if (layer.outline) {
      ctx.strokeStyle = '#101923'
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
  for (const lamp of art.headlights) {
    ctx.beginPath()
    ctx.arc(lamp.x, lamp.y, 1.7, 0, Math.PI * 2)
    ctx.fillStyle = '#eaf7ff'
    ctx.fill()
  }
  for (const lamp of art.taillights) {
    ctx.beginPath()
    ctx.arc(lamp.x, lamp.y, braking ? 2.1 : 1.5, 0, Math.PI * 2)
    ctx.fillStyle = braking ? '#ff3038' : '#5b1620'
    ctx.fill()
  }
}
