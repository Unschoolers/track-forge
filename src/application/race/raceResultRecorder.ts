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
      (player.finishedAt !== null ? 'finished' : null)
    if (!outcome) return null
    if (setup.mode === 'nearby') {
      return {
        mode: 'nearby', outcome, trackId: track.id, trackName: track.name,
        playerPlace: 1, playerTime: outcome === 'finished' ? player.finishedAt : null,
        newRecord: false, standings: [], highScores: [],
      }
    }
    const category = raceCategory(track, setup)
    const comparable = (score: ScoreEntry) => sameCategory(score, category, setup)
    // Local/legacy stores can contain long histories. Never spread all
    // recorded times into one Math.min call (V8 has an argument limit).
    let previousBestTime: number | undefined
    for (const score of scoreStore.forTrack(track.id)) {
      if (!comparable(score)) continue
      previousBestTime = previousBestTime === undefined
        ? score.time
        : Math.min(previousBestTime, score.time)
    }
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
      finishGate: (state.timingGates?.length ?? 0) + 1,
      trackId: track.id,
      trackName: track.name,
      playerPlace: ranked.indexOf(player) + 1,
      playerTime,
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
      lap: vehicle.lap,
    }
  }
