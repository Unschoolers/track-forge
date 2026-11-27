import type {
  FeedbackEvent,
  FeedbackPort,
} from '@/application/ports/feedback'

type PulseKind = 'grass' | 'landing' | 'other'

export class HapticsAdapter implements FeedbackPort {
  private surface: string | undefined
  private nextGrassAt = 0
  private activeUntil = 0
  private activeKind: PulseKind | undefined

  constructor(
    private readonly vibrate:
      | ((pattern: number | number[]) => boolean)
      | undefined,
    private enabled: boolean,
    private readonly now: () => number = () => performance.now(),
  ) {}

  unlock(): void {}

  setEnabled(enabled: boolean): void {
    if (this.enabled && !enabled) this.silenceContinuous()
    this.enabled = enabled
  }

  handle(event: FeedbackEvent): void {
    if (!this.enabled || !this.vibrate) return
    if (event.type === 'surface') {
      this.handleSurface(event)
      return
    }
    // The Vibration API replaces an in-progress pattern on each call.
    // Do not let a curb, UI or position cue erase the landing impact.
    if (event.type !== 'landing' && event.type !== 'finish' &&
      this.activeKind === 'landing' && this.now() < this.activeUntil) return

    if (event.type === 'landing') {
      this.pulse(Math.round(50 + 50 * Math.max(0, Math.min(1, event.strength))), 'landing')
    } else if (event.type === 'curb') this.pulse([12])
    else if (event.type === 'boost-ignition') this.pulse([18])
    else if (event.type === 'finish') this.pulse(event.place === 1 ? [35, 45, 45, 45, 95] : [30, 35, 30, 35, 80])
    else if (event.type === 'position-change') {
      this.pulse(event.direction === 'gain'
        ? event.place === 1 ? [18, 25, 40, 30, 48] : [15, 25, 32]
        : [42])
    } else if (event.type === 'ui') {
      this.pulse(event.emphasis === 'danger' ? [18, 25, 28] : [8])
    }
  }

  private handleSurface(event: Extract<FeedbackEvent, { type: 'surface' }>): void {
    const now = this.now()
    const changed = event.surface !== this.surface
    this.surface = event.surface
    if (event.surface !== 'grass' || event.speedRatio <= 0.1 || event.grounded === false) {
      this.nextGrassAt = 0
      if (this.activeKind === 'grass' && now < this.activeUntil) this.cancel()
      if (changed && event.surface !== 'street' && event.surface !== 'grass' &&
        event.speedRatio > 0.1 && event.grounded !== false && now >= this.activeUntil) this.pulse([6])
      return
    }
    if (now < this.nextGrassAt || now < this.activeUntil) return
    const speed = Math.min(1, event.speedRatio)
    // Brief, sparse pulses: no timers, no vibration call per simulation tick.
    this.pulse([Math.round(18 + 10 * speed)], 'grass')
    this.nextGrassAt = now + Math.round(220 - 100 * speed)
  }

  private pulse(pattern: number | number[], kind: PulseKind = 'other'): void {
    if (!this.vibrate?.(pattern)) return
    this.activeKind = kind
    this.activeUntil = this.now() + (typeof pattern === 'number'
      ? pattern
      : pattern.reduce((total, duration) => total + duration, 0))
  }

  private cancel(): void {
    this.vibrate?.(0)
    this.activeKind = undefined
    this.activeUntil = 0
  }

  silenceContinuous(): void {
    this.surface = undefined
    this.nextGrassAt = 0
    if (this.activeKind !== undefined && this.now() < this.activeUntil) this.cancel()
    this.activeKind = undefined
    this.activeUntil = 0
  }

  destroy(): void {
    this.setEnabled(false)
  }
}
