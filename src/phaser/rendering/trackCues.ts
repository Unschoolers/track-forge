import type Phaser from 'phaser'
import { ROAD_GEOMETRY } from '@/domain/config'
import type { Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { roadGateGeometry, roadGateSpan } from '@/domain/track/trackGeometry'

export interface RoadTransitionCue {
  readonly center: Vector2
  readonly tangent: Vector2
  readonly span: { readonly min: number; readonly max: number }
  readonly kind: 'surface' | 'ramp-entry' | 'ramp-exit'
  readonly color: number
  readonly markCount: 1 | 2 | 3
  readonly night: boolean
}

/** Player recovery markers use the same geometry as the timing gates. */
export function renderRecoveryCheckpoints(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  checkpoints: readonly number[],
  editorZoom?: number,
  nextCheckpoint?: number,
): void {
  for (const index of checkpoints) {
    const gate = roadGateGeometry(path, index)
    if (!gate) continue
    const { center: point, tangent } = gate
    const span = roadGateSpan(path, index, ROAD_GEOMETRY.checkpointHalfWidth)
    const left = { x: point.x - tangent.y * span.min, y: point.y + tangent.x * span.min }
    const right = { x: point.x - tangent.y * span.max, y: point.y + tangent.x * span.max }
    const active = index === nextCheckpoint
    if (editorZoom) graphics.lineStyle(6 / editorZoom, 0x66d9ff, 1)
    else graphics.lineStyle(active ? 11 : 5, active ? 0x79efff : 0x38a5c4, active ? 1 : 0.58)
    graphics.beginPath()
    graphics.moveTo(left.x, left.y)
    graphics.lineTo(right.x, right.y)
    graphics.strokePath()
    if (!editorZoom) {
      graphics.fillStyle(active ? 0xffdf68 : 0x9bdbe8, active ? 1 : 0.72)
      graphics.fillCircle(left.x, left.y, active ? 7 : 4)
      graphics.fillCircle(right.x, right.y, active ? 7 : 4)
    }
    if (editorZoom) {
      const scale = 1 / Math.max(0.01, editorZoom)
      graphics.fillStyle(0x112c3d, 1)
      graphics.fillCircle(point.x, point.y, 8 * scale)
      graphics.lineStyle(2 * scale, 0x66d9ff, 1)
      graphics.strokeCircle(point.x, point.y, 8 * scale)
      graphics.fillStyle(0xf4f7fb, 1)
      graphics.fillCircle(point.x, point.y, 3.5 * scale)
    }
  }
}

/** Surface changes and elevated-road thresholds get a compact transverse cue. */
export function buildRoadTransitionCues(
  path: RoadPath,
  night: boolean,
): readonly RoadTransitionCue[] {
  const cues: RoadTransitionCue[] = []
  const count = path.closed ? path.points.length : path.points.length - 1
  for (let index = 0; index < count; index += 1) {
    const before = path.points[index]
    const after = path.points[(index + 1) % path.points.length]
    if (!before || !after) continue
    const surfaceChange = before.surface !== after.surface
    const rampStart = before.structure !== 'overpass' && after.structure === 'overpass'
    const rampEnd = before.structure === 'overpass' && after.structure !== 'overpass'
    if (!surfaceChange && !rampStart && !rampEnd) continue
    const kind = rampStart ? 'ramp-entry' : rampEnd ? 'ramp-exit' : 'surface'
    const gate = roadGateGeometry(path, index + 1)
    if (!gate) continue
    const span = roadGateSpan(path, index + 1, ROAD_GEOMETRY.surfaceWidth / 2 - 3)
    const approachDirection = rampStart ? -1 : rampEnd ? 1 : 0
    const approach = rampStart || rampEnd
      ? 14 * approachDirection
      : 0
    const center = {
      x: gate.center.x + gate.tangent.x * approach,
      y: gate.center.y + gate.tangent.y * approach,
    }
    cues.push({
      center,
      tangent: gate.tangent,
      span,
      kind,
      markCount: kind === 'surface'
        ? after.surface === 'ice' ? 3 : after.surface === 'dirt' ? 2 : 1
        : 1,
      color: kind === 'surface'
        ? after.surface === 'ice' ? (night ? 0x8eeaff : 0x58c9ea)
          : after.surface === 'dirt' ? (night ? 0xffdc88 : 0xd39a4a)
            : (night ? 0xe4f1ff : 0xffffff)
        : night ? 0xffd36b : 0xf0a82d,
      night,
    })
  }
  return cues
}

export function paintRoadTransitionCue(
  graphics: Phaser.GameObjects.Graphics,
  cue: RoadTransitionCue,
): void {
  const { center, tangent, span, kind, color, night } = cue
  const normal = { x: -tangent.y, y: tangent.x }
  const pointAt = (across: number, along = 0): Vector2 => ({
    x: center.x + normal.x * across + tangent.x * along,
    y: center.y + normal.y * across + tangent.y * along,
  })
  if (kind === 'surface') {
    // Surface-specific repeated edge slashes show the new grip material while
    // leaving the center of the road clear for lane and crossing markings.
    graphics.lineStyle(2.6, color, night ? 0.96 : 0.9)
    for (const edge of [span.min + 4, span.max - 4]) {
      for (let mark = 0; mark < cue.markCount; mark += 1) {
        const along = (mark - (cue.markCount - 1) / 2) * 5
        const start = pointAt(edge - 2, along - 3)
        const end = pointAt(edge + 2, along + 3)
        graphics.lineBetween(start.x, start.y, end.x, end.y)
      }
    }
    return
  }
  // Ramp marks stay on the low ground approach, beyond opaque deck geometry.
  // Their arrow points toward the raised section from either end.
  const towardRamp = kind === 'ramp-entry' ? 1 : -1
  graphics.lineStyle(3, color, night ? 0.98 : 0.92)
  for (const along of [-5, 5]) {
    const left = pointAt(span.min, along)
    const right = pointAt(span.max, along)
    graphics.lineBetween(left.x, left.y, right.x, right.y)
  }
  for (const edge of [span.min, span.max]) {
    const marker = pointAt(edge)
    graphics.fillStyle(color, 1)
    graphics.fillCircle(marker.x, marker.y, 3.5)
  }
  const tip = pointAt(0, towardRamp * 8)
  for (const side of [-1, 1]) {
    const tail = pointAt(side * 6, -towardRamp * 1)
    graphics.lineBetween(tail.x, tail.y, tip.x, tip.y)
  }
}

export function renderRoadTransitions(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  night: boolean,
): void {
  for (const cue of buildRoadTransitionCues(path, night)) paintRoadTransitionCue(graphics, cue)
}
