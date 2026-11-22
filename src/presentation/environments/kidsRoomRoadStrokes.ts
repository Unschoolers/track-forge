import type { SurfaceId } from '@/domain/model'
import type { RoadPathPoint } from '@/domain/track/pathBuilder'

export interface RoadMaterialStroke {
  readonly start: { readonly x: number; readonly y: number }
  readonly end: { readonly x: number; readonly y: number }
  readonly color: number
  readonly alpha: number
  readonly width: number
}

/**
 * Embossed details follow road distance, not the draw chunk or the viewport.
 * Called only while baking the ribbon or rendering the small flyover.
 * Never affects friction, collision, road width or saved track geometry.
 */
export function kidsRoomRoadStrokes(
  surface: SurfaceId,
  from: Pick<RoadPathPoint, 'x' | 'y' | 'distance'>,
  to: Pick<RoadPathPoint, 'x' | 'y' | 'distance'>,
  night: boolean,
): readonly RoadMaterialStroke[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const distanceSpan = to.distance - from.distance
  if (length < 0.001 || distanceSpan <= 0 ||
    ![from.x, from.y, from.distance, to.x, to.y, to.distance].every(Number.isFinite)) return []

  const tangent = { x: dx / length, y: dy / length }
  const normal = { x: -tangent.y, y: tangent.x }
  const spacing = surface === 'street' ? 74 : surface === 'dirt' ? 38 : 42
  const first = Math.floor(from.distance / spacing) + 1
  // Bound work for abnormally long preview segments; normal six-unit samples
  // cross at most one interval.
  const last = Math.min(Math.floor(to.distance / spacing), first + 31)
  const strokes: RoadMaterialStroke[] = []
  const add = (
    center: { x: number; y: number },
    along1: number, across1: number, along2: number, across2: number,
    color: number, alpha: number, width: number,
  ) => {
    const at = (along: number, across: number) => ({
      x: center.x + tangent.x * along + normal.x * across,
      y: center.y + tangent.y * along + normal.y * across,
    })
    strokes.push({ start: at(along1, across1), end: at(along2, across2), color, alpha, width })
  }

  for (let marker = first; marker <= last; marker += 1) {
    const distance = marker * spacing
    const t = (distance - from.distance) / distanceSpan
    const center = { x: from.x + dx * t, y: from.y + dy * t }
    if (surface === 'street') {
      // Subtle seams and short stitches suggest a rolled-out toy play mat.
      add(center, 0, -31, 0, 31, night ? 0x9bb1d2 : 0x233d60, 0.3, 1.7)
      add(center, -6, -29, 5, -29, night ? 0xd6c9a8 : 0xf4ddb1, 0.72, 1.6)
      add(center, -6, 29, 5, 29, night ? 0xd6c9a8 : 0xf4ddb1, 0.72, 1.6)
    } else if (surface === 'dirt') {
      // Staggered paper fibers and occasional cardboard panel joins.
      const shift = (marker % 5 - 2) * 5
      add(center, -10, shift - 8, 10, shift - 12, night ? 0xd1ad87 : 0x67472c, 0.38, 1.8)
      add(center, -6, shift + 8, 4, shift + 11, night ? 0xe8c9a4 : 0xffe4b7, 0.48, 1.4)
      if (marker % 3 === 0) add(center, 0, -32, 0, 32, night ? 0x493727 : 0x896446, 0.4, 2.1)
    } else {
      // Elongated directional reflections make the smooth plastic visually
      // distinct from the grippy mat (ice physics remain unchanged).
      const shift = marker % 2 === 0 ? -17 : 16
      add(center, -17, shift, 19, shift + 2, night ? 0x9cd8e7 : 0xeaffff, 0.72, 2.2)
      add(center, -9, shift + 5, 8, shift + 5, night ? 0x74bad5 : 0xffffff, 0.36, 1.3)
      if (marker % 3 === 0) {
        add(center, 0, -3, 0, 5, night ? 0xc9eafb : 0xffffff, 0.7, 1.5)
        add(center, -4, 1, 4, 1, night ? 0xc9eafb : 0xffffff, 0.7, 1.5)
      }
    }
  }
  return strokes
}
