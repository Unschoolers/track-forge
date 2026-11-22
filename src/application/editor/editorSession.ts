import type { TrackStore } from '@/application/ports/storage'
import { applyEditorCommand, type EditorCommand, type EditorState } from '@/domain/editor/editorState'
import { normalizeRouteKind, type Track, type TrackId } from '@/domain/model'
import { DEFAULT_TRACK_ENVIRONMENT_ID } from '@/domain/track/trackEnvironment'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

type EditorEdit =
  | { readonly rejection: string }
  | { readonly editor: EditorState; readonly track?: Track }

export class EditorSession {
  private gestureRevision: {
    readonly trackId: TrackId
    readonly start: NonNullable<EditorState['gestureStart']>
    readonly revision: number
  } | null = null

  constructor(
    private readonly trackStore: Pick<TrackStore, 'save'>,
    private readonly now: () => number,
  ) {}

  apply(previous: EditorState, currentTrack: Track, command: EditorCommand): EditorEdit {
    const result = applyEditorCommand(previous, command)
    if (result.rejection) return { rejection: result.rejection.message }
    const editor = result.state
    if (editor === previous) return { editor }
    const previousRevision = currentTrack.raceRevision ?? currentTrack.updatedAt
    if (!previous.gestureStart && editor.gestureStart) {
      this.gestureRevision = { trackId: currentTrack.id, start: editor.gestureStart, revision: previousRevision }
    }
    const savedGesture = this.gestureRevision
    const restoresGesture = (command.type === 'cancel-gesture' || command.type === 'undo') &&
      savedGesture?.trackId === currentTrack.id &&
      savedGesture.start === previous.gestureStart &&
      editor.points === savedGesture.start.points && editor.trees === savedGesture.start.trees &&
      editor.start === savedGesture.start.start && editor.terrain === savedGesture.start.terrain &&
      editor.routeKind === savedGesture.start.routeKind &&
      editor.recoveryCheckpoints === savedGesture.start.recoveryCheckpoints &&
      editor.autoCheckpoints === savedGesture.start.autoCheckpoints &&
      (!editor.recoveryCheckpoints.length || (editor.environmentId === savedGesture.start.environmentId &&
        editor.scenery === savedGesture.start.scenery))
    if (previous.gestureStart && !editor.gestureStart) this.gestureRevision = null
    const sceneryChanged = editor.environmentId !== previous.environmentId ||
      editor.scenery !== previous.scenery
    const raceChanged = editor.points !== previous.points ||
      editor.trees !== previous.trees || editor.start !== previous.start ||
      editor.terrain !== previous.terrain || editor.routeKind !== previous.routeKind ||
      editor.recoveryCheckpoints !== previous.recoveryCheckpoints ||
      editor.autoCheckpoints !== previous.autoCheckpoints ||
      (editor.recoveryCheckpoints.length > 0 && sceneryChanged)
    const contentChanged = raceChanged || sceneryChanged
    if (!contentChanged && !(restoresGesture && previousRevision !== savedGesture.revision)) {
      return { editor }
    }
    const now = this.now()
    const updatedTrack = {
      ...currentTrack,
      points: editor.points,
      trees: editor.trees,
      start: editor.start ?? { ratio: 0, reversed: false },
      terrain: editor.terrain,
      routeKind: editor.routeKind,
      recoveryCheckpoints: editor.recoveryCheckpoints,
      autoCheckpoints: editor.autoCheckpoints,
      environmentId: editor.environmentId,
      scenery: editor.scenery,
      raceRevision: restoresGesture ? savedGesture.revision : raceChanged ? Math.max(now, previousRevision + 1) : previousRevision,
      updatedAt: now,
    }
    return { editor, track: updatedTrack }
  }

  /** Only deliberate Save/Save As actions write an editor draft. */
  save(track: Track | null): boolean {
    return !!track && this.trackStore.save(track)
  }

  /** Compare editable content, not timestamps: undo back to the saved state is clean. */
  isDirty(draft: Track | null, saved: Track | undefined): boolean {
    if (!draft) return false
    // A missing persisted baseline is an unsaved draft, not a clean editor.
    if (!saved) return true
    const content = (track: Track): string => JSON.stringify({
      name: track.name,
      points: track.points,
      trees: track.trees,
      start: track.start ?? { ratio: 0, reversed: false },
      terrain: track.terrain ?? EMPTY_TERRAIN,
      routeKind: normalizeRouteKind(track.routeKind),
      recoveryCheckpoints: track.recoveryCheckpoints ?? [],
      autoCheckpoints: track.autoCheckpoints ?? false,
      environmentId: track.environmentId ?? DEFAULT_TRACK_ENVIRONMENT_ID,
      scenery: track.scenery ?? [],
    })
    return content(draft) !== content(saved)
  }

  discardPendingSave(): void {
    this.gestureRevision = null
  }

}
