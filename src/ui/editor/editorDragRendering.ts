import type { AppSnapshot } from '@/application/appState'

/** The DOM has no live point-coordinate display during a select gesture.
 * Preserve it while only the road position changes; refresh diagnostics and
 * selection panels at gesture end, and never defer menus or other UI changes. */
export function deferEditorDragChrome(previous: AppSnapshot | undefined, next: AppSnapshot): boolean {
  if (!previous || previous.mode !== 'editor' || next.mode !== 'editor' ||
    previous.overlay.type !== 'none' || next.overlay.type !== 'none' ||
    previous.editorUi.tool !== 'select' || next.editorUi.tool !== 'select' ||
    !next.editor.gestureStart || previous.editor.gestureStart !== next.editor.gestureStart ||
    next.editor.points === previous.editor.points ||
    next.editor.points.length !== previous.editor.points.length ||
    next.notice !== previous.notice || next.preferences !== previous.preferences ||
    next.currentTrack?.id !== previous.currentTrack?.id ||
    next.currentTrack?.name !== previous.currentTrack?.name ||
    next.currentTrack?.lighting !== previous.currentTrack?.lighting ||
    next.editor.terrain !== previous.editor.terrain ||
    next.editor.trees !== previous.editor.trees ||
    next.editor.scenery !== previous.editor.scenery ||
    next.editor.start !== previous.editor.start ||
    next.editor.recoveryCheckpoints !== previous.editor.recoveryCheckpoints ||
    next.editor.routeKind !== previous.editor.routeKind ||
    next.editor.environmentId !== previous.editor.environmentId) return false
  // AppController can normalize sceneryChoice into a new editorUi wrapper.
  // Compare its fields, not wrapper identity.
  const a = previous.editorUi
  const b = next.editorUi
  return a.sceneryChoice === b.sceneryChoice && a.surface === b.surface &&
    a.structure === b.structure && a.terrainBrush === b.terrainBrush &&
    a.grid === b.grid && a.cameraRequest === b.cameraRequest &&
    a.selectedPoint === b.selectedPoint && a.selectedCrossing === b.selectedCrossing
}
