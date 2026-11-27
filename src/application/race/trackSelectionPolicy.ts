import type { TrackLibraryPurpose } from '@/application/appState'

export type TrackSelectionDecision =
  | { readonly type: 'invalid' }
  | { readonly type: 'cup'; readonly lineupFull: boolean }
  | { readonly type: 'nearby-rematch' }
  | { readonly type: 'nearby-host'; readonly available: boolean }
  | { readonly type: 'solo' }

export function decideTrackSelection(input: {
  readonly ready: boolean
  readonly trackLibraryPurpose: TrackLibraryPurpose | undefined
  readonly cupLineupLength: number
  readonly nearbyHostAvailable: boolean
}): TrackSelectionDecision {
  if (!input.ready) return { type: 'invalid' }

  switch (input.trackLibraryPurpose) {
    case 'cup':
      return { type: 'cup', lineupFull: input.cupLineupLength >= 12 }
    case 'nearby':
      return { type: 'nearby-rematch' }
    case 'nearby-host':
      return { type: 'nearby-host', available: input.nearbyHostAvailable }
    default:
      return { type: 'solo' }
  }
}
