import type Phaser from 'phaser'
import { ROAD_GEOMETRY } from '@/domain/config'
import type { Vector2 } from '@/domain/model'
import type { EditorState } from '@/domain/editor/editorState'
import type { TrackGeometry } from '@/domain/track/trackGeometry'

export interface WorldBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface GridLine {
  readonly position: number
  readonly major: boolean
}

export interface EditorGrid {
  readonly vertical: readonly GridLine[]
  readonly horizontal: readonly GridLine[]
}

/** Choose 1/2/5 steps so grid density stays readable across large zoom ranges. */
export function editorGridSpacing(zoom: number): number {
  const target = 64 / Math.max(0.00001, zoom)
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const ratio = target / magnitude
  const multiplier = ratio < 1.5 ? 1 : ratio < 3.5 ? 2 : ratio < 7.5 ? 5 : 10
  return multiplier * magnitude
}

export function buildEditorGrid(
  bounds: WorldBounds,
  spacing = 50,
): EditorGrid {
  const lines = (minimum: number, maximum: number): readonly GridLine[] => {
    const first = Math.ceil(minimum / spacing)
    const last = Math.floor(maximum / spacing)
    const count = Math.min(240, Math.max(0, last - first + 1))
    return Array.from({ length: count }, (_, offset) => {
      const multiple = first + offset
      return {
        position: multiple * spacing,
        major: multiple % 5 === 0,
      }
    })
  }
  return {
    vertical: lines(bounds.left, bounds.right),
    horizontal: lines(bounds.top, bounds.bottom),
  }
}

export function renderEditorGrid(
  graphics: Phaser.GameObjects.Graphics,
  bounds: WorldBounds,
  night: boolean,
  zoom = 1,
): void {
  const grid = buildEditorGrid(bounds, editorGridSpacing(zoom))
  // Graphics widths are world-space; convert from screen pixels so zoom never
  // makes the grid hairline-thin or distractingly heavy.
  const screenScale = 1 / Math.max(0.00001, zoom)
  const stroke = (major: boolean) => {
    graphics.lineStyle(
      (major ? 1.55 : 0.85) * screenScale,
      night ? 0xc7e3dd : 0x14392f,
      night ? (major ? 0.48 : 0.26) : (major ? 0.44 : 0.23),
    )
  }
  for (const line of grid.vertical) {
    stroke(line.major)
    graphics.lineBetween(line.position, bounds.top, line.position, bounds.bottom)
  }
  for (const line of grid.horizontal) {
    stroke(line.major)
    graphics.lineBetween(bounds.left, line.position, bounds.right, line.position)
  }
}

export function renderEditorOverlay(
  graphics: Phaser.GameObjects.Graphics,
  state: EditorState,
  geometry: TrackGeometry,
  selectedPoint = -1,
  selectedCrossing: string | null = null,
  zoom = 1,
): void {
  const screenScale = 1 / Math.max(0.01, zoom)
  for (const [index, point] of state.points.entries()) {
    const selected = index === selectedPoint
    graphics.fillStyle(selected ? 0xffd43b : 0xf4f7fb, 1)
    graphics.fillCircle(point.x, point.y, (selected ? 9 : 6.5) * screenScale)
    if (selected) {
      graphics.lineStyle(2 * screenScale, 0x20242a, 0.9)
      graphics.strokeCircle(point.x, point.y, 10 * screenScale)
    }
  }
  const crossing = selectedCrossing
    ? geometry.crossings.find(
        (candidate) => candidate.key === selectedCrossing,
      )
    : undefined
  if (crossing) {
    graphics.lineStyle(3, 0x54d6bf, 0.95)
    graphics.beginPath()
    const first = crossing.polygon[0]
    graphics.moveTo(first.x, first.y)
    for (const point of crossing.polygon.slice(1)) {
      graphics.lineTo(point.x, point.y)
    }
    graphics.closePath()
    graphics.strokePath()
  }
}


export function renderRoadPointPreview(
  graphics: Phaser.GameObjects.Graphics,
  spans: readonly (readonly Vector2[])[],
  point: Vector2,
  zoom: number,
): void {
  const scale = 1 / Math.max(0.01, zoom)
  const first = spans[0]?.[0]
  if (first) {
    graphics.lineStyle(Math.max(ROAD_GEOMETRY.surfaceWidth, 8 * scale), 0x54d6bf, 0.65)
    graphics.beginPath()
    graphics.moveTo(first.x, first.y)
    for (const span of spans) {
      for (const vertex of span.slice(1)) graphics.lineTo(vertex.x, vertex.y)
    }
    graphics.strokePath()
  }
  graphics.fillStyle(0xffd43b, 1)
  graphics.fillCircle(point.x, point.y, 9 * scale)
  graphics.lineStyle(2 * scale, 0x20242a, 0.9)
  graphics.strokeCircle(point.x, point.y, 10 * scale)
}
