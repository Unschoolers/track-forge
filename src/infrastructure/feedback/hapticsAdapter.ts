import type {
  FeedbackEvent,
  FeedbackPort,
} from '@/application/ports/feedback'

export class HapticsAdapter implements FeedbackPort {
  private surface: string | undefined
  constructor(
    private readonly vibrate:
      | ((pattern: number | number[]) => boolean)
      | undefined,
    private enabled: boolean,
  ) {}

  unlock(): void {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.surface = undefined
  }

  handle(event: FeedbackEvent): void {
    if (!this.enabled || !this.vibrate) return
    else if (event.type === 'landing') this.vibrate(Math.round(12 + 28 * event.strength))
    else if (event.type === 'curb') this.vibrate([12])
    else if (event.type === 'boost-ignition') this.vibrate([18])
    else if (event.type === 'finish') this.vibrate(event.place === 1 ? [35, 45, 45, 45, 95] : [30, 35, 30, 35, 80])
    else if (event.type === 'position-change') {
      this.vibrate(event.direction === 'gain'
        ? event.place === 1 ? [18, 25, 40, 30, 48] : [15, 25, 32]
        : [42])
    }
    else if (event.type === 'ui') {
      this.vibrate(event.emphasis === 'danger' ? [18, 25, 28] : [8])
    } else if (event.type === 'surface') {
      if (event.surface !== this.surface && event.surface !== 'street' && event.speedRatio > 0.1) {
        this.vibrate([event.surface === 'grass' ? 10 : 6])
      }
      this.surface = event.surface
    }
  }

  silenceContinuous(): void { this.surface = undefined }

  destroy(): void {}
}
