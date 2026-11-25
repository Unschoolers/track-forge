let resolveArtwork: (() => void) | undefined
let rejectArtwork: ((error: unknown) => void) | undefined

/** The game module can load while startup artwork is prepared, but it must not
 * mount the UI or start Phaser until every required atlas is ready. */
export const startupArtworkReady = new Promise<void>((resolve, reject) => {
  resolveArtwork = resolve
  rejectArtwork = reject
})
// `main` may still be waiting on its network chunk when artwork fails. Keep
// the deferred rejection observed until main evaluates and awaits the promise;
// the original promise still rejects for both main and boot callers.
void startupArtworkReady.catch(() => undefined)

export function finishStartupArtwork(result: { readonly ok: true } | { readonly ok: false; readonly error: unknown }): void {
  if (result.ok) resolveArtwork?.()
  else rejectArtwork?.(result.error)
  resolveArtwork = undefined
  rejectArtwork = undefined
}
