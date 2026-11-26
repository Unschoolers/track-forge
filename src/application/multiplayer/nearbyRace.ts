import { EventBus } from '@/application/eventBus'
import { NearbyOperationQueue } from './nearbyOperationQueue'
import { NearbyTrackShare } from './nearbyTrackShare'
import { NearbyLobby } from './nearbyLobby'
import { NearbyRosterDelivery } from './nearbyRosterDelivery'
import type { GhostPose } from '@/application/race/ghostReplay'
import { CAR_IDS, normalizeRouteKind, type CarId, type LightingMode, type Track } from '@/domain/model'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { raceProgress } from '@/domain/race/ranking'
import { decodeProgress, Packet, RemoteGhost } from './raceWire'
import { NearbyClock } from './nearbyClock'
import { NearbyRanking, rankNearby } from './nearbyRanking'
import { NearbyProgressSync } from './nearbyProgressSync'
import { awardNearbyCupRound, nearbyCupStandings } from './nearbyCupScoring'
import { NearbyPoseSync, type PoseRacer } from './nearbyPoseSync'
import { NearbyRaceDiagnostics } from './nearbyRaceDiagnostics'
import { packTrack, TrackReceiver } from './trackTransfer'
import { DEFAULT_PLAYER_IDENTITY, normalizePlayerIdentity, type PlayerIdentity } from './playerIdentity'
import { randomGridPositions } from '@/domain/race/startGrid'
import { normalizeDisplayName } from '@/domain/track/trackCreator'
import { decodeControl, encodeControl, validLineupPositions, MAX_PLAYERS, NEARBY_WIRE_PROTOCOL_VERSION, type Control, type LobbyPlayer } from './controlProtocol'

export type NearbyEvent =
  | { type: 'found'; id: string; name: string }
  | { type: 'lost' | 'connected'; id: string }
  | { type: 'disconnected'; id: string; reason?: string }
  | { type: 'pairing'; id: string }
  | { type: 'packet'; id: string; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'error'; message: string; id?: string }

export interface NearbyTransport {
  subscribe(listener: (event: NearbyEvent) => void): () => void
  host(name: string): Promise<void>
  scan(): Promise<void>
  connect(id: string): Promise<void>
  /** LAN-only: connect directly to an RFC1918 host even when UDP discovery is blocked. */
  connectDirect?(ip: string): Promise<void>
  hostAddress?(): string | null
  respond(id: string, accepted: boolean): Promise<void>
  lock(): Promise<void>
  send(ids: string[], bytes: Uint8Array): Promise<void>
  stop(): Promise<void>
  diagnostics?(): Promise<Record<string, unknown>>
  deliveryQuality?(): Promise<Record<string, unknown>>
}

interface Course {
  readonly track: Track
  readonly laps: number
  readonly lighting: LightingMode
  readonly car: CarId
}

export interface NearbyStart extends Course {
  /** Unique physical start pad assigned by the host. */
  readonly gridSlot: number
  /** The race scene is staged first; GO is scheduled after every scene is ready. */
  readonly startsAt?: number
}

type Phase = 'idle' | 'opening' | 'hosting' | 'scanning' | 'connecting' | 'waiting' | 'preparing' | 'lobby' | 'share-review' | 'staging' | 'racing'
type Purpose = 'race' | 'share'
// Network operations have a finite deadline; human car selection does not.
export const LOBBY_DELIVERY_TIMEOUT_MS = 10_000
const LOBBY_ACK_TIMEOUT_MS = 30_000

class LobbyDeliveryTimeoutError extends Error {
  constructor() { super('Lobby delivery timed out.') }
}

