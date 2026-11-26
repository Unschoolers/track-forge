import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import type { AppCommand, AppSnapshot } from '@/application/appState'
import type { CupStore } from '@/application/ports/storage'
import type { RaceSessionPort } from '@/application/race/raceSession'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import type { Track } from '@/domain/model'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { validateTrack } from '@/domain/track/trackValidation'
import { DEFAULT_CUP_TRACK_IDS, cupTrackIds, cupRoundCount, validCupLineup, cupStandings, createCup, advanceCup, cupGridPositions, moveCupTrack, removeCupTrack, type CircuitCup, type CupProgress } from '@/application/race/circuitCup'

type CupCommand = Extract<AppCommand, { type: 'open-cup' | 'cup-add-track' | 'cup-remove-track' | 'cup-move-track' | 'start-cup' | 'host-nearby-cup' | 'resume-cup' | 'next-cup-race' }>

interface CupFlowDependencies {
  readonly snapshot: () => AppSnapshot
  readonly update: (state: AppSnapshot) => void
  readonly tracks: () => readonly Track[]
  readonly librarySnapshot: () => Pick<AppSnapshot, 'tracks' | 'scoresByTrack'>
  readonly goHome: () => void
  readonly cupStore: CupStore | undefined
  readonly nearby: NearbyRace | undefined
  readonly raceSession: Pick<RaceSessionPort, 'start'>
  readonly geometry: TrackGeometryService
}

/** Owns Cup commands, lineup validation, round launch and persistence.
 * AppController remains the sole publisher of the application snapshot.
 */
export class CupFlow {
  private preCupTrack: Track | null = null

  constructor(private readonly dependencies: CupFlowDependencies) {}

  get previousTrack(): Track | null { return this.preCupTrack }

  private get state(): AppSnapshot { return this.dependencies.snapshot() }

  private update(state: AppSnapshot): void { this.dependencies.update(state) }

  dispatch(command: CupCommand): void {
    switch (command.type) {
      case 'open-cup':
        if (this.state.mode === 'home' &&
            (this.state.overlay.type === 'none' ||
              (this.state.overlay.type === 'nearby' && this.dependencies.nearby?.snapshot().phase === 'idle'))) {
          this.update({ ...this.state, overlay: { type: 'cup',
            ...(this.state.overlay.type === 'nearby' ? { returnTo: 'nearby' as const } : {}) }, notice: null })
        }
        break
      case 'cup-add-track':
        if (this.state.overlay.type === 'cup' &&
            (this.state.cupProgress?.lineup?.length ?? DEFAULT_CUP_TRACK_IDS.length) < 12) {
          this.update({ ...this.state, overlay: { type: 'track-library', purpose: 'cup',
            ...(this.state.overlay.returnTo ? { cupReturnTo: this.state.overlay.returnTo } : {}) }, ...this.dependencies.librarySnapshot(), notice: null })
        }
        break
      case 'cup-remove-track': {
        if (this.state.overlay.type !== 'cup') break
        const lineup = removeCupTrack(this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS, command.index)
        if (lineup) this.setCupLineup(lineup)
        break
      }
      case 'cup-move-track': {
        if (this.state.overlay.type !== 'cup') break
        const lineup = moveCupTrack(this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS, command.index, command.direction)
        if (lineup) this.setCupLineup(lineup)
        break
      }
      case 'start-cup': {
        if (this.state.overlay.type !== 'cup') break
        const ids = this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS
        if (!this.validateCupTracks(ids)) break
        this.preCupTrack = this.state.currentTrack
        this.launchCupRace(createCup(this.state.preferences.car, this.state.preferences.difficulty, ids))
        break
      }
      case 'host-nearby-cup': {
        const nearby = this.dependencies.nearby
        if (this.state.overlay.type !== 'cup' || !nearby || nearby.snapshot().phase !== 'idle') break
        const ids = this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS
        if (!this.validateCupTracks(ids)) break
        const tracks = ids.map(id => this.cupTrack(id)).filter((track): track is Track => !!track)
        nearby.hostCup(tracks, this.state.preferences.car, this.state.preferences.raceLaps ?? 2)
        this.update({ ...this.state, overlay: { type: 'nearby' }, notice: null })
        break
      }
      case 'resume-cup': {
        const cup = this.state.cupProgress?.checkpoint
        if (!cup) break
        this.preCupTrack = this.state.currentTrack
        if (!this.validateCupTracks(cupTrackIds(cup))) break
        if (cup.rounds.length > cup.index && cup.index === cupRoundCount(cup) - 1) {
          this.update({ ...this.state, cup, overlay: { type: 'cup-final' } })
        } else {
          this.launchCupRace(cup.rounds.length > cup.index ? advanceCup(cup) : cup)
        }
        break
      }
      case 'next-cup-race':
        if (this.state.cup && (this.state.overlay.type === 'results' || this.state.overlay.type === 'cup-final')) {
          if (this.state.cup.index === cupRoundCount(this.state.cup) - 1) {
            const placement = cupStandings(this.state.cup).findIndex((driver) => driver.id === 'player') + 1
            const previous = this.state.cupProgress?.bestPlacement ?? null
            const progress = { checkpoint: null, bestPlacement: placement > 0 ? Math.min(previous ?? placement, placement) : previous, lineup: this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS }
            const notice = this.saveCupProgress(progress)
            this.dependencies.goHome()
            this.update({ ...this.state, cupProgress: progress, notice })
          } else {
            this.launchCupRace(advanceCup(this.state.cup))
          }
        }
        break
    }
  }

