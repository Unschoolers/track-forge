import type { AppCommand, AppSnapshot } from '@/application/appState'
import type { EditorSession } from '@/application/editor/editorSession'
import { requiresEditorExitConfirmation } from '@/application/editor/editorExitPolicy'
import type { TrackLibraryService, TrackMutationResult } from '@/application/library/trackLibraryService'
import type { Persistence, TrackStore } from '@/application/ports/storage'
import { createEditorState } from '@/domain/editor/editorState'

interface EditorExitDependencies {
  readonly snapshot: () => AppSnapshot
  readonly update: (state: AppSnapshot) => void
  readonly dispatch: (command: AppCommand) => void
  readonly editorSession: Pick<EditorSession, 'isDirty' | 'save' | 'discardPendingSave'>
  readonly library: Pick<TrackLibraryService, 'select' | 'saveAs'>
  readonly trackStore: Pick<TrackStore, 'find'>
  readonly librarySnapshot: () => Pick<AppSnapshot, 'tracks' | 'scoresByTrack'>
  readonly creator: () => { readonly id: string; readonly name: string } | undefined
  readonly applyTrackMutation: (result: TrackMutationResult) => void
  readonly persist: <T>(result: Persistence<T>, complete: (result: T) => void) => void
}

/** Owns pending editor navigation and the save/discard/cancel transaction. */
export class EditorExitFlow {
  private pendingEditorExit: AppCommand | null = null

  constructor(private readonly dependencies: EditorExitDependencies) {}

  private get state(): AppSnapshot { return this.dependencies.snapshot() }

  private update(state: AppSnapshot): void { this.dependencies.update(state) }

  intercept(command: AppCommand): boolean {
    if (!this.shouldConfirmEditorExit(command)) return false
    this.pendingEditorExit = command
    this.update({ ...this.state, overlay: { type: 'editor-exit' }, notice: null })
    return true
  }

  isDirty(): boolean {
    const track = this.state.currentTrack
    return !!track && this.dependencies.editorSession.isDirty(track, this.dependencies.trackStore.find(track.id))
  }

  private shouldConfirmEditorExit(command: AppCommand): boolean {
    return this.state.mode === 'editor' &&
      requiresEditorExitConfirmation(command) &&
      // Compare potentially large drafts only when an exit is requested.
      this.isDirty()
  }

  resolve(choice: 'save' | 'save-as' | 'discard' | 'cancel'): void {
    if (this.state.overlay.type !== 'editor-exit') return
    if (choice === 'cancel') {
      this.pendingEditorExit = null
      this.update({ ...this.state, overlay: { type: 'none' }, notice: null })
      return
    }
    if (choice === 'save-as') {
      this.update({
        ...this.state,
        overlay: { type: 'track-name', purpose: 'save-as', returnTo: { type: 'editor-exit' } },
        notice: null,
      })
      return
    }
    if (choice === 'save') {
      this.dependencies.persist(this.dependencies.editorSession.save(this.state.currentTrack), saved => {
        if (!saved) {
          this.update({ ...this.state, notice: 'Save unavailable.' })
          return
        }
        this.update({ ...this.state, ...this.dependencies.librarySnapshot(), overlay: { type: 'none' }, notice: null })
        this.finish()
      })
      return
    } else {
      const trackId = this.state.currentTrack?.id
      const saved = trackId ? this.dependencies.library.select(trackId) : undefined
      // Discard is an explicit choice to abandon the draft. Even if its saved
      // baseline was deleted, allow navigation rather than trapping the user.
      this.dependencies.editorSession.discardPendingSave()
      this.update({
        ...this.state,
        ...this.dependencies.librarySnapshot(),
        currentTrack: saved ?? null,
        editor: saved
          ? createEditorState(saved.points, saved.trees, saved.start, saved.terrain, saved)
          : createEditorState([], []),
        overlay: { type: 'none' },
        notice: null,
      })
    }
    this.finish()
  }

  private finish(): void {
    const destination = this.pendingEditorExit
    this.pendingEditorExit = null
    if (destination) this.dependencies.dispatch(destination)
  }

  saveAs(name: string): void {
    if (this.state.mode !== 'editor' || this.state.overlay.type !== 'track-name' ||
        this.state.overlay.purpose !== 'save-as' || !this.state.currentTrack) return
    this.dependencies.persist(this.dependencies.library.saveAs(this.state.currentTrack, name, this.dependencies.creator()), result => {
      if (!result.ok) {
        this.update({ ...this.state, notice: result.message })
        return
      }
      this.dependencies.applyTrackMutation(result)
      this.finish()
    })
  }
}
