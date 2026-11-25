import type { CarId, SurfaceId } from '@/domain/model'
import type { CountdownCue } from '@/domain/race/raceState'

export const FEEDBACK_EVENT_TYPES = [
  'ui',
  'countdown',
  'engine',
  'surface',
  'tire-slip',
  'curb',
  'landing',
  'rival',
  'position-change',
  'finish',
  'boost-ignition',
] as const

export type FeedbackEvent =
  | { readonly type: 'countdown'; readonly cue: CountdownCue }
  | { readonly type: 'ui'; readonly emphasis: 'normal' | 'confirm' | 'danger' }
  | {
      readonly type: 'engine'
      readonly car: CarId
      readonly speedRatio: number
      readonly throttle: number
      readonly cornering: number
    }
  | {
      readonly type: 'surface'
      readonly surface: SurfaceId | 'grass'
      readonly speedRatio: number
    }
  | { readonly type: 'tire-slip'; readonly strength: number; readonly speedRatio?: number; readonly surface?: SurfaceId | 'grass' }
  | { readonly type: 'landing'; readonly strength: number }
  | { readonly type: 'rival'; readonly proximity: number; readonly pan: number; readonly speedRatio: number }
  | { readonly type: 'curb'; readonly speed: number }
  | { readonly type: 'boost-ignition' }
  | { readonly type: 'position-change'; readonly direction: 'gain' | 'loss'; readonly place: number }
  | {
      readonly type: 'finish'
      readonly place: number
      readonly newRecord: boolean
    }

export interface FeedbackPort {
  unlock(): void
  setEnabled(enabled: boolean): void
  handle(event: FeedbackEvent): void
  silenceContinuous(): void
  destroy(): void
}