  private saveCupProgress(progress: CupProgress): string | null {
    return this.dependencies.cupStore?.save(progress) === false
      ? 'Cup progress could not be saved on this device.'
      : null
  }

  persistCup(checkpoint: CircuitCup): { progress: CupProgress; notice: string | null } {
    const progress = { checkpoint, bestPlacement: this.state.cupProgress?.bestPlacement ?? null,
      lineup: this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS }
    return { progress, notice: this.saveCupProgress(progress) }
  }

  setCupLineup(lineup: readonly string[]): void {
    const progress: CupProgress = { ...this.state.cupProgress, checkpoint: this.state.cupProgress?.checkpoint ?? null,
      bestPlacement: this.state.cupProgress?.bestPlacement ?? null, lineup }
    const notice = this.saveCupProgress(progress)
    this.update({ ...this.state, cupProgress: progress, notice })
  }

  private cupTrack(id: string): Track | undefined {
    return OFFICIAL_CIRCUITS.find(({ track }) => track.id === id)?.track ??
      this.dependencies.tracks().find(track => track.id === id)
  }

  private validateCupTracks(ids: readonly string[]): boolean {
    if (!validCupLineup(ids) || !ids.length || !ids.every(id => {
      const track = this.cupTrack(id)
      return track && validateTrack(track, this.dependencies.geometry.get(track).path.totalLength).ready
    })) {
      this.update({ ...this.state, notice: 'A Cup track is missing or not race-ready. Edit your lineup.' })
      return false
    }
    return true
  }

  private launchCupRace(cup: CircuitCup): void {
    const id = cupTrackIds(cup)[cup.index]
    const track = id && this.cupTrack(id)
    if (!track) {
      this.update({ ...this.state, notice: 'The next Cup track is unavailable.' })
      return
    }
    this.dependencies.raceSession.start(track, {
      car: cup.car,
      difficulty: cup.difficulty,
      laps: 1,

      mode: 'normal',
      gridPositions: cupGridPositions(cup),
    })
    const { progress, notice } = this.persistCup(cup)
    this.update({ ...this.state, cup, cupProgress: progress, currentTrack: track, mode: 'race', paused: false, overlay: { type: 'none' }, notice })
  }
}
