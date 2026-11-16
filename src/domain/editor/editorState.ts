import { DEFAULT_TRACK_ENVIRONMENT_ID, MAX_SCENERY_PROPS, isSceneryPosition, sceneryKindBelongsToEnvironment } from '@/domain/track/trackEnvironment'
import type { SceneryProp, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { normalizeRouteKind, type RouteKind, type Track } from '@/domain/model'
import type {
  CurveMode,
  RoadStructure,
  SurfaceId,
  TerrainBrushKind,
  TerrainMap,
  TrackPoint,
  TrackStart,
  Tree,
  Vector2,
} from '@/domain/model'
import {
  expandAroundBoundsCenter,
  finalizeDrawGesture,
  normalizeClosedLoop,
  planTerrainExpansionAroundBoundsCenter,
} from '@/domain/editor/editorGeometry'
import type { TrackRepair } from '@/domain/track/trackDiagnostics'
import { MAX_ROAD_CONTROL_LENGTH, recoverableCircuitPointCount, roadControlLength } from '@/domain/track/roadLength'
import { trackPointSectionId } from '@/domain/track/pathBuilder'
import { isRecoveryCheckpointRatio, MAX_RECOVERY_CHECKPOINTS } from '@/domain/track/recoveryCheckpoints'
import {
  EMPTY_TERRAIN,
  paintTerrain,
  planTerrainPaint,
  type TerrainCellCoordinate,
} from '@/domain/terrain/terrainField'
import {
  EXPAND_TERRAIN_BOUNDS_REJECTION,
  EXPAND_TERRAIN_CAPACITY_REJECTION,
  INVALID_SCENERY_POSITION_REJECTION,
  ROAD_LENGTH_REJECTION,
  SCENERY_CAPACITY_REJECTION,
  TERRAIN_CAPACITY_REJECTION,
  TERRAIN_COORDINATE_BOUNDS_REJECTION,
  treePlacementRejection,
  type EditorCommandRejection,
} from '@/domain/editor/editorConstraints'

export interface EditorSnapshot {
  readonly routeKind: RouteKind
  readonly recoveryCheckpoints: readonly number[]
  readonly environmentId: TrackEnvironmentId
  readonly scenery: readonly SceneryProp[]
  readonly points: readonly TrackPoint[]
  readonly trees: readonly Tree[]
  readonly start?: TrackStart
  readonly terrain: TerrainMap
}

export interface EditorState extends EditorSnapshot {
  readonly history: readonly EditorSnapshot[]
  readonly future: readonly EditorSnapshot[]
  readonly gestureStart: EditorSnapshot | null
  readonly gestureChanged: boolean
}

export type EditorCommand =
  | { readonly type: 'set-route-kind'; readonly routeKind: RouteKind }
  | { readonly type: 'toggle-recovery-checkpoint'; readonly ratio: number }
  | { readonly type: 'begin-gesture' }
  | { readonly type: 'add-point'; readonly point: TrackPoint }
  | {
      readonly type: 'move-point'
      readonly index: number
      readonly point: Vector2
    }
  | {
      readonly type: 'paint-point'
      readonly index: number
      readonly surface: SurfaceId
    }
  | {
      readonly type: 'paint-section-structure'
      readonly index: number
      readonly structure: RoadStructure
    }
  | {
      readonly type: 'paint-terrain'
      readonly cells: readonly TerrainCellCoordinate[]
      readonly kind: TerrainBrushKind
    }
  | { readonly type: 'erase-point'; readonly index: number }
  | {
      readonly type: 'set-point-curve'
      readonly index: number
      readonly curve: CurveMode
    }
  | {
      readonly type: 'set-point-tension'
      readonly index: number
      readonly tension: number
    }
  | {
      readonly type: 'insert-point'
      readonly index: number
      readonly point: TrackPoint
    }
  | { readonly type: 'set-environment'; readonly environmentId: TrackEnvironmentId }
  | { readonly type: 'add-scenery-prop'; readonly prop: SceneryProp }
  | { readonly type: 'move-scenery-prop'; readonly index: number; readonly position: Vector2 }
  | { readonly type: 'erase-scenery-prop'; readonly index: number }
  | { readonly type: 'move-tree'; readonly index: number; readonly position: Vector2 }
  | { readonly type: 'add-tree'; readonly tree: Tree }
  | { readonly type: 'erase-tree'; readonly index: number }
  | {
      readonly type: 'set-crossing-sections'
      readonly firstSegment: number
      readonly secondSegment: number
      readonly upperSegment: number | null
    }
  | {
      readonly type: 'set-track-start'
      readonly ratio: number
    }
  | { readonly type: 'reverse-track-direction' }
  | { readonly type: 'apply-track-repair'; readonly repair: TrackRepair }
  | { readonly type: 'clear' }
  | {
      readonly type: 'finalize-draw'
      readonly startIndex: number
      readonly zoom: number
    }
  | { readonly type: 'normalize-loop' }
  | { readonly type: 'expand'; readonly factor: 2 }
  | { readonly type: 'end-gesture' }
  | { readonly type: 'cancel-gesture' }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }

