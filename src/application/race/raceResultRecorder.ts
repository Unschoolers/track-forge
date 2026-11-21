import { normalizeRouteKind, type Track } from '@/domain/model'
import { rankVehicles } from '@/domain/race/ranking'
import type { RaceOutcome, RaceState, RaceVehicle } from '@/domain/race/raceState'
import { raceCategory, sameCategory } from '@/application/race/raceRecords'
import type { ScoreEntry, ScoreStore } from '@/application/ports/storage'
import type { RaceResult, RaceSetup, RaceSplit, RaceStanding } from '@/application/race/raceSession'

export interface RaceResultInput {
  readonly state: RaceState
  readonly track: Track | null
  readonly setup: RaceSetup | null
  readonly terminalReason: RaceOutcome | undefined
  readonly scoreStore: ScoreStore
  readonly now: () => number
  readonly splits: readonly RaceSplit[]
  readonly bestGhostTime: number | undefined
}

/** Record a completed race once, preserving category matching and write failures. */
export function createRaceResult({ track, setup, state, terminalReason, scoreStore, now, splits, bestGhostTime }: RaceResultInput): RaceResult | null {
    if (!track || !setup) return null
    const ranked = rankVehicles(state.vehicles, state.path.points.length, state.startPathIndex, state.reversed, normalizeRouteKind(track?.routeKind))
    const player = ranked.find((vehicle) => vehicle.player)
    if (!player) return null
    const outcome =
      terminalReason ??
      (player.wrecked
        ? 'wrecked'
        : player.finishedAt !== null
          ? 'finished'
          : null)
    if (!outcome) return null
    if (setup.mode === 'nearby') {
      return {
        mode: 'nearby', outcome, trackId: track.id, trackName: track.name,
        playerPlace: 1, playerTime: outcome === 'finished' ? player.finishedAt : null,
        playerWrecked: player.wrecked, newRecord: false, standings: [], highScores: [],
      }
    }
    const category = raceCategory(track, setup)
    const comparable = (score: ScoreEntry) => sameCategory(score, category, setup)
    const oldScores = scoreStore.forTrack(track.id).filter(comparable)
    const previousBestTime = oldScores.length ? Math.min(...oldScores.map((score) => score.time)) : undefined
    const playerTime =
      outcome === 'finished' ? player.finishedAt : null
    const recordCandidate =
      playerTime !== null &&
      (previousBestTime === undefined || playerTime < previousBestTime)
    let scoreSaved = true
    if (playerTime !== null) {
      scoreSaved = scoreStore.record(track.id, {
        time: playerTime,
        category,
        car: setup.car,
        difficulty: setup.difficulty,
        recordedAt: now(),
      })
    }
    return {
      outcome,
      mode: setup.mode ?? 'normal',
      routeKind: normalizeRouteKind(track.routeKind),
      splits: [...splits],
      trackId: track.id,
      trackName: track.name,
      playerPlace: ranked.indexOf(player) + 1,
      playerTime,
      playerWrecked: player.wrecked,
      newRecord: recordCandidate && scoreSaved,
      ...(previousBestTime !== undefined ? { previousBestTime } : {}),
      ...(playerTime !== null && !scoreSaved ? { scoreSaveFailed: true } : {}),
      standings: ranked.map((vehicle, index) =>
        toRaceStanding(vehicle, index),
      ),
      highScores: scoreStore.forTrack(track.id).filter(comparable),
      ...(setup.mode === 'ghost' && bestGhostTime !== undefined ? { ghostTime: bestGhostTime } : {}),
    }
  }

export function toRaceStanding(vehicle: RaceVehicle, index: number): RaceStanding {
    return {
      id: vehicle.id,
      car: vehicle.car,
      player: vehicle.player,
      place: index + 1,
      finishTime: vehicle.finishedAt,
      wrecked: vehicle.wrecked,
      lap: vehicle.lap,
    }
  }
