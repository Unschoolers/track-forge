import type { Vector2 } from '@/domain/model'
import type { RoadRibbonQuad } from './roadRibbonQuads'

const DAY = ['#e84a43', '#f5bf35', '#3d8fd2'] as const
const NIGHT = ['#9e4248', '#b18b40', '#32658f'] as const
const NOMINAL_SPACING = 18

export interface ToyRoadBrick {
  readonly polygon: readonly [Vector2, Vector2, Vector2, Vector2]
  readonly color: string
  readonly stud?: Vector2
}

/** Fit an entire red/yellow/blue sequence to a closed circuit. */
export function toyBrickSpacing(length: number, closed: boolean): number {
  return closed && length > 0
    ? length / (3 * Math.max(1, Math.round(length / (3 * NOMINAL_SPACING))))
    : NOMINAL_SPACING
}

function lerp(a: Vector2, b: Vector2, t: number): Vector2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Decorative plastic fragments follow the actual shoulder quad, not an
 * approximated tangent. Distance anchoring preserves phase across bends,
 * material transitions and world-tile boundaries. Never changes physics. */
export function toyRoadBricks(quad: RoadRibbonQuad, spacing: number, night: boolean): readonly ToyRoadBrick[] {
  const from = quad.from.distance, to = quad.to.distance
  if (![from, to, spacing].every(Number.isFinite) || to <= from || spacing <= 0) return []
  const first = Math.floor(from / spacing)
  const last = Math.min(Math.ceil(to / spacing) - 1, first + 31)
  const palette = night ? NIGHT : DAY
  const result: ToyRoadBrick[] = []
  const gap = Math.min(0.65, spacing * 0.08)
  for (let index = first; index <= last; index++) {
    const start = Math.max(from, index * spacing + gap)
    const end = Math.min(to, (index + 1) * spacing - gap)
    if (end <= start) continue
    const center = (index + 0.5) * spacing
    for (const side of [0, 1] as const) {
      const a = side === 0 ? 0 : 3
      const b = side === 0 ? 1 : 2
      const point = (distance: number, across: number): Vector2 => {
        const t = (distance - from) / (to - from)
        return lerp(lerp(quad.road[a], quad.road[b], t), lerp(quad.edge[a], quad.edge[b], t), across)
      }
      const color = palette[((index + side) % palette.length + palette.length) % palette.length]
      if (!color) throw new Error('Missing toy brick color')
      result.push({
        polygon: [point(start, 0.10), point(end, 0.10), point(end, 0.92), point(start, 0.92)],
        color,
        ...(center >= from && center < to ? { stud: point(center, 0.51) } : {}),
      })
    }
  }
  return result
}

/** Shared Canvas road tiles are already cached for editor, race and flyover.
 * Draw all fragments before studs to avoid clipping a stud at a sample seam. */
export function paintToyRoadBricks(context: CanvasRenderingContext2D, bricks: readonly ToyRoadBrick[], night: boolean): void {
  for (const brick of bricks) {
    const [a, b, c, d] = brick.polygon
    context.fillStyle = brick.color
    context.beginPath()
    context.moveTo(a.x, a.y); context.lineTo(b.x, b.y)
    context.lineTo(c.x, c.y); context.lineTo(d.x, d.y)
    context.closePath()
    context.fill()
  }
  for (const { stud, color } of bricks) {
    if (!stud) continue
    context.fillStyle = night ? 'rgba(0,0,0,0.34)' : 'rgba(0,0,0,0.27)'
    context.beginPath()
    context.ellipse(stud.x + 0.6, stud.y + 0.7, 2.25, 2.25, 0, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = color
    context.beginPath()
    context.ellipse(stud.x, stud.y, 1.85, 1.85, 0, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = night ? 'rgba(255,255,255,0.23)' : 'rgba(255,255,255,0.52)'
    context.beginPath()
    context.ellipse(stud.x - 0.65, stud.y - 0.65, 0.7, 0.55, 0, 0, Math.PI * 2)
    context.fill()
  }
}
