import type { AppSnapshot } from '@/application/appState'

/** Preview snapshots only change a single top-level field. Keep the native
 * slider mounted during those updates, without suppressing unrelated changes. */
export function isSceneryRotationPreviewOnly(previous: AppSnapshot | undefined, next: AppSnapshot): boolean {
  if (!previous || previous.sceneryRotationPreview === next.sceneryRotationPreview) return false
  return Object.entries(previous).every(([key, value]) => key === 'sceneryRotationPreview' || Reflect.get(next, key) === value) &&
    Object.entries(next).every(([key, value]) => key === 'sceneryRotationPreview' || Reflect.get(previous, key) === value)
}
