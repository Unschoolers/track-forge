import type Phaser from 'phaser'
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
): void {
  const grid = buildEditorGrid(bounds)
  for (const line of grid.vertical) {
    graphics.lineStyle(
      line.major ? 1.4 : 0.7,
      night ? 0xb7c4bb : 0x163f26,
      line.major ? 0.24 : 0.12,
    )
    graphics.lineBetween(line.position, bounds.top, line.position, bounds.bottom)
  }
  for (const line of grid.horizontal) {
    graphics.lineStyle(
      line.major ? 1.4 : 0.7,
      night ? 0xb7c4bb : 0x163f26,
      line.major ? 0.24 : 0.12,
    )
    graphics.lineBetween(bounds.left, line.position, bounds.right, line.position)
  }
}

export function renderEditorOverlay(
  graphics: Phaser.GameObjects.Graphics,
  state: EditorState,
  geometry: TrackGeometry,
  selectedPoint = -1,
  selectedCrossing: string | null = null,
): void {
  for (const [index, point] of state.points.entries()) {
    const selected = index === selectedPoint
    graphics.fillStyle(selected ? 0xffd43b : 0xf4f7fb, 1)
    graphics.fillCircle(point.x, point.y, selected ? 6 : 3.5)
    if (selected) {
      graphics.lineStyle(2, 0x20242a, 0.9)
      graphics.strokeCircle(point.x, point.y, 8)
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