export interface EditorCommandResult {
  readonly state: EditorState
  readonly rejection: EditorCommandRejection | null
}

export function createEditorState(
  points: readonly TrackPoint[] = [],
  trees: readonly Tree[] = [],
  start: TrackStart = { ratio: 0, reversed: false },
  terrain: TerrainMap = EMPTY_TERRAIN,
  appearance: Pick<Track, 'environmentId' | 'scenery' | 'routeKind' | 'recoveryCheckpoints'> = {},
): EditorState {
  return {
    routeKind: normalizeRouteKind(appearance.routeKind),
    recoveryCheckpoints: appearance.recoveryCheckpoints ?? [],
    environmentId: appearance.environmentId ?? DEFAULT_TRACK_ENVIRONMENT_ID,
    scenery: appearance.scenery ?? [],
    points: [...points],
    trees: [...trees],
    start,
    terrain,
    history: [],
    future: [],
    gestureStart: null,
    gestureChanged: false,
  }
}

function snapshot(state: EditorState): EditorSnapshot {
  return {
    routeKind: state.routeKind,
    recoveryCheckpoints: state.recoveryCheckpoints,
    environmentId: state.environmentId,
    scenery: state.scenery,
    points: state.points,
    trees: state.trees,
    ...(state.start ? { start: state.start } : {}),
    terrain: state.terrain,
  }
}

function updateSectionStructures(
  points: readonly TrackPoint[],
  structure: RoadStructure,
  includes: (point: TrackPoint, index: number) => boolean,
  materializeSurface = false,
): readonly TrackPoint[] {
  let changed = false
  const updated = points.map((point, index) => {
    const unchanged =
      point.structure === structure ||
      (!materializeSurface &&
        point.structure === undefined &&
        structure === 'surface')
    if (!includes(point, index) || unchanged) {
      return point
    }
    changed = true
    return { ...point, structure }
  })
  return changed ? updated : points
}

export function patchEditorState(
  state: EditorState,
  patch: Partial<EditorSnapshot>,
): EditorState {
  const content: EditorSnapshot = { ...snapshot(state), ...patch }
  if (state.gestureStart) {
    return {
      ...content,
      history: state.history,
      // Keep the redo stack until the gesture is committed. A pinch/cancel
      // restores its starting snapshot without discarding redo history.
      future: state.future,
      gestureStart: state.gestureStart,
      gestureChanged: true,
    }
  }
  return {
    ...content,
    history: [...state.history, snapshot(state)].slice(-50),
    future: [],
    gestureStart: null,
    gestureChanged: false,
  }
}

