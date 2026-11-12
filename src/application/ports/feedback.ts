import type { CarId, SurfaceId } from '@/domain/model'

export const FEEDBACK_EVENT_TYPES = [
  'ui',
  'engine',
  'surface',
  'tire-slip',
  'curb',
  'landing',
  'rival',
  'collision',
  'finish',
] as const

export type FeedbackEvent =
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
  | { readonly type: 'collision'; readonly strength: number }
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
