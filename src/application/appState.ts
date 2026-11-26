import { sceneryKindBelongsToEnvironment } from '@/domain/track/trackEnvironment'
import type { SceneryPropKind, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { TimeMedal } from '@/application/race/raceRecords'
import type { CircuitCup, CupProgress } from '@/application/race/circuitCup'
import type { Preferences } from '@/application/ports/storage'
import type { ScoreEntry } from '@/application/ports/storage'
import type { TerrainBrushRadius } from '@/domain/config'
import type {
  EditorCommand,
  EditorState,
} from '@/domain/editor/editorState'
/** Application navigation state; host adapters consume this instead of owning it. */
export type AppMode = 'home' | 'editor' | 'race'
import type { LightingMode, RoadStructure, Track, TrackId } from '@/domain/model'
import type {
  EditorCommandRejection,
} from '@/domain/editor/editorConstraints'
import type { TerrainBrushMode } from '@/domain/editor/terrainBrush'
import type {
  EditorSurface,
  EditorCameraAction,
  EditorTool,
} from '@/domain/editor/editorGeometry'

type TrackLibraryOverlay = {
  readonly type: 'track-library'
  readonly purpose: 'edit' | 'race' | 'nearby' | 'nearby-host' | 'cup'
  readonly cupReturnTo?: 'nearby'
}

export type OverlayReturn =
  | { readonly type: 'none' }
  | TrackLibraryOverlay
  | { readonly type: 'editor-menu' }
  | { readonly type: 'editor-exit' }

export type AppOverlay =
  | { readonly type: 'none' }
  | TrackLibraryOverlay
  | {
      readonly type: 'track-name'
      readonly purpose: 'create' | 'rename' | 'save-as'
      readonly returnTo: OverlayReturn
    }
  | { readonly type: 'player-name' }
  | { readonly type: 'race-setup' }
  | { readonly type: 'cup'; readonly returnTo?: 'nearby' }
  | { readonly type: 'nearby'; readonly confirmLeave?: true }
  | { readonly type: 'editor-menu' }
  | { readonly type: 'editor-exit' }
  | {
      readonly type: 'options'
      readonly returnTo: 'home' | 'editor' | 'race' | 'race-setup'
      readonly tab?: 'updates'
    }
  | { readonly type: 'pause' }
  | { readonly type: 'results' }
  | { readonly type: 'cup-final' }

export interface AppSnapshot {
  readonly raceLighting?: LightingMode
  readonly raceAgainTrackName?: string | undefined
  readonly cup?: CircuitCup | null
  readonly cupProgress?: CupProgress | undefined
  readonly newTimeMedal?: TimeMedal | null
  readonly mode: AppMode
  readonly paused: boolean
  readonly overlay: AppOverlay
  readonly tracks: readonly Track[]
  readonly currentTrack: Track | null
  readonly editor: EditorState
  readonly editorUi: EditorUiState
  readonly preferences: Preferences
  readonly scoresByTrack: Readonly<
    Record<string, readonly ScoreEntry[]>
  >
  readonly notice: string | null
}

export type EditorSceneryChoice = 'tree' | SceneryPropKind | 'erase-scenery'

export function normalizeEditorSceneryChoice(choice: EditorSceneryChoice | undefined, environmentId: TrackEnvironmentId): EditorSceneryChoice {
  if (choice === 'erase-scenery') return choice
  if (choice === 'tree') return environmentId === 'kids-room' ? 'kids-blocks' : choice
  return choice && sceneryKindBelongsToEnvironment(choice, environmentId)
    ? choice
    : environmentId === 'kids-room' ? 'kids-blocks' : 'tree'
}

export interface EditorUiState {
  readonly sceneryChoice?: EditorSceneryChoice
  readonly tool: EditorTool
  readonly surface: EditorSurface
  readonly structure: RoadStructure
  readonly terrainBrush: {
    readonly mode: TerrainBrushMode
    readonly radius: TerrainBrushRadius
  }
  readonly grid: boolean
  readonly cameraRequest: {
    readonly sequence: number
    readonly action: EditorCameraAction
  } | null
  readonly selectedCrossing: string | null
  readonly selectedPoint: number | null
}

export type AppCommand =
  | { readonly type: 'go-home' }
  | { readonly type: 'open-editor' }
  | { readonly type: 'race-current-track' }
  | { readonly type: 'start-race' }
  | { readonly type: 'open-nearby' }
  | { readonly type: 'send-nearby-track'; readonly track: Track }
  | { readonly type: 'scan-nearby-track' }
  | { readonly type: 'save-nearby-track' }
  | { readonly type: 'decline-nearby-track' }
  | { readonly type: 'nearby-race-again' }
  | { readonly type: 'nearby-select-next-track' }
  | { readonly type: 'scan-nearby' }
  | { readonly type: 'leave-nearby' }
  | { readonly type: 'nearby-scene-ready' }
  | { readonly type: 'set-race-lighting'; readonly lighting: LightingMode }
  | { readonly type: 'race-again' }
  | { readonly type: 'open-cup' }
  | { readonly type: 'cup-add-track' }
  | { readonly type: 'cup-remove-track'; readonly index: number }
  | { readonly type: 'cup-move-track'; readonly index: number; readonly direction: -1 | 1 }
  | { readonly type: 'host-nearby-cup' }
  | { readonly type: 'start-cup' }
  | { readonly type: 'resume-cup' }
  | { readonly type: 'next-cup-race' }
  | { readonly type: 'pause-race' }
  | { readonly type: 'resume-race' }
  | { readonly type: 'restart-race' }
  | { readonly type: 'race-best-ghost' }
  | { readonly type: 'select-track'; readonly id: TrackId }
  | {
      readonly type: 'open-track-library'
      readonly purpose: 'edit' | 'race' | 'nearby' | 'nearby-host' | 'cup'
    }
  | { readonly type: 'close-overlay' }
  | { readonly type: 'open-player-name' }
  | { readonly type: 'set-player-name'; readonly name: string }
  | {
      readonly type: 'open-track-name'
      readonly purpose: 'create' | 'rename' | 'save-as'
    }
  | {
      readonly type: 'open-options'
      readonly returnTo: 'home' | 'editor' | 'race' | 'race-setup'
      readonly tab?: 'updates'
    }
  | { readonly type: 'open-editor-menu' }
  | { readonly type: 'save-current-track' }
  | { readonly type: 'save-as-track'; readonly name: string }
  | { readonly type: 'resolve-editor-exit'; readonly choice: 'save' | 'save-as' | 'discard' | 'cancel' }
  | { readonly type: 'set-editor-scenery'; readonly choice: EditorSceneryChoice }
  | { readonly type: 'set-editor-tool'; readonly tool: EditorTool }
  | {
      readonly type: 'set-editor-surface'
      readonly surface: EditorSurface
    }
  | {
      readonly type: 'set-editor-structure'
      readonly structure: RoadStructure
    }
  | {
      readonly type: 'set-editor-terrain-mode'
      readonly mode: TerrainBrushMode
    }
  | {
      readonly type: 'set-editor-terrain-radius'
      readonly radius: TerrainBrushRadius
    }
  | { readonly type: 'toggle-editor-grid' }
  | {
      readonly type: 'select-editor-crossing'
      readonly key: string | null
    }
  | {
      readonly type: 'select-editor-point'
      readonly index: number | null
    }
  | {
      readonly type: 'request-editor-camera'
      readonly action: EditorCameraAction
    }
  | { readonly type: 'create-track'; readonly name: string }
  | { readonly type: 'rename-track'; readonly name: string }
  | { readonly type: 'delete-track'; readonly id: TrackId }
  | { readonly type: 'toggle-track-favorite'; readonly id: TrackId }
  | { readonly type: 'import-track'; readonly content: string }
  | { readonly type: 'select-track-for-edit'; readonly id: TrackId }
  | { readonly type: 'select-track-for-race'; readonly id: TrackId }
  | { readonly type: 'editor'; readonly command: EditorCommand }
  | {
      readonly type: 'report-editor-rejection'
      readonly rejection: EditorCommandRejection
    }
  | {
      readonly type: 'set-preferences'
      readonly preferences: Preferences
    }

export type AppEvent = {
  readonly type: 'state-changed'
  readonly snapshot: AppSnapshot
}