export function applyEditorCommand(
  state: EditorState,
  command: EditorCommand,
): EditorCommandResult {
  if (command.type === 'add-tree') {
    const rejection = treePlacementRejection(state.terrain, command.tree)
    if (rejection) return { state, rejection }
  }
  if (command.type === 'move-tree') {
    if (!isSceneryPosition(command.position)) return { state, rejection: null }
    const rejection = treePlacementRejection(state.terrain, command.position)
    if (rejection) return { state, rejection }
  }
  if (command.type === 'add-scenery-prop' || command.type === 'move-scenery-prop') {
    const prop = command.type === 'add-scenery-prop' ? command.prop : state.scenery[command.index]
    const position = command.type === 'add-scenery-prop' ? command.prop : command.position
    if (!prop || !sceneryKindBelongsToEnvironment(prop.kind, state.environmentId)) return { state, rejection: null }
    if (!isSceneryPosition(position)) return { state, rejection: INVALID_SCENERY_POSITION_REJECTION }
    if (command.type === 'add-scenery-prop' && state.scenery.length >= MAX_SCENERY_PROPS) return { state, rejection: SCENERY_CAPACITY_REJECTION }
    const rejection = treePlacementRejection(state.terrain, position)
    if (rejection) return { state, rejection }
  }
  if (command.type === 'paint-terrain') {
    const plan = planTerrainPaint(state.terrain, command.cells, command.kind)
    if (!plan.ok) {
      return {
        state,
        rejection:
          plan.reason === 'coordinate-bounds'
            ? TERRAIN_COORDINATE_BOUNDS_REJECTION
            : TERRAIN_CAPACITY_REJECTION,
      }
    }
  }
  if (command.type === 'expand') {
    const plan = planTerrainExpansionAroundBoundsCenter(
      state.points,
      state.trees,
      state.terrain,
      command.factor,
      state.scenery,
    )
    const expanded = expandAroundBoundsCenter(state.points, state.trees, command.factor, state.scenery)
    if (!expanded.scenery.every(isSceneryPosition)) return { state, rejection: EXPAND_TERRAIN_BOUNDS_REJECTION }
    if (!plan.ok) {
      return {
        state,
        rejection:
          plan.reason === 'coordinate-bounds'
            ? EXPAND_TERRAIN_BOUNDS_REJECTION
            : EXPAND_TERRAIN_CAPACITY_REJECTION,
      }
    }
  }
  const next = reduceEditorUnchecked(state, command)
  // History must be able to restore the original legacy geometry after repair.
  if ((next.points !== state.points || next.routeKind !== state.routeKind) &&
    command.type !== 'undo' && command.type !== 'redo' && command.type !== 'cancel-gesture') {
    const length = roadControlLength(next)
    if (!Number.isFinite(length) || (length > MAX_ROAD_CONTROL_LENGTH && length > roadControlLength(state))) {
      return { state, rejection: ROAD_LENGTH_REJECTION }
    }
  }
  return { state: next, rejection: null }
}

export function reduceEditor(
  state: EditorState,
  command: EditorCommand,
): EditorState {
  return applyEditorCommand(state, command).state
}

