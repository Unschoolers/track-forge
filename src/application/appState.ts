import type { CircuitCup } from '@/application/race/circuitCup'
import type { Preferences } from '@/application/ports/storage'
import type { ScoreEntry } from '@/application/ports/storage'
import type { TerrainBrushRadius } from '@/domain/config'
import type {
  EditorCommand,
  EditorState,
} from '@/domain/editor/editorState'
import type { AppMode } from '@/app/createApplication'
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

export type OverlayReturn =
  | { readonly type: 'none' }
  | {
      readonly type: 'track-library'
      readonly purpose: 'edit' | 'race'
    }
  | { readonly type: 'editor-menu' }

export type AppOverlay =
  | { readonly type: 'none' }
  | {
      readonly type: 'track-library'
      readonly purpose: 'edit' | 'race'
    }
  | {
      readonly type: 'track-name'
      readonly purpose: 'create' | 'rename'
      readonly returnTo: OverlayReturn
    }
  | { readonly type: 'race-setup' }
  | { readonly type: 'editor-menu' }
  | {
      readonly type: 'options'
      readonly returnTo: 'home' | 'editor' | 'race' | 'race-setup'
    }
  | { readonly type: 'pause' }
  | { readonly type: 'results' }

export interface AppSnapshot {
  readonly raceLighting?: LightingMode
  readonly raceAgainTrackName?: string | undefined
  readonly cup?: CircuitCup | null
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

export interface EditorUiState {
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
  | { readonly type: 'start-race' }
  | { readonly type: 'set-race-lighting'; readonly lighting: LightingMode }
  | { readonly type: 'race-again' }
  | { readonly type: 'start-cup' }
  | { readonly type: 'next-cup-race' }
  | { readonly type: 'pause-race' }
  | { readonly type: 'resume-race' }
  | { readonly type: 'restart-race' }
  | { readonly type: 'race-best-ghost' }
  | { readonly type: 'select-track'; readonly id: TrackId }
  | {
      readonly type: 'open-track-library'
      readonly purpose: 'edit' | 'race'
    }
  | { readonly type: 'close-overlay' }
  | {
      readonly type: 'open-track-name'
      readonly purpose: 'create' | 'rename'
    }
  | {
      readonly type: 'open-options'
      readonly returnTo: 'home' | 'editor' | 'race' | 'race-setup'
    }
  | { readonly type: 'open-editor-menu' }
  | { readonly type: 'save-current-track' }
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
