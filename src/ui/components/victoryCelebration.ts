import type { GraphicsQuality } from '@/application/ports/storage'

export type PlayVictoryFireworks = (host: HTMLElement, quality: GraphicsQuality) => () => void

/** The results overlay may be rebuilt or receive a late Nearby medal. Play once per run. */
export class VictoryCelebration {
  private playedRun: number | undefined

  attach(overlay: HTMLElement, runId: number | undefined, quality: GraphicsQuality, play: PlayVictoryFireworks): () => void {
    if (runId === undefined || this.playedRun === runId) return () => undefined
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (motion?.matches) {
      this.playedRun = runId
      return () => undefined
    }
    let layer: HTMLElement | undefined
    let stop: (() => void) | undefined
    const clear = (): void => {
      stop?.()
      stop = undefined
      layer?.remove()
      layer = undefined
    }
    const sync = (): void => {
      if (layer && !overlay.contains(layer)) clear()
      if (this.playedRun === runId || motion?.matches || !overlay.isConnected) return
      const medal = overlay.querySelector<HTMLElement>('.results-celebration[data-medal="GOLD"]')
      if (!medal) return
      this.playedRun = runId
      layer = document.createElement('div')
      layer.className = 'results-victory-fireworks'
      layer.setAttribute('aria-hidden', 'true')
      medal.prepend(layer)
      stop = play(layer, quality)
    }
    const observer = new MutationObserver(sync)
    observer.observe(overlay, { childList: true, subtree: true })
    const onMotion = (): void => {
      if (motion?.matches) {
        this.playedRun = runId
        clear()
      }
    }
    motion?.addEventListener?.('change', onMotion)
    sync()
    return () => {
      observer.disconnect()
      motion?.removeEventListener?.('change', onMotion)
      clear()
    }
  }
}
