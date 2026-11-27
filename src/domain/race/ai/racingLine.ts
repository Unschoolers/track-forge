import { ROAD_GEOMETRY } from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type { Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'

interface LineNode {
  readonly point: Vector2
  readonly normal: Vector2
  readonly limit: number
}

const cache = new WeakMap<RoadPath, readonly Vector2[]>()
const ZERO: Vector2 = { x: 0, y: 0 }

/** Minimize squared second differences of a road-relative line at two
 * length scales. A small center/slope penalty prevents arbitrary lane
 * excursions on straights. Jacobi updates are symmetric in travel direction.
 * All samples are bounded by their road corridor; endpoints are fixed. */
export function solveRacingLine(nodes: readonly LineNode[], closed: boolean): readonly number[] {
  const count = nodes.length
  let offsets = nodes.map(() => 0)
  if (count < 5) return offsets
  const at = (i: number) => closed ? ((i % count) + count) % count : clamp(i, 0, count - 1)
  for (const stride of [12, 6]) {
    if (count <= stride * 4) continue
    for (let iteration = 0; iteration < 18; iteration++) {
      const positions = nodes.map((node, i) => {
        const offset = offsets[i] ?? 0
        return { x: node.point.x + node.normal.x * offset, y: node.point.y + node.normal.y * offset }
      })
      offsets = nodes.map((node, i) => {
        if (node.limit <= 0 || (!closed && (i < stride * 2 || i >= count - stride * 2))) return 0
        const previous = at(i - stride)
        const next = at(i + stride)
        const a = positions[at(i - stride * 2)]
        const b = positions[previous]
        const c = positions[i]
        const d = positions[next]
        const e = positions[at(i + stride * 2)]
        if (!a || !b || !c || !d || !e) throw new Error('Incomplete racing line stencil')
        const current = offsets[i] ?? 0
        // Gradient of the three overlapping second-difference penalties.
        const dx = a.x - 4 * b.x + 6 * c.x - 4 * d.x + e.x
        const dy = a.y - 4 * b.y + 6 * c.y - 4 * d.y + e.y
        const slope = 2 * current - (offsets[previous] ?? 0) - (offsets[next] ?? 0)
        const gradient = dx * node.normal.x + dy * node.normal.y + 0.04 * current + 0.12 * slope
        return clamp(current - 0.3 * gradient / 6.28, -node.limit, node.limit)
      })
    }
  }
  // Blend neighboring samples and enforce a final bounded lateral slope.
  // A symmetric envelope from both directions also makes the lap seam continuous.
  const smoothed = nodes.map((node, i) => {
    let sum = 0
    for (let j = -3; j <= 3; j++) sum += offsets[at(i + j)] ?? 0
    return clamp(sum / 7, -node.limit, node.limit)
  })
  const slopeLimit = 1.5
  // Limit each point by the feasible interval of its neighbors, without
  // allowing a safety-pinned zero to move. Two laps propagate across the seam.
  for (const direction of [1, -1]) {
    for (let j = 0; j < count * (closed ? 2 : 1); j++) {
      const i = direction === 1 ? j % count : count - 1 - j % count
      const previous = i - direction
      if (!closed && (previous < 0 || previous >= count)) continue
      const value = smoothed[i] ?? 0
      const neighbor = smoothed[at(previous)] ?? 0
      // Only shrink toward zero: never create an offset in a pinned corridor.
      const magnitude = Math.min(Math.abs(value), Math.max(0, Math.sign(value) * neighbor + slopeLimit))
      smoothed[i] = Math.sign(value) * magnitude
    }
  }
  return smoothed
}

function compileLine(path: RoadPath): readonly Vector2[] {
  const points = path.points
  const count = points.length
  const at = (i: number) => points[path.closed ? ((i % count) + count) % count : clamp(i, 0, count - 1)]
  const nodes = points.map((point, i): LineNode => {
    const before = at(i - 2)
    const after = at(i + 2)
    if (!before || !after) return { point, normal: ZERO, limit: 0 }
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy)
    const normal = length > 0.001 ? { x: -dy / length, y: dx / length } : ZERO
    let limit = length > 0.001 ? ROAD_GEOMETRY.onRoadRadius * 0.55 : 0
    // Do not optimize across an authored support or grip transition.
    for (let j = -12; j <= 12 && limit > 0; j++) {
      const neighbor = at(i + j)
      if (!neighbor || neighbor.surface !== 'street' || neighbor.structure !== 'surface') limit = 0
    }
    if (!path.closed && (i < 24 || i >= count - 24)) limit = 0
    if (path.crossings.some(crossing => Math.hypot(point.x - crossing.position.x,
      point.y - crossing.position.y) < crossing.bridgeHalfLength + ROAD_GEOMETRY.onRoadRadius + 72)) limit = 0
    return { point, normal, limit }
  })
  const offsets = solveRacingLine(nodes, path.closed)
  return nodes.map((node, i) => {
    const offset = offsets[i] ?? 0
    return { x: node.normal.x * offset, y: node.normal.y * offset }
  })
}

/** World-space offset at the future pursuit point, never a physics change.
 * Geometry is immutable and weakly cached; no per-tick whole-path scan. */
export function racingLineOffset(path: RoadPath, index: number): Vector2 {
  let line = cache.get(path)
  if (!line) {
    line = compileLine(path)
    cache.set(path, line)
  }
  return line[index] ?? ZERO
}
