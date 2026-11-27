import type { ScenerySelection } from '@/domain/track/sceneryTransform'
import { ROAD_GEOMETRY, WORLD_ELEVATION, type TerrainBrushRadius } from '@/domain/config'
import type { EditorTool } from '@/domain/editor/editorGeometry'
import type { TerrainBrushMode } from '@/domain/editor/terrainBrush'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { RouteKind, TerrainMap, Vector2 } from '@/domain/model'

export interface EditorRenderState {
  readonly routeKind: RouteKind
  readonly roadDrag?: boolean
  readonly points: object
  readonly terrain: object
  readonly trees: object
  readonly scenery: object
  readonly recoveryCheckpoints?: object
  readonly environmentId: TrackEnvironmentId
  readonly start: object | undefined
  readonly night: boolean
  readonly grid: boolean
  readonly selectedPoint: number | null
  readonly selectedScenery?: ScenerySelection | null | undefined
  readonly selectedCrossing: string | null
  readonly tool: EditorTool
  readonly terrainMode: TerrainBrushMode
  readonly terrainRadius: TerrainBrushRadius
}

export interface EditorRenderChanges {
  readonly world: boolean
  readonly appearance: boolean
  readonly grid: boolean
  readonly overlay: boolean
  readonly preview: boolean
}

export function editorTreeRenderRequired(
  previous: EditorRenderState | undefined,
  current: EditorRenderState,
): boolean {
  return !previous || previous.trees !== current.trees ||
    previous.terrain !== current.terrain || previous.night !== current.night
}

type SceneryPreview = {
  readonly type: 'tree' | 'prop'
  readonly index: number
  readonly position: Vector2
} | null

export function treePreviewRenderRequired(
  previous: SceneryPreview,
  current: SceneryPreview,
): boolean {
  const before = previous?.type === 'tree' ? previous : null
  const after = current?.type === 'tree' ? current : null
  if (!before || !after) return before !== after
  return before.index !== after.index || before.position.x !== after.position.x ||
    before.position.y !== after.position.y
}

export function editorSnapshotRenderChanges(
  previous: EditorRenderState | undefined,
  current: EditorRenderState,
  cameraChanged: boolean,
): EditorRenderChanges {
  if (!previous) {
    return { world: true, appearance: true, grid: true, overlay: true, preview: true }
  }
  const geometryChanged =
    previous.routeKind !== current.routeKind ||
    previous.points !== current.points ||
    previous.terrain !== current.terrain ||
    previous.start !== current.start
  return {
    world:
      geometryChanged ||
      (previous.roadDrag === true && current.roadDrag !== true) ||
      previous.environmentId !== current.environmentId ||
      previous.night !== current.night,
    appearance: previous.environmentId !== current.environmentId || previous.scenery !== current.scenery || previous.trees !== current.trees || previous.night !== current.night || (previous.tool !== current.tool && (previous.tool === 'tree' || current.tool === 'tree')),
    grid:
      cameraChanged ||
      previous.grid !== current.grid ||
      previous.night !== current.night,
    overlay:
      cameraChanged ||
      geometryChanged ||
      previous.recoveryCheckpoints !== current.recoveryCheckpoints ||
      previous.selectedScenery !== current.selectedScenery ||
      (current.selectedScenery != null && (previous.scenery !== current.scenery || previous.trees !== current.trees)) ||
      previous.selectedPoint !== current.selectedPoint ||
      previous.selectedCrossing !== current.selectedCrossing,
    preview:
      previous.night !== current.night ||
      previous.tool !== current.tool ||
      previous.terrainMode !== current.terrainMode ||
      previous.terrainRadius !== current.terrainRadius,
  }
}

/** Terrain depends on the road corridor, but does not need to be recompiled
 * for intermediate point-drag frames. Compare against the last actual terrain
 * render, not the last snapshot, so commit and cancellation cannot go stale. */
export function editorTerrainRenderRequired(
  rendered: EditorRenderState | undefined,
  current: EditorRenderState,
  detailChanged: boolean,
  roadDependent = true,
): boolean {
  if (!rendered || rendered.terrain !== current.terrain ||
    rendered.environmentId !== current.environmentId || rendered.night !== current.night ||
    (roadDependent && rendered.routeKind !== current.routeKind)) return true
  if (current.roadDrag) return false
  return detailChanged || (roadDependent && rendered.points !== current.points)
}

export function editorPointerRenderChanges(
  tool: EditorTool,
): EditorRenderChanges {
  return {
    world: false,
    appearance: tool === 'tree',
    grid: false,
    overlay: false,
    preview: tool === 'terrain',
  }
}

export function terrainPreviewCompileRequired(
  compiledRevision: number | undefined,
  preview: {
    readonly revision: number
    readonly dirtyCells: readonly unknown[]
  } | null,
): boolean {
  return (
    preview !== null &&
    preview.dirtyCells.length > 0 &&
    preview.revision !== compiledRevision
  )
}

/** Only road segments within the hill slope blending corridor can change
 * hill shading. Preserve exact segment coordinates and order for ties in
 * nearest-road lookup; surface/structure metadata cannot affect this field.
 * Bounding-box intersection is deliberately conservative. */
export function hillRoadInfluenceKey(
  terrain: TerrainMap,
  path: { readonly points: readonly Vector2[]; readonly closed: boolean },
): string {
  const hills = terrain.cells.filter(cell => cell.kind === 'hill')
  if (!hills.length || !path.points.length) return ''
  const size = terrain.cellSize
  const margin = ROAD_GEOMETRY.edgeWidth + WORLD_ELEVATION.cellSize
  const occupied = new Set(hills.map(cell => `${cell.column}:${cell.row}`))
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (const cell of hills) {
    left = Math.min(left, cell.column)
    right = Math.max(right, cell.column)
    top = Math.min(top, cell.row)
    bottom = Math.max(bottom, cell.row)
  }
  const keys: string[] = []
  const count = path.points.length
  const segments = count === 1 ? 1 : path.closed ? count : count - 1
  for (let i = 0; i < segments; i++) {
    const a = path.points[i]
    const b = path.points[(i + 1) % count]
    if (!a || !b) continue
    const minX = Math.max(left, Math.floor((Math.min(a.x, b.x) - margin) / size))
    const maxX = Math.min(right, Math.floor((Math.max(a.x, b.x) + margin) / size))
    const minY = Math.max(top, Math.floor((Math.min(a.y, b.y) - margin) / size))
    const maxY = Math.min(bottom, Math.floor((Math.max(a.y, b.y) + margin) / size))
    if (minX > maxX || minY > maxY) continue
    let intersects = false
    if ((maxX - minX + 1) * (maxY - minY + 1) > hills.length) {
      intersects = hills.some(cell => cell.column >= minX && cell.column <= maxX &&
        cell.row >= minY && cell.row <= maxY)
    } else {
      for (let y = minY; y <= maxY && !intersects; y++) {
        for (let x = minX; x <= maxX && !intersects; x++) {
          intersects = occupied.has(`${x}:${y}`)
        }
      }
    }
    if (intersects) keys.push(`${a.x},${a.y}:${b.x},${b.y}`)
  }
  return keys.join('|')
}
