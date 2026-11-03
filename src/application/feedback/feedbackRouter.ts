import type {
  FeedbackEvent,
  FeedbackPort,
} from '@/application/ports/feedback'

export interface FeedbackRouterDependencies {
  readonly audio: FeedbackPort
  readonly haptics: FeedbackPort
  readonly now?: () => number
}

export interface FeedbackChannels {
  readonly audio: boolean
  readonly haptics: boolean
}

export class FeedbackRouter implements FeedbackPort {
  private readonly now: () => number
  private readonly lastContinuous = new Map<'curb' | 'tire-slip', number>()
  private unlocked = false
  private destroyed = false

  constructor(private readonly dependencies: FeedbackRouterDependencies) {
    this.now = dependencies.now ?? (() => performance.now())
  }

  unlock(): void {
    if (this.unlocked || this.destroyed) return
    this.unlocked = true
    this.dependencies.audio.unlock()
    this.dependencies.haptics.unlock()
  }

  setEnabled(enabled: boolean): void {
    this.dependencies.audio.setEnabled(enabled)
    this.dependencies.haptics.setEnabled(enabled)
  }

  setChannels(channels: FeedbackChannels): void {
    this.dependencies.audio.setEnabled(channels.audio)
    this.dependencies.haptics.setEnabled(channels.haptics)
  }

  handle(event: FeedbackEvent): void {
    if (this.destroyed || this.rateLimited(event)) return
    this.dependencies.audio.handle(event)
    this.dependencies.haptics.handle(event)
  }

  silenceContinuous(): void {
    if (this.destroyed) return
    this.dependencies.audio.silenceContinuous()
    this.dependencies.haptics.silenceContinuous()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.lastContinuous.clear()
    this.dependencies.audio.destroy()
    this.dependencies.haptics.destroy()
  }

  private rateLimited(event: FeedbackEvent): boolean {
    if (event.type !== 'curb' && event.type !== 'tire-slip') return false
    const now = this.now()
    const previous = this.lastContinuous.get(event.type)
    const interval = event.type === 'curb' ? 95 : 120
    if (previous !== undefined && now - previous < interval) return true
    this.lastContinuous.set(event.type, now)
    return false
  }
}
