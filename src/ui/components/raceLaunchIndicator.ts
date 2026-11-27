import { element } from '@/ui/dom'

/** Paint feedback before blocking work and retain it until the matching
 * scene submits its first frame. Does not own the gameplay clock. */
export class RaceLaunchIndicator {
  private node: HTMLElement | undefined
  private frame: number | undefined
  private runId: number | undefined
  private startedAt = 0
  private dispatchStartedAt = 0
  private dispatchEndedAt = 0
  private lastTiming: { runId: number; paintYieldMs: number; dispatchMs: number; sceneToFirstFrameMs: number; totalMs: number } | undefined
  private readonly covered = new Set<HTMLElement>()

  constructor(private readonly root: HTMLElement) {}

  get awaitingPresentation(): boolean { return this.runId !== undefined }

  begin(launch: () => number | undefined): void {
    if (this.node) return
    this.startedAt = performance.now()
    const node = element('div', 'race-launch-overlay')
    node.setAttribute('role', 'status')
    node.setAttribute('aria-live', 'polite')
    const spinner = element('div', 'race-launch-spinner')
    spinner.setAttribute('aria-hidden', 'true')
    node.append(spinner, element('p', 'race-launch-label', 'Loading race…'))
    this.node = node
    this.cover()
    // A single RAF runs before paint: allow one full frame first.
    this.frame = window.requestAnimationFrame(() => {
      this.frame = window.requestAnimationFrame(() => {
        this.frame = undefined
        if (this.node !== node) return
        this.dispatchStartedAt = performance.now()
        try {
          this.runId = launch()
          this.dispatchEndedAt = performance.now()
        } finally {
          if (this.runId === undefined) this.cancel()
        }
      })
    })
  }

  cover(): void {
    const node = this.node
    if (!node) return
    for (const child of this.covered) {
      if (child.parentElement !== this.root) {
        child.inert = false
        this.covered.delete(child)
      }
    }
    for (const child of this.root.children) {
      if (child !== node && child instanceof HTMLElement && !child.inert) {
        child.inert = true
        this.covered.add(child)
      }
    }
    if (node.parentElement !== this.root) this.root.append(node)
  }

  presented(runId: number | undefined): void {
    if (runId === undefined || this.runId !== runId) return
    const end = performance.now()
    this.lastTiming = {
      runId,
      paintYieldMs: this.dispatchStartedAt - this.startedAt,
      dispatchMs: this.dispatchEndedAt - this.dispatchStartedAt,
      sceneToFirstFrameMs: end - this.dispatchEndedAt,
      totalMs: end - this.startedAt,
    }
    this.cancel()
  }

  timing(runId: number | undefined) {
    return this.lastTiming?.runId === runId ? this.lastTiming : undefined
  }

  cancel(): void {
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame)
    this.frame = undefined
    this.runId = undefined
    this.node?.remove()
    this.node = undefined
    for (const child of this.covered) child.inert = false
    this.covered.clear()
  }
}
