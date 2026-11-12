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
    if (event.type === 'collision') this.vibrate([35, 20, 45])
    else if (event.type === 'landing') this.vibrate([10, 20, 12])
    else if (event.type === 'curb') this.vibrate([12])
    else if (event.type === 'finish') this.vibrate([30, 35, 30, 35, 80])
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
