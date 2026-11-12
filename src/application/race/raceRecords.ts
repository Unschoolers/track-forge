import type { ScoreCategory, ScoreEntry } from '@/application/ports/storage'
import type { Track } from '@/domain/model'
import type { RaceSetup } from '@/application/race/raceSession'

/** Versioned, deterministic race-affecting content; metadata and authoring IDs are excluded. */
export function courseIdentity(track: Track): string {
  const canonical = JSON.stringify([1,
    track.points.map((p) => [p.x, p.y, p.surface, p.curve ?? 'smooth', p.tension ?? 0.5, p.structure ?? 'surface']),
    track.trees.map((tree) => [tree.x, tree.y]),
    [track.terrain.cellSize, [...track.terrain.cells].sort((a, b) => a.column - b.column || a.row - b.row || a.kind.localeCompare(b.kind)).map((cell) => [cell.column, cell.row, cell.kind])],
    [track.start?.ratio ?? 0, track.start?.reversed ?? false],
  ])
  // Two independently seeded 32-bit FNV-1a streams yield a compact 64-bit digest.
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let i = 0; i < canonical.length; i++) {
    const code = canonical.charCodeAt(i)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x01000193)
  }
  return `v2:${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

export function raceCategory(track: Track, setup: RaceSetup): ScoreCategory {
  return { course: courseIdentity(track), laps: setup.laps, handling: setup.handling ?? 'arcade', mode: setup.mode ?? 'normal' }
}

export function sameCategory(score: ScoreEntry, category: ScoreCategory, setup: Pick<RaceSetup, 'car' | 'difficulty'>): boolean {
  const other = score.category
  return !!other && other.course === category.course && other.laps === category.laps &&
    other.handling === category.handling && other.mode === category.mode &&
    score.car === setup.car && score.difficulty === setup.difficulty
}

export function scoreCategoryLabel(score: ScoreEntry): string {
  const category = score.category
  return category ? `${score.car} · ${score.difficulty} · ${category.laps} ${category.laps === 1 ? 'lap' : 'laps'} · ${category.handling} · ${category.mode}` : 'Legacy · settings unknown'
}
