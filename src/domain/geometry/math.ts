import type { Vector2 } from '@/domain/model'

export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

export const distance = (left: Vector2, right: Vector2): number =>
  Math.hypot(right.x - left.x, right.y - left.y)

export function catmullRom(
  p0: Vector2,
  p1: Vector2,
  p2: Vector2,
  p3: Vector2,
  t: number,
): Vector2 {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  }
}