function reduceEditorUnchecked(
  state: EditorState,
  command: EditorCommand,
): EditorState {
  switch (command.type) {
    case 'set-route-kind':
      return state.routeKind === command.routeKind ? state : patchEditorState(state, { routeKind: command.routeKind })
    case 'toggle-recovery-checkpoint': {
      const { ratio } = command
      if (!isRecoveryCheckpointRatio(ratio)) return state
      const current = state.recoveryCheckpoints
      if (current.includes(ratio)) {
        return patchEditorState(state, { recoveryCheckpoints: current.filter(mark => mark !== ratio) })
      }
      return current.length < MAX_RECOVERY_CHECKPOINTS
        ? patchEditorState(state, { recoveryCheckpoints: [...current, ratio].sort((a, b) => a - b) })
        : state
    }
    case 'begin-gesture':
      return state.gestureStart
        ? state
        : {
            ...state,
            gestureStart: snapshot(state),
            gestureChanged: false,
          }
    case 'add-point':
      return patchEditorState(state, {
        points: [...state.points, command.point],
      })
    case 'move-point': {
      const current = state.points[command.index]
      if (!current) return state
      const points = [...state.points]
      points[command.index] = { ...current, ...command.point }
      return patchEditorState(state, { points })
    }
    case 'paint-point': {
      const current = state.points[command.index]
      if (!current) return state
      const points = [...state.points]
      points[command.index] = { ...current, surface: command.surface }
      return patchEditorState(state, { points })
    }
    case 'paint-section-structure': {
      const points = updateSectionStructures(
        state.points,
        command.structure,
        (_, index) => index === command.index,
      )
      return points === state.points
        ? state
        : patchEditorState(state, { points })
    }
    case 'paint-terrain': {
      const terrain = paintTerrain(state.terrain, command.cells, command.kind)
      return terrain === state.terrain ? state : patchEditorState(state, { terrain })
    }
    case 'erase-point':
      return state.points[command.index]
        ? patchEditorState(state, {
            points: state.points.filter((_, index) => index !== command.index),
          })
        : state
    case 'set-point-curve': {
      const current = state.points[command.index]
      if (!current) return state
      const points = [...state.points]
      points[command.index] = { ...current, curve: command.curve }
      return patchEditorState(state, { points })
    }
    case 'set-point-tension': {
      const current = state.points[command.index]
      if (!current || !Number.isFinite(command.tension)) return state
      const points = [...state.points]
      points[command.index] = {
        ...current,
        tension: Math.max(0, Math.min(1, command.tension)),
      }
      return patchEditorState(state, { points })
    }
    case 'insert-point': {
      const index = Math.max(0, Math.min(state.points.length, command.index))
      return patchEditorState(state, {
        points: [
          ...state.points.slice(0, index),
          command.point,
          ...state.points.slice(index),
        ],
      })
    }
    case 'set-environment':
      return state.environmentId === command.environmentId ? state : patchEditorState(state, { environmentId: command.environmentId })
    case 'add-scenery-prop':
      return patchEditorState(state, { scenery: [...state.scenery, command.prop] })
    case 'move-scenery-prop': {
      const prop = state.scenery[command.index]
      if (!prop || (prop.x === command.position.x && prop.y === command.position.y)) return state
      const scenery = [...state.scenery]
      scenery[command.index] = { ...prop, ...command.position }
      return patchEditorState(state, { scenery })
    }
    case 'erase-scenery-prop': {
      const prop = state.scenery[command.index]
      return prop && sceneryKindBelongsToEnvironment(prop.kind, state.environmentId)
        ? patchEditorState(state, { scenery: state.scenery.filter((_, index) => index !== command.index) }) : state
    }
    case 'move-tree': {
      const tree = state.trees[command.index]
      if (!tree || (tree.x === command.position.x && tree.y === command.position.y)) return state
      const trees = [...state.trees]
      trees[command.index] = { ...tree, ...command.position }
      return patchEditorState(state, { trees })
    }
    case 'add-tree':
      return patchEditorState(state, {
        trees: [...state.trees, command.tree],
      })
    case 'erase-tree':
      return state.trees[command.index]
        ? patchEditorState(state, {
            trees: state.trees.filter((_, index) => index !== command.index),
          })
        : state
    case 'set-crossing-sections': {
      const firstSegment = Math.min(
        command.firstSegment,
        command.secondSegment,
      )
      const secondSegment = Math.max(
        command.firstSegment,
        command.secondSegment,
      )
      if (
        firstSegment < 0 ||
        firstSegment === secondSegment ||
        !state.points[firstSegment] ||
        !state.points[secondSegment] ||
        (command.upperSegment !== null &&
          command.upperSegment !== firstSegment &&
          command.upperSegment !== secondSegment)
      ) {
        return state
      }
      let points = updateSectionStructures(
        state.points,
        'surface',
        (_, index) => index === firstSegment || index === secondSegment,
        true,
      )
      if (command.upperSegment !== null) {
        points = updateSectionStructures(
          points,
          'overpass',
          (_, index) => index === command.upperSegment,
        )
      }
      return points === state.points
        ? state
        : patchEditorState(state, { points })
    }
    case 'set-track-start':
      return state.routeKind === 'circuit' && Number.isFinite(command.ratio)
        ? patchEditorState(state, {
            start: {
              ratio: Math.max(0, Math.min(0.999_999, command.ratio)),
              reversed: state.start?.reversed ?? false,
            },
          })
        : state
    case 'reverse-track-direction':
      if (state.routeKind !== 'circuit') return state
      return patchEditorState(state, {
        start: {
          ratio: state.start?.ratio ?? 0,
          reversed: !(state.start?.reversed ?? false),
        },
      })
    case 'apply-track-repair': {
      const repair = command.repair
      if (repair.type === 'remove-road-after-closed-circuit') {
        if (roadControlLength(state) <= MAX_ROAD_CONTROL_LENGTH) return state
        const count = recoverableCircuitPointCount(state)
        return count === undefined ? state : patchEditorState(state, { points: state.points.slice(0, count) })
      }
      if (repair.type === 'smooth-point') {
        const point = state.points[repair.index]
        if (!point) return state
        const points = [...state.points]
        points[repair.index] = {
          ...point,
          curve: 'smooth',
          tension: 0.35,
        }
        return patchEditorState(state, { points })
      }
      if (repair.type === 'remove-tree') {
        if (!state.trees[repair.index]) return state
        return patchEditorState(state, {
          trees: state.trees.filter((_, index) => index !== repair.index),
        })
      }
      if (repair.type === 'move-start') {
        if (state.routeKind !== 'circuit') return state
        return patchEditorState(state, {
          start: {
            ratio: Math.max(0, Math.min(0.999_999, repair.ratio)),
            reversed: state.start?.reversed ?? false,
          },
        })
      }
      if (repair.type === 'raise-road-sections') {
        const sectionIds = new Set(repair.sectionIds)
        const points = updateSectionStructures(
          state.points,
          'overpass',
          (point, index) =>
            sectionIds.has(trackPointSectionId(point, index)),
        )
        return points === state.points
          ? state
          : patchEditorState(state, { points })
      }
      const points = updateSectionStructures(
        state.points,
        'surface',
        (_, index) =>
          index === repair.firstSegment || index === repair.secondSegment,
        true,
      )
      return points === state.points
        ? state
        : patchEditorState(state, { points })
    }
    case 'clear':
      return patchEditorState(state, {
        points: [],
        trees: [],
        scenery: [],
        recoveryCheckpoints: [],
        terrain: EMPTY_TERRAIN,
      })
    case 'finalize-draw': {
      const points = finalizeDrawGesture(
        state.points,
        command.startIndex,
        command.zoom,
      )
      return points === state.points
        ? state
        : patchEditorState(state, { points })
    }
    case 'normalize-loop': {
      if (state.routeKind !== 'circuit') return state
      const points = normalizeClosedLoop(state.points)
      return points === state.points
        ? state
        : patchEditorState(state, { points })
    }
    case 'expand':
      {
        const terrain = planTerrainExpansionAroundBoundsCenter(
          state.points,
          state.trees,
          state.terrain,
          command.factor,
          state.scenery,
        )
        if (!terrain.ok) return state
      return patchEditorState(
        state,
        {
          ...expandAroundBoundsCenter(
            state.points,
            state.trees,
            command.factor,
            state.scenery,
          ),
          terrain: terrain.terrain,
        },
      )
      }
    case 'cancel-gesture':
      // A second finger turns the active edit into a navigation gesture.
      // Restore the pre-touch snapshot without creating an undo/redo entry.
      return state.gestureStart
        ? {
            ...state.gestureStart,
            history: state.history,
            future: state.future,
            gestureStart: null,
            gestureChanged: false,
          }
        : state
    case 'end-gesture': {
      if (!state.gestureStart) return state
      return {
        ...snapshot(state),
        history: state.gestureChanged
          ? [...state.history, state.gestureStart].slice(-50)
          : state.history,
        future: state.gestureChanged ? [] : state.future,
        gestureStart: null,
        gestureChanged: false,
      }
    }
    case 'undo': {
      if (state.gestureStart) {
        return {
          ...state.gestureStart,
          history: state.history,
          future: [snapshot(state), ...state.future],
          gestureStart: null,
          gestureChanged: false,
        }
      }
      const previous = state.history.at(-1)
      return previous
        ? {
            ...previous,
            history: state.history.slice(0, -1),
            future: [snapshot(state), ...state.future],
            gestureStart: null,
            gestureChanged: false,
          }
        : state
    }
    case 'redo': {
      // A retained redo stack is only actionable after the gesture ends.
      if (state.gestureStart) return state
      const next = state.future[0]
      return next
        ? {
            ...next,
            history: [...state.history, snapshot(state)].slice(-50),
            future: state.future.slice(1),
            gestureStart: null,
            gestureChanged: false,
          }
        : state
    }
  }
}
