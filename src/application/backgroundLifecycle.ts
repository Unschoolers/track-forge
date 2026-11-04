import type { AppCommand, AppSnapshot } from '@/application/appState'

interface BackgroundController {
  flushPendingEditorSave(): void
  snapshot(): Pick<AppSnapshot, 'mode' | 'overlay'>
  dispatch(command: AppCommand): void
}

export function handleBackground(controller: BackgroundController): void {
  controller.flushPendingEditorSave()
  const snapshot = controller.snapshot()
  if (snapshot.mode === 'race' && snapshot.overlay.type !== 'results') {
    controller.dispatch({ type: 'pause-race' })
  }
}
