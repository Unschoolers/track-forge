import type { SurfaceId } from '@/domain/model'
import type { RoadPathPoint } from '@/domain/track/pathBuilder'
import type { RoadMaterialStroke } from './kidsRoomRoadStrokes'

type Point = Pick<RoadPathPoint, 'x' | 'y' | 'distance'>
const CELLS = 8
const CELL_LENGTH = 24
export const MEADOW_ROAD_TILE_LENGTH = CELLS * CELL_LENGTH

/** A repeating, path-space vector material tile. Lane paint is deliberately
 * not baked in. Every motif has a longitudinal offset and lateral position;
 * both follow the local road tangent, rather than rotating a world-space image.
 * Five marks per cell keeps static ribbon batches within their existing budget. */
export function meadowRoadTileStrokes(
  surface: SurfaceId, from: Point, to: Point, night: boolean, loopLength?: number,
): readonly RoadMaterialStroke[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const span = to.distance - from.distance
  if (length < 0.001 || span <= 0 ||
    ![from.x, from.y, from.distance, to.x, to.y, to.distance].every(Number.isFinite)) return []
  const cellLength = loopLength !== undefined && Number.isFinite(loopLength) && loopLength >= MEADOW_ROAD_TILE_LENGTH / 2
    ? loopLength / (Math.max(1, Math.round(loopLength / MEADOW_ROAD_TILE_LENGTH)) * CELLS)
    : CELL_LENGTH
  const first = Math.floor(from.distance / cellLength) + 1
  const last = Math.min(Math.floor(to.distance / cellLength + 1e-9), first + 31)
  const tx = dx / length
  const ty = dy / length
  const strokes: RoadMaterialStroke[] = []
  for (let mark = first; mark <= last; mark++) {
    const slot = ((mark % CELLS) + CELLS) % CELLS
    const t = Math.min(1, (mark * cellLength - from.distance) / span)
    const x = from.x + dx * t
    const y = from.y + dy * t
    const across = ((slot * 17 + 5) % 43) - 21
    const draw = (a: number, b: number, c: number, d: number, color: number, alpha: number, width: number) => {
      strokes.push({
        start: { x: x + tx * a - ty * b, y: y + ty * a + tx * b },
        end: { x: x + tx * c - ty * d, y: y + ty * c + tx * d },
        color, alpha, width,
      })
    }
    if (surface === 'street') {
      const dark = night ? 0x181f26 : 0x2b3036
      const light = night ? 0x71808b : 0x959c9c
      draw(-5, across, -2, across + 1, dark, 0.6, 1.5)
      draw(1, across - 4, 3, across - 3, light, 0.48, 1.4)
      draw(-6, -across, -4, -across + 2, light, 0.36, 1.1)
      draw(4, -across + 5, 6, -across + 5, dark, 0.44, 1.4)
      draw(-4, 29, 6, 30, night ? 0x635f51 : 0xa2977b, 0.32, 1.5)
    } else if (surface === 'dirt') {
      const dark = night ? 0x30291f : 0x68472d
      const light = night ? 0x937b57 : 0xe2b77b
      draw(-10, -17, 10, -17 + (slot % 2), dark, 0.48, 4)
      draw(-10, 17, 10, 17 - (slot % 2), dark, 0.48, 4)
      draw(-8, -13, 8, -13, light, 0.46, 1.6)
      draw(-8, 13, 8, 13, light, 0.46, 1.6)
      draw(-2, across, 1, across + 2, light, 0.68, 2.1)
    } else {
      const dark = night ? 0x395e75 : 0x6fa9bf
      const light = night ? 0xa1d0e3 : 0xf2fcff
      draw(-10, across - 3, 2, across + 1, dark, 0.58, 2)
      draw(2, across + 1, 8, across + 7, light, 0.68, 1.4)
      draw(2, across + 1, 6, across - 5, light, 0.48, 1.2)
      draw(-8, -across, 8, -across + 2, light, 0.38, 1.5)
      draw(-7, -28, 6, -27, light, 0.47, 1.8)
    }
  }
  return strokes
}