async function withLobbyDeliveryDeadline(operation: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new LobbyDeliveryTimeoutError()), LOBBY_DELIVERY_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const INCOMPATIBLE_RACE_VERSION = 'Multiplayer version mismatch. Update Track Forge on every device.'
/** No DNS, public addresses, loopback, multicast or metacharacters from untrusted input. */
export function validLanIp(ip: string): boolean {
  const fields = ip.split('.')
  if (fields.length !== 4 || fields.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return false
  const [first, second] = fields.map(Number)
  return first === 10 || (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168) || (first === 169 && second === 254)
}

export class NearbyRace {
  private readonly changes = new EventBus<void>()
  private readonly starts = new EventBus<NearbyStart>()
  private readonly countdownStarts = new EventBus<number>()
  private readonly unsubscribe: () => void
  private phase: Phase = 'idle'
  private role: 'host' | 'guest' | null = null
  private purpose: Purpose = 'race'
  private round = 0
  private cupTracks: readonly Track[] = []
  private cupIndex = 0
  private cupTotal = 0
  private cupLaps = 2
  private lightingOverride: LightingMode | null = null
  private scoredCupIndex = -1
  private readonly cupPoints = new Map<number, number>()
  private readonly share = new NearbyTrackShare()
  private readonly diagnostic: NearbyRaceDiagnostics
  private readonly operations = new NearbyOperationQueue()
  private get generation(): number { return this.operations.generation }
  private error: string | null = null
  private room: string | null = null
  private hostId: string | null = null
  private course: Course | null = null
  private localCar: CarId = CAR_IDS[0]
  private localIdentity: PlayerIdentity = DEFAULT_PLAYER_IDENTITY
  private localDisplayName: string | undefined
  private readonly rooms = new Map<string, string>()
  private readonly pendingPairs = new Set<string>()
  private readonly guests = new Map<string, number>()
  private readonly lobby = new NearbyLobby()
  private readonly rosterDelivery = new NearbyRosterDelivery()
  private readonly armed = new Map<string, number>()
  private localSceneReady = false
  private lineup: (CarId | null)[] | null = null
  private readonly racers = new Map<number, PoseRacer>()
  private receiver: TrackReceiver | null = null
  private prepared: Pick<Course, 'laps' | 'lighting'> | null = null
  private readonly clock = new NearbyClock()
  private readonly ranking = new NearbyRanking()
  private localProgress: number | null = null
  private sharedStartAt: number | null = null
  private lastSimulationElapsed: number | null = null
  private finalClockElapsed: number | null = null
  private slot = 0
  private readonly poseSync: NearbyPoseSync
  private readonly progressSync: NearbyProgressSync
  private timeout: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly transport: NearbyTransport,
    private readonly validateTrack: (track: Track) => boolean,
    private readonly now = () => performance.now(),
  ) {
    this.diagnostic = new NearbyRaceDiagnostics(this.now, () => ({
      phase: this.phase, purpose: this.purpose, role: this.role, round: this.round,
      cupTotal: this.cupTotal, cupIndex: this.cupIndex, slot: this.slot, hostId: this.hostId,
      course: this.course, localCar: this.localCar, localIdentity: this.localIdentity,
      localDisplayName: this.localDisplayName, rooms: this.rooms.size, pendingPairs: this.pendingPairs.size,
      guests: this.guests, racers: this.racers, lobby: this.lobby, progressSync: this.progressSync,
    }))
    this.poseSync = new NearbyPoseSync((ids, bytes) => transport.send(ids, bytes), this.now,
      (slot, sequence, accepted, at) => this.diagnostic.recordPose(slot, sequence, accepted, at))
    this.progressSync = new NearbyProgressSync((ids, bytes) => transport.send(ids, bytes), this.now)
    this.unsubscribe = transport.subscribe((event) => this.onEvent(event))
  }

  snapshot() {
    return {
      phase: this.phase, purpose: this.purpose, role: this.role,
      error: this.error, room: this.room, track: this.course?.track.name,
      lighting: this.course?.lighting ?? null,
      lobbyTrack: this.phase === 'lobby' ? this.course?.track : undefined,
      incomingTrack: this.share.incoming?.name ?? null, sharedCount: this.share.sharedCount,
      shareStatus: this.share.status,
      rooms: [...this.rooms], players: this.phase === 'lobby' && this.role === 'guest' ? this.lobbyPlayers().length : 1 + this.guests.size,
      localCar: this.localCar, localReady: this.lobby.localAccepted, unlockPending: this.lobby.unlockPending,
      readyPending: this.phase === 'lobby' && this.role === 'guest' && this.lobby.readyPending(this.slot),
      lobbyPlayers: this.phase === 'lobby' ? this.lobbyPlayers() : [],
      laps: this.course?.laps ?? null,
      canStart: this.purpose === 'race' && this.phase === 'hosting' &&
        this.guests.size > 0 && this.pendingPairs.size === 0,
      canRematch: this.canRematch(),
      cup: this.cupTotal > 0 ? {
        index: this.cupIndex, total: this.cupTotal, finished: this.scoredCupIndex === this.cupIndex,
        standings: this.cupStandings(),
        nextTrack: this.cupTracks[this.cupIndex + 1]?.name ?? null,
      } : null,
    }
  }

  async diagnostics(): Promise<Record<string, unknown>> {
    const report = this.diagnostic.report({
      poseCounts: this.poseSync.counts,
      progressSendFailures: this.progressSync.failedSends,
      targetPoseHz: this.poseSync.targetPoseHz,
    })
    const clockElapsed = this.synchronizedElapsed()
    Object.assign(report, { synchronization: { clock: this.clock.estimate, sharedStartAtMs: this.sharedStartAt,
      ranking: this.ranking.diagnostics(), simulationElapsedSeconds: this.lastSimulationElapsed,
      clockElapsedSeconds: clockElapsed,
      simulationDriftMs: this.lastSimulationElapsed === null || clockElapsed === null ? null :
        (clockElapsed - this.lastSimulationElapsed) * 1000 } })
    if (!this.transport.diagnostics) return { ...report, native: { status: 'unavailable' } }
    try {
      return { ...report, native: { status: 'available', report: await this.transport.diagnostics() } }
    } catch (error) {
      return { ...report, native: { status: 'failed', error: this.errorKind(error) } }
    }
  }

  subscribe(listener: () => void) { return this.changes.subscribe(listener) }
  onStart(listener: (start: NearbyStart) => void) { return this.starts.subscribe(listener) }
  onCountdown(listener: (startsAt: number) => void) { return this.countdownStarts.subscribe(listener) }
  localSlot(): number { return this.slot }

  /** Updated from the saved preference; sent only with reliable lobby setup. */
  setIdentity(identity: unknown): void {
    this.localIdentity = normalizePlayerIdentity(identity)
  }

  setDisplayName(name: unknown): void {
    this.localDisplayName = normalizeDisplayName(name)
  }

  host(course: Course): void {
    this.cupTracks = []
    this.cupTotal = 0
    this.cupIndex = 0
    this.cupPoints.clear()
    this.scoredCupIndex = -1
    this.openHost(course, 'race')
  }

  /** All selected tracks run in order in the same room; no saved multiplayer presets. */
  hostCup(tracks: readonly Track[], car: CarId, laps: number): void {
    if (this.phase !== 'idle' || tracks.length < 1 || tracks.length > 12 ||
        !tracks.every(track => this.validateTrack(track))) return
    this.cupTracks = [...tracks]
    this.cupTotal = tracks.length
    this.cupLaps = laps
    this.cupIndex = 0
    this.scoredCupIndex = -1
    this.cupPoints.clear()
    const first = tracks[0]!
    this.openHost({ track: first, car, lighting: first.lighting,
      laps: first.routeKind === 'point-to-point' ? 1 : laps }, 'race')
  }

  /** Host-only session lighting; never modifies saved track data. */
  setLighting(lighting: LightingMode): boolean {
    if (this.role !== 'host' || this.purpose !== 'race' || !this.course ||
        (this.phase !== 'hosting' && !this.canRematch()) ||
        (lighting !== 'day' && lighting !== 'night')) return false
    this.lightingOverride = lighting
    this.course = { ...this.course, lighting }
    this.changed()
    return true
  }

  hostShare(track: Track): void {
    this.openHost({ track, laps: 1, lighting: track.lighting, car: this.localCar }, 'share')
  }

  private openHost(course: Course, purpose: Purpose): void {
    if (this.phase !== 'idle') return
    this.purpose = purpose
    this.lightingOverride = null
    this.role = 'host'
    this.course = course
    this.localCar = course.car
    const random = crypto.getRandomValues(new Uint16Array(1))[0] ?? 0
    const room = `${purpose === 'share' ? 'Track' : 'Room'} ${1000 + random % 9000}`
    this.room = room
    const active = this.begin('opening')
    this.perform('host', () => this.transport.host(room), active, () => this.setPhase('hosting'))
  }

  scan(car: CarId, purpose: Purpose = 'race'): void {
    if (this.phase !== 'idle') return
    this.purpose = purpose
    this.role = 'guest'
    this.cupTracks = []
    this.cupTotal = 0
    this.cupIndex = 0
    this.scoredCupIndex = -1
    this.cupPoints.clear()
    this.localCar = car
    const active = this.begin('scanning')
    this.perform('scan', () => this.transport.scan(), active)
  }

  connect(id: string): void {
    const room = this.rooms.get(id)
    if (this.phase !== 'scanning' || !room) return
    this.hostId = id
    this.room = room
    this.setPhase('connecting')
    this.armTimeout('Could not connect to the nearby room.')
    this.perform('connect', () => this.transport.connect(id), this.generation)
  }

  /** Direct local IPv4 fallback: UDP discovery can be filtered on phones and routers. */
  connectByIp(rawIp: string): void {
    if (this.phase !== 'scanning' || !this.transport.connectDirect) return
    const ip = rawIp.trim()
    if (!validLanIp(ip)) {
      this.error = 'Enter a private LAN IPv4 address, e.g. 192.168.1.20.'
      this.changed()
      return
    }
    this.hostId = ip
    this.room = `LAN ${ip}`
    this.error = null
    this.setPhase('connecting')
    this.armTimeout('Could not connect to this LAN address. Check the host IP and firewall.')
    this.perform('connect-direct', () => this.transport.connectDirect!(ip), this.generation)
  }

  /** The host can select the next circuit without releasing any peer connection. */
  selectNextTrack(track: Track): boolean {
    if (!this.canRematch() || this.cupTotal > 0 || !this.course || !this.validateTrack(track)) return false
    this.course = {
      ...this.course, track, lighting: this.lightingOverride ?? track.lighting,
      laps: track.routeKind === 'point-to-point' ? 1 : this.course.laps,
    }
    this.changed()
    return true
  }

  private canRematch(): boolean {
    return this.role === 'host' && this.purpose === 'race' && this.phase === 'racing' &&
      this.guests.size > 0 && this.pendingPairs.size === 0 && this.racers.size > 0 &&
      [...this.racers.values()].every(racer => racer.time !== undefined || racer.left) &&
      (this.cupTotal === 0 || this.cupIndex < this.cupTotal - 1)
  }

  /** All cars are done; keep the room open and stage another round. */
  start(): void {
    const first = this.snapshot().canStart
    const rematch = this.canRematch()
    if ((!first && !rematch) || !this.course) return
    // Save the previous circuit before switching to the next cup track.
    if (rematch) {
      this.clearRound()
      this.round = (this.round + 1) & 0xffff
      this.poseSync.setRound(this.round)
      this.progressSync.setRound(this.round)
    }
    if (rematch && this.cupTotal > 0) {
      const next = this.cupTracks[this.cupIndex + 1]
      if (!next) return
      this.cupIndex++
      this.course = { ...this.course, track: next, lighting: this.lightingOverride ?? next.lighting,
        laps: next.routeKind === 'point-to-point' ? 1 : this.cupLaps }
    }
    const course = this.course
    const active = this.generation
    this.lobby.reset()
    this.rosterDelivery.reset()
    this.setPhase('lobby')
    this.armTimeout('A player did not load the track in time.')
    void this.prepareGuests(course, active, first).catch((error: unknown) => {
      if (active === this.generation) this.fail(error instanceof Error ? error.message : 'Could not share the track.', 'prepare', error)
    })
  }

  /** Once a round is proposed, the host owns the track and players own their consent. */
  selectLobbyCar(car: CarId): void {
    if (this.phase !== 'lobby' || this.lobby.unlockPending || !CAR_IDS.includes(car) || car === this.localCar) return
    if (this.lobby.localAccepted) return
    this.localCar = car
    if (this.course) this.course = { ...this.course, car }
    this.setLobbyReady(false)
  }

  setLobbyReady(accepted: boolean): void {
    if (this.phase !== 'lobby' || this.lobby.unlockPending || !this.course) return
    this.lobby.setLocalReady(accepted, this.role === 'guest')
    if (this.role === 'host') {
      this.publishLobby()
      this.startHost()
    } else {
      if (this.lobby.readyPending(this.slot) || this.lobby.unlockPending) {
        this.armTimeout('The host did not confirm your lobby readiness.', LOBBY_ACK_TIMEOUT_MS)
      }
      this.sendLobbyChoice()
      this.changed()
    }
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.lobby.players(this.role === 'guest', this.slot, this.localCar, this.localDisplayName, this.guests)
  }

  private publishLobby(): void {
    const active = this.generation
    const round = this.round
    const revision = this.lobby.nextRevision()
    const bytes = encodeControl({ type: 'lobby', round, revision, players: this.lobbyPlayers() })
    const ids = this.lobby.peerIds().filter(id => this.guests.has(id))
    this.rosterDelivery.publish(ids, {
      revision,
      send: id => this.deliverLobbyPeer(id, bytes, active, round, 'roster'),
      settled: () => { if (this.currentLobby(active, round)) this.startHost() },
      failed: error => {
        if (this.currentLobby(active, round)) this.fail(error instanceof LobbyDeliveryTimeoutError
        ? 'Lobby synchronization timed out. Rejoin the room.'
        : 'Could not update a connected player’s lobby.', 'lobby_roster', error)
      },
      superseded: () => {
        if (this.currentLobby(active, round)) this.record('lobby_roster_delivery_superseded', { revision })
      },
    })
    this.changed()
  }

  private sendLobbyChoice(): void {
    if (!this.hostId) return
    this.sendControl([this.hostId], {
      type: 'ready', car: this.localCar, identity: this.localIdentity, round: this.round,
      protocolVersion: NEARBY_WIRE_PROTOCOL_VERSION, accepted: this.lobby.localAccepted, choice: this.lobby.localChoice,
      ...(this.localDisplayName ? { name: this.localDisplayName } : {}),
    })
  }

  private clearRound(): void {
    this.diagnostic.finishRound()
    this.lobby.reset()
    this.rosterDelivery.reset()
    this.armed.clear()
    this.racers.clear()
    this.lineup = null
    this.localSceneReady = false
    this.clock.reset()
    this.ranking.reset()
    this.localProgress = null
    this.sharedStartAt = null
    this.lastSimulationElapsed = null
    this.finalClockElapsed = null
    this.receiver = null
    this.prepared = null
    this.poseSync.reset()
    this.progressSync.reset()
  }

  private currentLobby(active: number, round: number): boolean {
    return active === this.generation && round === this.round && this.phase === 'lobby'
  }

  /** Native send rejection can precede its disconnect callback. Allow that
   * callback to settle before classifying a failed delivery as a live-peer error.
   * Never drop a still-connected peer's control or track packet silently.
   */
  private async deliverLobbyPeer(
    id: string, bytes: Uint8Array, active: number, round: number, kind: 'roster' | 'prepare' | 'track',
  ): Promise<void> {
    if (!this.currentLobby(active, round) || !this.guests.has(id)) return
    try {
      await withLobbyDeliveryDeadline(this.transport.send([id], bytes))
    } catch (error: unknown) {
      this.record('lobby_delivery_failed', { kind, error: this.errorKind(error) })
      if (!this.currentLobby(active, round) || !this.guests.has(id)) return
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); unsubscribe(); resolve() }
        const unsubscribe = this.subscribe(() => {
          if (!this.currentLobby(active, round) || !this.guests.has(id)) finish()
        })
        const timer = setTimeout(finish, 500)
      })
      if (!this.currentLobby(active, round) || !this.guests.has(id)) {
        this.record('lobby_delivery_obsolete', { kind })
        return
      }
      throw error
    }
  }

  private async prepareGuests(course: Course, active: number, lock: boolean): Promise<void> {
    const round = this.round
    if (lock) {
      this.record('transfer', { stage: 'lock' })
      await withLobbyDeliveryDeadline(this.transport.lock())
    }
    if (!this.currentLobby(active, round)) return
    const chunks = await packTrack(course.track)
    if (!this.currentLobby(active, round)) return
    this.record('transfer', { stage: 'packed', chunks: chunks.length, bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0), recipients: this.guests.size })
    await Promise.all([...this.guests].map(([id, slot]) =>
      this.deliverLobbyPeer(id, encodeControl({ type: 'prepare', slot, laps: course.laps, lighting: course.lighting, round,
        protocolVersion: NEARBY_WIRE_PROTOCOL_VERSION,
        ...(this.cupTotal ? { cupIndex: this.cupIndex, cupTotal: this.cupTotal } : {}) }), active, round, 'prepare')))
    for (const chunk of chunks) {
      if (!this.currentLobby(active, round)) return
      // Membership is live; each peer's reliable delivery has its own outcome.
      await Promise.all([...this.guests.keys()].map(id => this.deliverLobbyPeer(id, chunk, active, round, 'track')))
    }
    if (!this.currentLobby(active, round)) return
    this.record('transfer', { stage: 'sent', chunks: chunks.length, recipients: this.guests.size })
    this.lobby.completeTransfer()
    this.startHost()
  }

  update(vehicle: RaceVehicle, state?: RaceState): void {
    if (this.phase !== 'racing') return
    if (state) this.diagnostic.captureTraceFrame(vehicle, state)
    const recipients = this.endpoints()
    this.poseSync.update(vehicle, this.slot, this.hostId, recipients, this.racers)
    if (state) {
      this.lastSimulationElapsed = state.elapsed
      this.localProgress = raceProgress(vehicle, state.path.points.length, state.startPathIndex,
        state.reversed, normalizeRouteKind(state.routeKind))
      this.progressSync.update(this.slot, this.localProgress, recipients)
      if (this.role === 'host') this.publishRanking()
    }
  }

  /** The finishing sample remains available after the room stops sending poses. */
  captureFinalFrame(vehicle: RaceVehicle, state: RaceState): void {
    if (this.phase === 'racing') {
      this.lastSimulationElapsed = state.elapsed
      this.finalClockElapsed = this.synchronizedElapsed()
      this.diagnostic.captureTraceFrame(vehicle, state, true)
    }
  }

  /** Unknown peers keep the HUD on LIVE instead of showing a fabricated rank. */
  livePosition(_vehicle: RaceVehicle, _state: RaceState): { position: number; vehicleCount: number } | null {
    if (this.phase !== 'racing' || !this.racers.has(this.slot)) return null
    if (this.role === 'guest' && !this.hostId) return null
    return this.ranking.position(this.slot, this.now())
  }

  private publishRanking(): void {
    if (this.role !== 'host' || this.phase !== 'racing') return
    const order = rankNearby([...this.racers].map(([slot, racer]) => ({
      slot, progress: slot === this.slot ? this.localProgress : this.progressSync.latest(slot),
      finish: racer.time, left: !!racer.left,
    })))
    const round = this.round
    this.ranking.publish(order, this.now(), (sequence, order) =>
      this.transport.send(this.endpoints(), encodeControl({ type: 'ranking', round, sequence, order })),
    () => this.record('ranking_delivery_failed'))
  }

  private probeClock(): void {
    if (!this.hostId || this.phase !== 'staging') return
    const estimate = this.clock.estimate
    if (estimate) {
      this.record('clock_synchronized', estimate)
      this.sendControl([this.hostId], { type: 'armed', round: this.round })
      return
    }
    const request = this.clock.request(this.now())
    if (request) this.sendControl([this.hostId], { type: 'clock-probe', round: this.round, probe: request.probe })
  }

  /** Real elapsed race time; independent of capped physics catch-up. */
  synchronizedElapsed(): number | null {
    if (this.finalClockElapsed !== null) return this.finalClockElapsed
    return this.sharedStartAt === null ? null : Math.max(0, (this.now() - this.sharedStartAt) / 1000)
  }

  recovered(): void { this.poseSync.recovered() }

  pendingSharedTrack(): Track | null { return this.share.incoming }

  /** A local storage rejection is retryable and must not tear down the room. */
  recordShareSaveFailure(reason: string): void {
    if (this.phase === 'share-review') this.diagnostic.failure('save_shared_track', reason)
  }

  respondToShare(saved: boolean): void {
    if (this.purpose !== 'share' || this.phase !== 'share-review' ||
        !this.share.incoming || !this.hostId) return
    const status = this.share.respond(saved)
    this.sendControl([this.hostId], { type: 'share-result', status })
    this.setPhase('waiting')
  }

  private sendShareToReadyPeer(id: string): void {
    if (!this.guests.has(id) || !this.share.isReady(id)) return
    const active = this.generation
    void this.share.send(id, this.course?.track,
      () => active === this.generation && this.guests.has(id),
      (ids, bytes) => this.transport.send(ids, bytes),
      chunks => this.record('track_shared', { chunks }),
    ).catch((error: unknown) => {
      if (active === this.generation) this.fail(
        error instanceof Error ? error.message : 'Could not send the nearby track.', 'send_track', error)
    })
  }

  /** Called only when Phaser has created the race scene and bound its controls. */
  sceneReady(): void {
    if (this.phase !== 'staging' || this.localSceneReady) return
    this.localSceneReady = true
    this.record('scene_ready')
    if (this.role === 'guest' && this.hostId) {
      this.probeClock()
    } else if (this.role === 'host') {
      this.scheduleHostCountdown()
    }
  }

  remotePoses(): GhostPose[] {
    return this.poseSync.remotePoses(this.racers, this.slot)
  }

  finish(time: number | null): void {
    if (this.phase !== 'racing') return
    this.recordFinish(this.slot, time)
    this.sendControl(this.endpoints(), { type: 'finish', slot: this.slot, time, round: this.round })
  }

  cupStandings(): { slot: number; points: number }[] {
    return nearbyCupStandings(this.racers.keys(), this.cupPoints)
  }

  private scoreCupRound(): void {
    if (!this.cupTotal || this.scoredCupIndex === this.cupIndex) return
    const awarded = awardNearbyCupRound(this.standings(), this.cupPoints)
    if (!awarded) return
    this.cupPoints.clear()
    for (const [slot, points] of awarded) this.cupPoints.set(slot, points)
    this.scoredCupIndex = this.cupIndex
  }

  standings() {
    return [...this.racers].map(([slot, racer]) => ({
      slot, car: racer.ghost.car, identity: racer.identity, name: racer.name, local: slot === this.slot,
      time: racer.time, left: racer.left ?? false,
    })).sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a.slot - b.slot)
  }

  close(): void {
    if (this.phase === 'idle' && this.error === null) return
    const wasActive = this.phase !== 'idle'
    this.reset(null)
    if (wasActive) this.queueStop()
  }

  destroy(): void {
    this.close()
    this.unsubscribe()
    this.changes.clear()
    this.starts.clear()
    this.countdownStarts.clear()
  }

  private onEvent(event: NearbyEvent): void {
    if (this.phase === 'idle') return
    if (event.type !== 'packet') this.record('event', { event: event.type })
    switch (event.type) {
      case 'found':
        if (this.phase === 'scanning' &&
            new RegExp(`^${this.purpose === 'share' ? 'Track' : 'Room'} \\d{4}$`).test(event.name) &&
            this.rooms.size < 32) {
          this.rooms.set(event.id, event.name)
          this.changed()
        }
        break
      case 'lost':
        if (this.rooms.delete(event.id)) this.changed()
        break
      case 'pairing': {
        // Race rooms can host seven guests; track sharing retains the
        // original three-recipient limit instead of changing its contract.
        const guestLimit = this.purpose === 'share' ? 3 : MAX_PLAYERS - 1
        const incomingGuest = this.phase === 'hosting' &&
          !this.pendingPairs.has(event.id) && !this.guests.has(event.id) &&
          this.guests.size + this.pendingPairs.size < guestLimit
        const invitedHost = this.phase === 'connecting' && event.id === this.hostId
        if (incomingGuest || invitedHost) {
          this.pendingPairs.add(event.id)
          this.record('pairing_auto_accept')
          this.perform('respond', async () => {
            // On LAN, a guest can disappear between the incoming pairing
            // event and the queued host acceptance command. This is a
            // per-peer failure, not a reason to close the host's entire room.
            if (this.role === 'host' && !this.pendingPairs.has(event.id)) {
              this.record('pairing_peer_left', { stage: 'before_accept' })
              return 'skipped'
            }
            try {
              await this.transport.respond(event.id, true)
            } catch (error: unknown) {
              if (this.role === 'host' && !this.pendingPairs.has(event.id)) {
                this.record('pairing_peer_left', { stage: 'during_accept', error: this.errorKind(error) })
                return 'failed'
              }
              throw error
            }
          }, this.generation)
          this.changed()
        } else {
          void this.transport.respond(event.id, false).catch((error: unknown) => {
            this.record('pairing_reject_failed', { error: this.errorKind(error) })
          })
        }
        break
      }
      case 'connected':
        if (!this.pendingPairs.delete(event.id)) break
        if (event.id === this.hostId) {
          this.clearTimeout()
          this.setPhase('waiting')
          if (this.purpose === 'share') this.sendControl([event.id], { type: 'share-ready' })
        } else if (this.phase === 'hosting') {
          const slot = Array.from({ length: MAX_PLAYERS - 1 }, (_, index) => index + 1)
            .find(candidate => ![...this.guests.values()].includes(candidate))
          if (slot !== undefined) this.guests.set(event.id, slot)
          this.sendShareToReadyPeer(event.id)
          this.changed()
        }
        break
      case 'disconnected':
        if (event.reason) this.record('native_disconnect', { reason: event.reason })
        this.disconnected(event.id)
        break
      case 'packet': this.receive(event.id, event.bytes); break
      case 'error':
        if (event.id && event.id !== this.hostId) {
          this.diagnostic.failure('peer_event', 'flow_error')
          this.pendingPairs.delete(event.id)
          this.error = event.message
          this.changed()
        } else this.fail(event.message)
        break
    }
  }

  private receive(id: string, bytes: Uint8Array<ArrayBuffer>): void {
    const fromHost = this.hostId === id
    const guestSlot = this.guests.get(id)
    if (!fromHost && guestSlot === undefined &&
        !(this.purpose === 'share' && this.role === 'host' && this.pendingPairs.has(id))) return
    if (this.phase === 'racing' && bytes[0] === Packet.Progress) {
      const packet = decodeProgress(bytes)
      const racer = packet && this.racers.get(packet.slot)
      if (packet && racer && packet.slot !== this.slot && !racer.left &&
          racer.time === undefined && (fromHost || guestSlot === packet.slot)) {
        const accepted = this.progressSync.receive(packet)
        this.diagnostic.recordProgress(packet.slot, packet.sequence, accepted, this.now())
        if (accepted && !fromHost) {
          this.progressSync.relay(bytes, this.endpoints(id))
          this.publishRanking()
        }
      }
      return
    }
    if (this.phase === 'racing' &&
        this.poseSync.receive(bytes, fromHost, guestSlot, this.slot, this.racers)) return
    if (bytes[0] === Packet.Track && fromHost && this.phase === 'preparing' && this.receiver) {
      const active = this.generation
      const receiver = this.receiver
      void receiver.receive(bytes).then((track) => {
        if (!track || active !== this.generation || this.receiver !== receiver) return
        this.receiver = null
        if (this.purpose === 'share') {
          this.share.receive(track)
          this.clearTimeout()
          this.setPhase('share-review')
          return
        }
        if (!this.prepared) throw new Error('Nearby race was not prepared.')
        if (!this.validateTrack(track)) throw new Error('The nearby track is not ready to race.')
        this.course = { ...this.prepared, track, car: this.localCar }
        this.clearTimeout()
        this.setPhase('lobby')
        this.sendLobbyChoice()
      }).catch((error: unknown) => {
        if (active === this.generation) this.fail(error instanceof Error ? error.message : 'Could not load the nearby track.', 'receive_track', error)
      })
      return
    }
    if (bytes[0] !== Packet.Control) return
    const message = decodeControl(bytes)
    if (!message) return
    if (this.purpose === 'share') {
      this.receiveShareControl(id, message, fromHost, guestSlot)
    } else {
      this.receiveRaceControl(id, message, fromHost, guestSlot)
    }
  }

  private receiveShareControl(id: string, message: Control, fromHost: boolean, guestSlot: number | undefined): void {
    if (fromHost && this.phase === 'waiting' && message.type === 'share-offer') {
      this.receiver = new TrackReceiver()
      this.setPhase('preparing')
      this.armTimeout('The nearby track was not received in time.')
    } else if (this.role === 'host' && this.phase === 'hosting' && message.type === 'share-ready' &&
        (guestSlot !== undefined || this.pendingPairs.has(id))) {
      this.share.markReady(id)
      this.sendShareToReadyPeer(id)
    } else if (guestSlot !== undefined && this.phase === 'hosting' && message.type === 'share-result') {
      if (message.status === 'saved') this.share.markSaved(id)
      this.changed()
    }
  }

  private receiveRaceControl(id: string, message: Control, fromHost: boolean, guestSlot: number | undefined): void {
    const incomingRound = 'round' in message ? message.round ?? 0 : 0
    if (fromHost && message.type === 'prepare' &&
        (this.phase === 'waiting' && incomingRound === this.round ||
         this.phase === 'racing' && incomingRound === ((this.round + 1) & 0xffff))) {
      if (message.protocolVersion !== NEARBY_WIRE_PROTOCOL_VERSION) {
        this.fail(INCOMPATIBLE_RACE_VERSION, 'protocol')
        return
      }
      if (this.phase === 'racing') {
        this.clearRound()
        this.round = incomingRound
        this.poseSync.setRound(this.round)
        this.progressSync.setRound(this.round)
      }
      this.cupIndex = message.cupIndex ?? 0
      this.cupTotal = message.cupTotal ?? 0
      this.slot = message.slot
      this.prepared = { laps: message.laps, lighting: message.lighting }
      this.receiver = new TrackReceiver()
      this.setPhase('preparing')
      this.armTimeout('The host did not start the race in time.')
    } else if (guestSlot !== undefined && this.phase === 'lobby' &&
        message.type === 'ready' && incomingRound === this.round) {
      if (message.protocolVersion !== NEARBY_WIRE_PROTOCOL_VERSION) {
        this.fail(INCOMPATIBLE_RACE_VERSION, 'protocol')
        return
      }
      if (message.accepted === undefined || message.choice === undefined) {
        this.fail(INCOMPATIBLE_RACE_VERSION, 'protocol')
        return
      }
      if (!this.lobby.receiveChoice(id, { car: message.car, identity: message.identity,
        ...(message.name ? { name: message.name } : {}),
        accepted: message.accepted, choice: message.choice })) return
      if (this.lobby.peerCount === this.guests.size) this.clearTimeout()
      this.publishLobby()
      this.startHost()
    } else if (fromHost && this.phase === 'lobby' && message.type === 'lobby' &&
        incomingRound === this.round) {
      if (this.lobby.receiveRoster(message.revision, message.players, this.slot)) {
        if (!this.lobby.readyPending(this.slot) && !this.lobby.unlockPending) this.clearTimeout()
        this.changed()
      }
    } else if (fromHost && this.phase === 'lobby' && message.type === 'lineup' &&
        incomingRound === this.round && this.course &&
        (this.lobby.localAccepted || this.lobby.unlockPending) && message.cars[0] && message.cars[this.slot] === this.localCar) {
      this.stage(this.course, message.cars, message.identities, message.positions, message.names)
    } else if (guestSlot !== undefined && this.phase === 'staging' &&
        message.type === 'clock-probe' && incomingRound === this.round) {
      const receivedAt = this.now()
      this.sendControl([id], { type: 'clock-reply', round: this.round, probe: message.probe,
        receivedAt, sentAt: this.now() })
    } else if (fromHost && this.phase === 'staging' && message.type === 'clock-reply' &&
        incomingRound === this.round && this.localSceneReady) {
      if (this.clock.receive(message.probe, message.receivedAt, message.sentAt, this.now())) this.probeClock()
    } else if (fromHost && this.phase === 'racing' && message.type === 'ranking' &&
        incomingRound === this.round) {
      if (message.order.length && (message.order.length !== this.racers.size ||
          message.order.some(slot => !this.racers.has(slot)))) return
      this.ranking.receive(message.sequence, message.order, this.now())
    } else if (guestSlot !== undefined && this.phase === 'staging' &&
        message.type === 'armed' && incomingRound === this.round) {
      if (!this.armed.has(id)) this.armed.set(id, this.now())
      this.scheduleHostCountdown()
    } else if (fromHost && this.phase === 'staging' && message.type === 'start' &&
        incomingRound === this.round && this.course &&
        message.cars[0] && message.cars[this.slot] === this.localCar && this.localSceneReady) {
      const estimate = this.clock.estimate
      if (!estimate || message.hostStartsAt === undefined) {
        this.fail('Multiplayer clock synchronization incomplete.', 'clock')
        return
      }
      this.beginCountdown(message.hostStartsAt - estimate.offsetMs)
    } else if (this.phase === 'racing' && incomingRound === this.round && message.type === 'finish' &&
        message.slot !== this.slot && (fromHost || message.slot === guestSlot)) {
      if (this.recordFinish(message.slot, message.time) && !fromHost) this.sendControl(this.endpoints(id), message)
    } else if (this.phase === 'racing' && incomingRound === this.round && fromHost && message.type === 'left' && message.slot !== this.slot) {
      this.markLeft(message.slot)
    }
  }

  private startHost(): void {
    if (!this.course || this.phase !== 'lobby' || this.rosterDelivery.pending || !this.lobby.canStage(this.guests)) return
    const cars: (CarId | null)[] = Array(MAX_PLAYERS).fill(null)
    const identities: (PlayerIdentity | null)[] = Array(MAX_PLAYERS).fill(null)
    const names: (string | null)[] = Array(MAX_PLAYERS).fill(null)
    cars[0] = this.course.car
    identities[0] = this.localIdentity
    names[0] = this.localDisplayName ?? null
    for (const [id, slot] of this.guests) {
      const guest = this.lobby.peer(id)
      if (!guest) return
      cars[slot] = guest.car
      identities[slot] = guest.identity
      names[slot] = guest.name ?? null
    }
    // Assign one unique spawn pad per connected racer, including the host.
    // This order is chosen once and sent unchanged to every Android device.
    const occupied = [0, ...this.guests.values()].sort((a, b) => a - b)
    const shuffled = randomGridPositions(occupied.length, () =>
      (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32)
    const positions: (number | null)[] = Array(MAX_PLAYERS).fill(null)
    occupied.forEach((slot, index) => { positions[slot] = shuffled[index]! })
    this.stage(this.course, cars, identities, positions, names)
    this.sendControl([...this.guests.keys()], { type: 'lineup', cars, identities, positions, round: this.round,
      ...(names.some(name => name !== null) ? { names } : {}) })
  }

  private stage(course: Course, cars: (CarId | null)[], identities: (PlayerIdentity | null)[], positions: (number | null)[], names?: (string | null)[]): void {
    const gridSlot = positions[this.slot]
    if (gridSlot === null || gridSlot === undefined || !validLineupPositions(cars, positions)) {
      this.fail('The multiplayer starting grid is invalid.')
      return
    }
    this.lineup = cars
    cars.forEach((car, slot) => {
      const name = names?.[slot] ?? (slot === this.slot ? this.localDisplayName : undefined)
      if (car) this.racers.set(slot, {
        ghost: new RemoteGhost(car), identity: identities[slot] ?? DEFAULT_PLAYER_IDENTITY,
        ...(name ? { name } : {}),
      })
    })
    this.setPhase('staging')
    this.armTimeout('A player did not finish loading the race scene.')
    this.starts.publish({ ...course, gridSlot })
  }

  private scheduleHostCountdown(): void {
    if (this.role !== 'host' || this.phase !== 'staging' || !this.localSceneReady ||
        this.armed.size !== this.guests.size || !this.lineup) return
    const startsAt = this.now() + 4000
    for (const [id, receivedAt] of this.armed) {
      const now = this.now()
      this.sendControl([id], {
        type: 'start', cars: this.lineup, delay: startsAt - now, readyAge: now - receivedAt, hostStartsAt: startsAt, round: this.round,
      })
    }
    this.beginCountdown(startsAt)
  }

  private beginCountdown(startsAt: number): void {
    if (this.phase !== 'staging') return
    if (startsAt < this.now() + 250) {
      this.fail('Race countdown arrived too late to synchronize.')
      return
    }
    this.clearTimeout()
    this.sharedStartAt = startsAt
    this.poseSync.setStartAt(startsAt)
    this.setPhase('racing')
    this.record('countdown_scheduled', { remainingMs: Math.round(startsAt - this.now()) })
    this.countdownStarts.publish(startsAt)
  }

  private recordFinish(slot: number, time: number | null): boolean {
    const racer = this.racers.get(slot)
    if (!racer || racer.time !== undefined || racer.left) return false
    racer.time = time
    this.publishRanking()
    this.scoreCupRound()
    this.changed()
    return true
  }

  private disconnected(id: string): void {
    this.pendingPairs.delete(id)
    this.share.disconnect(id)
    if (id === this.hostId) {
      if (this.phase !== 'racing') {
        this.fail('The host left the nearby room.')
        return
      }
      this.hostId = null
      for (const [slot, racer] of this.racers) {
        if (slot !== this.slot && racer.time === undefined) racer.left = true
      }
      this.changed()
      return
    }
    const slot = this.guests.get(id)
    this.guests.delete(id)
    if (slot !== undefined) {
      if (this.phase === 'preparing' || this.phase === 'staging') { this.fail('A player left while the race was loading.'); return }
      if (this.phase === 'lobby') {
        this.lobby.removePeer(id)
        this.rosterDelivery.removePeer(id)
        if (!this.guests.size) { this.fail('All other players left the room.'); return }
        if (this.lobby.peerCount === this.guests.size) this.clearTimeout()
        this.publishLobby()
        this.startHost()
        return
      }
      if (this.phase === 'racing') {
        this.markLeft(slot)
        this.sendControl(this.endpoints(), { type: 'left', slot, round: this.round })
        return
      }
    }
    this.changed()
  }

  private markLeft(slot: number): void {
    const racer = this.racers.get(slot)
    if (racer) { racer.left = true; this.publishRanking(); this.scoreCupRound(); this.changed() }
  }

  private endpoints(exclude?: string): string[] {
    return this.hostId ? [this.hostId] : [...this.guests.keys()].filter((id) => id !== exclude)
  }

  private sendControl(ids: string[], message: Control): void {
    if (!ids.length) return
    const active = this.generation
    this.record('control', { kind: message.type, result: 'started', recipients: ids.length })
    const delivery = this.transport.send(ids, encodeControl(message))
    const bounded = message.type === 'ready' ? withLobbyDeliveryDeadline(delivery) : delivery
    void bounded.then(() => {
      if (active === this.generation) this.record('control', { kind: message.type, result: 'succeeded', recipients: ids.length })
    }).catch((error: unknown) => {
      this.record('control', { kind: message.type, result: 'failed', error: this.errorKind(error) })
      if (active !== this.generation) return
      if (message.type === 'ready' && message.choice !== undefined &&
          (message.round !== this.round || this.phase !== 'lobby' ||
           message.choice < this.lobby.localChoice || this.lobby.acknowledgedChoice(this.slot, message.choice))) {
        // A newer choice has its own reliable delivery result; a host acknowledgement
        // or a committed lineup is stronger evidence than a late native send failure.
        this.record('lobby_choice_delivery_obsolete', { round: message.round, choice: message.choice })
        return
      }
      if (message.type === 'finish' || message.type === 'left') {
        this.error = 'A player did not receive the latest race result.'
        this.changed()
      } else if (error instanceof LobbyDeliveryTimeoutError) {
        this.fail('Lobby synchronization timed out. Rejoin the room.', 'lobby_choice', error)
      } else this.fail('A nearby race message could not be sent.')
    })
  }

  private begin(phase: Phase): number {
    this.diagnostic.begin()
    this.poseSync.resetCounts()
    this.error = null
    this.setPhase(phase)
    return this.operations.invalidate()
  }

  private perform(operation: string, action: () => Promise<void | 'skipped' | 'failed'>, active: number, complete?: () => void): void {
    this.operations.perform(active, action, () => {
      this.record('operation', { operation, result: 'started' })
    }, (outcome) => {
      this.record('operation', { operation, result: outcome ?? 'succeeded' })
      if (!outcome) complete?.()
    }, (error) => {
      this.record('operation', { operation, result: 'failed', error: this.errorKind(error) })
      this.fail(error instanceof Error ? error.message : 'Nearby connection failed.', operation, error)
    })
  }

  private queueStop(): void {
    this.operations.stop(async () => {
      this.record('operation', { operation: 'stop', result: 'started' })
      await this.transport.stop()
      this.record('operation', { operation: 'stop', result: 'succeeded' })
    }, (error) => {
      this.record('operation', { operation: 'stop', result: 'failed', error: this.errorKind(error) })
    })
  }

  private fail(message: string, source = 'flow', error?: unknown): void {
    this.diagnostic.failure(source, error === undefined ? 'flow_error' : this.errorKind(error))
    this.reset(message)
    this.queueStop()
  }

  private reset(error: string | null): void {
    this.diagnostic.finishRoom()
    this.operations.invalidate()
    this.clearTimeout()
    this.course = null
    this.share.reset()
    this.round = 0
    this.cupTracks = []
    this.cupTotal = 0
    this.cupIndex = 0
    this.cupPoints.clear()
    this.scoredCupIndex = -1
    this.lightingOverride = null
    this.purpose = 'race'
    this.room = null
    this.hostId = null
    this.rooms.clear()
    this.pendingPairs.clear()
    this.guests.clear()
    this.lobby.reset()
    this.rosterDelivery.reset()
    this.armed.clear()
    this.localSceneReady = false
    this.lineup = null
    this.clock.reset()
    this.ranking.reset()
    this.localProgress = null
    this.sharedStartAt = null
    this.lastSimulationElapsed = null
    this.finalClockElapsed = null
    this.racers.clear()
    this.receiver = null
    this.prepared = null
    this.slot = 0
    this.poseSync.reset()
    this.progressSync.reset()
    this.error = error
    this.setPhase('idle')
  }

  private armTimeout(message: string, duration = 30_000): void {
    this.clearTimeout()
    this.timeout = setTimeout(() => this.fail(message), duration)
  }

  private clearTimeout(): void { clearTimeout(this.timeout) }
  private changed(): void { this.changes.publish() }
  private errorKind(error: unknown): string {
    // Arbitrary exception text can contain endpoint IDs, room names or track data.
    if (error instanceof LobbyDeliveryTimeoutError) return 'lobby_delivery_timeout'
    return error instanceof Error ? 'Error' : 'unknown'
  }

  private record(event: string, details: Record<string, unknown> = {}): void {
    this.diagnostic.record(event, details)
  }

  private setPhase(phase: Phase): void {
    const from = this.phase
    this.phase = phase
    this.record('phase', { from, to: phase, role: this.role })
    this.changed()
  }
}
