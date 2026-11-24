import type { Preferences } from '@/application/ports/storage'
import type { RaceSetup } from '@/application/race/raceSession'
import { randomGridPositions } from '@/domain/race/startGrid'
import type { LightingMode, Track } from '@/domain/model'

/** New quick races use a fresh grid. Retrying a race keeps its recorded grid. */
export function withFreshStartGrid(setup: RaceSetup, random: () => number): RaceSetup {
  return setup.mode === undefined || setup.mode === 'normal'
    ? { ...setup, gridPositions: randomGridPositions(4, random) }
    : setup
}

/** The single source for quick-race setup rules, independent of UI state. */
export function raceSetupFromPreferences(
  track: Track,
  preferences: Preferences,
  lighting: LightingMode,
  random: () => number,
): RaceSetup {
  const open = track.routeKind === 'point-to-point'
  const preferredMode = preferences.raceMode ?? 'normal'
  const mode = !open && preferredMode === 'time-trial' ? 'normal' : preferredMode
  return withFreshStartGrid({
    car: preferences.car,
    difficulty: preferences.difficulty,
    laps: open ? 1 : preferences.raceLaps ?? 2,
    mode,
    lighting,
  }, random)
}
