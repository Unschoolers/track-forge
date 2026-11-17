import type { TrackStore } from '@/application/ports/storage'
import { applyEditorCommand, type EditorCommand, type EditorState } from '@/domain/editor/editorState'
import type { Track, TrackId } from '@/domain/model'

export interface Scheduler {
  schedule(delayMs: number, task: () => void): () => void
}

type EditorEdit =
  | { readonly rejection: string }
  | { readonly editor: EditorState; readonly track?: Track }

export class EditorSession {
  private cancelTimer: (() => void) | undefined
  private pendingSave = false
  private saveGeneration = 0
  private gestureRevision: {
    readonly trackId: TrackId
    readonly start: NonNullable<EditorState['gestureStart']>
    readonly revision: number
  } | null = null

  constructor(
    private readonly trackStore: Pick<TrackStore, 'save'>,
    private readonly scheduler: Scheduler,
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
      (!editor.recoveryCheckpoints.length || (editor.environmentId === savedGesture.start.environmentId &&
        editor.scenery === savedGesture.start.scenery))
    if (previous.gestureStart && !editor.gestureStart) this.gestureRevision = null
    const sceneryChanged = editor.environmentId !== previous.environmentId ||
      editor.scenery !== previous.scenery
    const raceChanged = editor.points !== previous.points ||
      editor.trees !== previous.trees || editor.start !== previous.start ||
      editor.terrain !== previous.terrain || editor.routeKind !== previous.routeKind ||
      editor.recoveryCheckpoints !== previous.recoveryCheckpoints ||
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
      environmentId: editor.environmentId,
      scenery: editor.scenery,
      raceRevision: restoresGesture ? savedGesture.revision : raceChanged ? Math.max(now, previousRevision + 1) : previousRevision,
      updatedAt: now,
    }
    return { editor, track: updatedTrack }
  }

  get hasPendingSave(): boolean {
    return this.pendingSave
  }

  queueSave(flush: () => void): void {
    this.stopTimer()
    this.pendingSave = true
    const generation = this.saveGeneration
    this.cancelTimer = this.scheduler.schedule(120, () => {
      if (generation === this.saveGeneration) flush()
    })
  }

  save(track: Track | null): boolean {
    this.stopTimer()
    this.pendingSave = !track || !this.trackStore.save(track)
    return !this.pendingSave
  }

  discardPendingSave(): void {
    this.stopTimer()
    this.pendingSave = false
    this.gestureRevision = null
  }

  private stopTimer(): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
    this.saveGeneration++
  }
}
