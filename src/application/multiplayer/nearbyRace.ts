import { EventBus } from '@/application/eventBus'
import type { GhostPose } from '@/application/race/ghostReplay'
import { CAR_IDS, type CarId, type LightingMode, type Track } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'
import { Packet, RemoteGhost } from './raceWire'
import { NearbyPoseSync, type PoseRacer } from './nearbyPoseSync'
import { packTrack, TrackReceiver } from './trackTransfer'
import { DEFAULT_PLAYER_IDENTITY, normalizePlayerIdentity, type PlayerIdentity } from './playerIdentity'
import { randomGridPositions } from '@/domain/race/startGrid'
import { normalizeDisplayName } from '@/domain/track/trackCreator'
import { decodeControl, encodeControl, validLineupPositions, MAX_PLAYERS, type Control } from './controlProtocol'

export type NearbyEvent =
  | { type: 'found'; id: string; name: string }
  | { type: 'lost' | 'connected' | 'disconnected'; id: string }
  | { type: 'pairing'; id: string }
  | { type: 'packet'; id: string; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'error'; message: string; id?: string }

export interface NearbyTransport {
  subscribe(listener: (event: NearbyEvent) => void): () => void
  host(name: string): Promise<void>
  scan(): Promise<void>
  connect(id: string): Promise<void>
  respond(id: string, accepted: boolean): Promise<void>
  lock(): Promise<void>
  send(ids: string[], bytes: Uint8Array): Promise<void>
  stop(): Promise<void>
  diagnostics?(): Promise<Record<string, unknown>>
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

type Phase = 'idle' | 'opening' | 'hosting' | 'scanning' | 'connecting' | 'waiting' | 'preparing' | 'share-review' | 'staging' | 'racing'
type Purpose = 'race' | 'share'
export class NearbyRace {
  private readonly changes = new EventBus<void>()
  private readonly starts = new EventBus<NearbyStart>()
  private readonly countdownStarts = new EventBus<number>()
  private readonly unsubscribe: () => void
  private phase: Phase = 'idle'
  private role: 'host' | 'guest' | null = null
  private purpose: Purpose = 'race'
  private round = 0
  private incomingShare: Track | null = null
  private readonly sharedPeers = new Set<string>()
  private readonly shareReady = new Set<string>()
  private readonly sentShares = new Set<string>()
  private shareStatus: 'saved' | 'declined' | null = null
  private sharePacked: Promise<Uint8Array[]> | null = null
  private readonly timeline: Record<string, unknown>[] = []
  private diagnosticStart = 0
  private lastFailure: Record<string, unknown> | null = null
  private static readonly TIMELINE_LIMIT = 100
  private generation = 0
  private busy: Promise<void> = Promise.resolve()
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
  private readonly ready = new Map<string, { car: CarId; identity: PlayerIdentity; name?: string; receivedAt: number }>()
  private readonly armed = new Map<string, number>()
  private localSceneReady = false
  private lineup: (CarId | null)[] | null = null
  private readonly racers = new Map<number, PoseRacer>()
  private receiver: TrackReceiver | null = null
  private prepared: Pick<Course, 'laps' | 'lighting'> | null = null
  private readySentAt = 0
  private slot = 0
  private readonly poseSync: NearbyPoseSync
  private timeout: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly transport: NearbyTransport,
    private readonly validateTrack: (track: Track) => boolean,
    private readonly now = () => performance.now(),
  ) {
    this.poseSync = new NearbyPoseSync((ids, bytes) => transport.send(ids, bytes), this.now)
    this.unsubscribe = transport.subscribe((event) => this.onEvent(event))
  }

  snapshot() {
    return {
      phase: this.phase, purpose: this.purpose, role: this.role,
      error: this.error, room: this.room, track: this.course?.track.name,
      incomingTrack: this.incomingShare?.name ?? null, sharedCount: this.sharedPeers.size,
      shareStatus: this.shareStatus,
      rooms: [...this.rooms], players: 1 + this.guests.size,
      canStart: this.purpose === 'race' && this.phase === 'hosting' &&
        this.guests.size > 0 && this.pendingPairs.size === 0,
      canRematch: this.canRematch(),
    }
  }

  async diagnostics(): Promise<Record<string, unknown>> {
    const report: Record<string, unknown> = {
      version: 1,
      role: this.role,
      phase: this.phase,
      counts: this.diagnosticCounts(),
      timeline: this.timeline.map((entry) => ({ ...entry })),
      poseCounts: this.poseSync.counts,
      targetPoseHz: this.poseSync.targetPoseHz,
      lastFailure: this.lastFailure && { ...this.lastFailure },
    }
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

  /** Updated from the saved preference; sent only with reliable lobby setup. */
  setIdentity(identity: unknown): void {
    this.localIdentity = normalizePlayerIdentity(identity)
  }

  setDisplayName(name: unknown): void {
    this.localDisplayName = normalizeDisplayName(name)
  }

  host(course: Course): void {
    this.openHost(course, 'race')
  }

  hostShare(track: Track): void {
    this.openHost({ track, laps: 1, lighting: track.lighting, car: this.localCar }, 'share')
  }

  private openHost(course: Course, purpose: Purpose): void {
    if (this.phase !== 'idle') return
    this.purpose = purpose
    this.role = 'host'
    this.course = course
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

  /** The host can select the next circuit without releasing any peer connection. */
  selectNextTrack(track: Track): boolean {
    if (!this.canRematch() || !this.course || !this.validateTrack(track)) return false
    this.course = {
      ...this.course, track, lighting: track.lighting,
      laps: track.routeKind === 'point-to-point' ? 1 : this.course.laps,
    }
    this.changed()
    return true
  }

  private canRematch(): boolean {
    return this.role === 'host' && this.purpose === 'race' && this.phase === 'racing' &&
      this.guests.size > 0 && this.pendingPairs.size === 0 && this.racers.size > 0 &&
      [...this.racers.values()].every(racer => racer.time !== undefined || racer.left)
  }

  /** All cars are done; keep the room open and stage another round. */
  start(): void {
    const first = this.snapshot().canStart
    const rematch = this.canRematch()
    if ((!first && !rematch) || !this.course) return
    const course = this.course
    const active = this.generation
    if (rematch) {
      this.round = (this.round + 1) & 0xffff
      this.clearRound()
    }
    this.setPhase('preparing')
    this.armTimeout('A player did not load the track in time.')
    void this.prepareGuests(course, active, first).catch((error: unknown) => {
      if (active === this.generation) this.fail(error instanceof Error ? error.message : 'Could not share the track.', 'prepare', error)
    })
  }

  private clearRound(): void {
    this.ready.clear()
    this.armed.clear()
    this.racers.clear()
    this.lineup = null
    this.localSceneReady = false
    this.readySentAt = 0
    this.receiver = null
    this.prepared = null
    this.poseSync.reset()
  }

  private async prepareGuests(course: Course, active: number, lock: boolean): Promise<void> {
    if (lock) {
      this.record('transfer', { stage: 'lock' })
      await this.transport.lock()
    }
    const chunks = await packTrack(course.track)
    this.record('transfer', { stage: 'packed', chunks: chunks.length, bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0), recipients: this.guests.size })
    if (active !== this.generation) return
    const guests = [...this.guests]
    await Promise.all(guests.map(([id, slot]) =>
      this.transport.send([id], encodeControl({ type: 'prepare', slot, laps: course.laps, lighting: course.lighting, round: this.round }))))
    for (const chunk of chunks) {
      if (active !== this.generation) return
      await this.transport.send(guests.map(([id]) => id), chunk)
    }
    this.record('transfer', { stage: 'sent', chunks: chunks.length, recipients: guests.length })
  }

  update(vehicle: RaceVehicle): void {
    if (this.phase !== 'racing') return
    this.poseSync.update(vehicle, this.slot, this.hostId, this.endpoints(), this.racers)
  }

  recovered(): void { this.poseSync.recovered() }

  pendingSharedTrack(): Track | null { return this.incomingShare }

  respondToShare(saved: boolean): void {
    if (this.purpose !== 'share' || this.phase !== 'share-review' ||
        !this.incomingShare || !this.hostId) return
    this.incomingShare = null
    this.shareStatus = saved ? 'saved' : 'declined'
    this.sendControl([this.hostId], { type: 'share-result', status: this.shareStatus })
    this.setPhase('waiting')
  }

  private async sendSharedTrack(id: string, active: number): Promise<void> {
    const track = this.course?.track
    if (!track || this.sentShares.has(id)) return
    this.sentShares.add(id)
    try {
      if (!this.sharePacked) this.sharePacked = packTrack(track)
      const chunks = await this.sharePacked
      if (active !== this.generation || !this.guests.has(id)) return
      await this.transport.send([id], encodeControl({ type: 'share-offer' }))
      for (const chunk of chunks) {
        if (active !== this.generation || !this.guests.has(id)) return
        await this.transport.send([id], chunk)
      }
      this.record('track_shared', { chunks: chunks.length })
    } catch (error) {
      this.sentShares.delete(id)
      throw error
    }
  }

  private sendShareToReadyPeer(id: string): void {
    if (!this.guests.has(id) || !this.shareReady.has(id)) return
    const active = this.generation
    void this.sendSharedTrack(id, active).catch((error: unknown) => {
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
      this.readySentAt = this.now()
      this.sendControl([this.hostId], { type: 'armed', round: this.round })
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
        // Guests explicitly select the room; the host admits up to three peers
        // without an extra per-device match-code prompt.
        const incomingGuest = this.phase === 'hosting' &&
          !this.pendingPairs.has(event.id) && !this.guests.has(event.id) &&
          this.guests.size + this.pendingPairs.size < MAX_PLAYERS - 1
        const invitedHost = this.phase === 'connecting' && event.id === this.hostId
        if (incomingGuest || invitedHost) {
          this.pendingPairs.add(event.id)
          this.record('pairing_auto_accept')
          this.perform('respond', () => this.transport.respond(event.id, true), this.generation)
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
          const slot = [1, 2, 3].find((candidate) => ![...this.guests.values()].includes(candidate))
          if (slot !== undefined) this.guests.set(event.id, slot)
          this.sendShareToReadyPeer(event.id)
          this.changed()
        }
        break
      case 'disconnected': this.disconnected(event.id); break
      case 'packet': this.receive(event.id, event.bytes); break
      case 'error':
        if (event.id && event.id !== this.hostId) {
          this.lastFailure = { source: 'peer_event', error: 'flow_error', phase: this.phase, counts: this.diagnosticCounts() }
          this.record('failure', { source: 'peer_event', error: 'flow_error' })
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
    if (this.phase === 'racing' &&
        this.poseSync.receive(bytes, fromHost, guestSlot, this.slot, this.racers)) return
    if (bytes[0] === Packet.Track && fromHost && this.phase === 'preparing' && this.receiver) {
      const active = this.generation
      const receiver = this.receiver
      void receiver.receive(bytes).then((track) => {
        if (!track || active !== this.generation || this.receiver !== receiver) return
        this.receiver = null
        if (this.purpose === 'share') {
          this.incomingShare = track
          this.shareStatus = null
          this.clearTimeout()
          this.setPhase('share-review')
          return
        }
        if (!this.prepared) throw new Error('Nearby race was not prepared.')
        if (!this.validateTrack(track)) throw new Error('The nearby track is not ready to race.')
        this.course = { ...this.prepared, track, car: this.localCar }
        this.readySentAt = this.now()
        this.sendControl([id], { type: 'ready', car: this.localCar, identity: this.localIdentity, round: this.round,
          ...(this.localDisplayName ? { name: this.localDisplayName } : {}) })
        this.changed()
      }).catch((error: unknown) => {
        if (active === this.generation) this.fail(error instanceof Error ? error.message : 'Could not load the nearby track.', 'receive_track', error)
      })
      return
    }
    if (bytes[0] !== Packet.Control) return
    const message = decodeControl(bytes)
    if (!message) return
    if (this.purpose === 'share') {
      if (fromHost && this.phase === 'waiting' && message.type === 'share-offer') {
        this.receiver = new TrackReceiver()
        this.setPhase('preparing')
        this.armTimeout('The nearby track was not received in time.')
      } else if (this.role === 'host' && this.phase === 'hosting' && message.type === 'share-ready' &&
          (guestSlot !== undefined || this.pendingPairs.has(id))) {
        this.shareReady.add(id)
        this.sendShareToReadyPeer(id)
      } else if (guestSlot !== undefined && this.phase === 'hosting' && message.type === 'share-result') {
        if (message.status === 'saved') this.sharedPeers.add(id)
        this.changed()
      }
      return
    }
    const incomingRound = 'round' in message ? message.round ?? 0 : 0
    if (fromHost && message.type === 'prepare' &&
        (this.phase === 'waiting' && incomingRound === this.round ||
         this.phase === 'racing' && incomingRound === ((this.round + 1) & 0xffff))) {
      if (this.phase === 'racing') {
        this.clearRound()
        this.round = incomingRound
      }
      this.slot = message.slot
      this.prepared = { laps: message.laps, lighting: message.lighting }
      this.receiver = new TrackReceiver()
      this.setPhase('preparing')
      this.armTimeout('The host did not start the race in time.')
    } else if (guestSlot !== undefined && this.phase === 'preparing' &&
        message.type === 'ready' && incomingRound === this.round) {
      if (!this.ready.has(id)) this.ready.set(id, { car: message.car, identity: message.identity,
        ...(message.name ? { name: message.name } : {}), receivedAt: this.now() })
      if (this.ready.size === this.guests.size) this.startHost()
    } else if (fromHost && this.phase === 'preparing' && message.type === 'lineup' &&
        incomingRound === this.round && this.course &&
        message.cars[0] && message.cars[this.slot] === this.localCar) {
      this.stage(this.course, message.cars, message.identities, message.positions, message.names)
    } else if (guestSlot !== undefined && this.phase === 'staging' &&
        message.type === 'armed' && incomingRound === this.round) {
      if (!this.armed.has(id)) this.armed.set(id, this.now())
      this.scheduleHostCountdown()
    } else if (fromHost && this.phase === 'staging' && message.type === 'start' &&
        incomingRound === this.round && this.course &&
        message.cars[0] && message.cars[this.slot] === this.localCar && this.localSceneReady) {
      const now = this.now()
      // Estimate one-way transit after the scene-ready packet, excluding time
      // spent at the host. Device clocks may have arbitrary independent origins.
      const halfRoundTrip = Math.max(0, now - this.readySentAt - message.readyAge) / 2
      this.beginCountdown(now + message.delay - halfRoundTrip)
    } else if (this.phase === 'racing' && incomingRound === this.round && message.type === 'finish' &&
        message.slot !== this.slot && (fromHost || message.slot === guestSlot)) {
      if (this.recordFinish(message.slot, message.time) && !fromHost) this.sendControl(this.endpoints(id), message)
    } else if (this.phase === 'racing' && incomingRound === this.round && fromHost && message.type === 'left' && message.slot !== this.slot) {
      this.markLeft(message.slot)
    }
  }

  private startHost(): void {
    if (!this.course || this.phase !== 'preparing') return
    const cars: (CarId | null)[] = [this.course.car, null, null, null]
    const identities: (PlayerIdentity | null)[] = [this.localIdentity, null, null, null]
    const names: (string | null)[] = [this.localDisplayName ?? null, null, null, null]
    for (const [id, slot] of this.guests) {
      const guest = this.ready.get(id)
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
    const positions: (number | null)[] = [null, null, null, null]
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
      if (car) this.racers.set(slot, {
        ghost: new RemoteGhost(car), identity: identities[slot] ?? DEFAULT_PLAYER_IDENTITY,
        ...(names?.[slot] || (slot === this.slot && this.localDisplayName)
          ? { name: names?.[slot] ?? this.localDisplayName } : {}),
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
        type: 'start', cars: this.lineup, delay: startsAt - now, readyAge: now - receivedAt, round: this.round,
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
    this.setPhase('racing')
    this.record('countdown_scheduled', { remainingMs: Math.round(startsAt - this.now()) })
    this.countdownStarts.publish(startsAt)
  }

  private recordFinish(slot: number, time: number | null): boolean {
    const racer = this.racers.get(slot)
    if (!racer || racer.time !== undefined || racer.left) return false
    racer.time = time
    this.changed()
    return true
  }

  private disconnected(id: string): void {
    this.pendingPairs.delete(id)
    this.shareReady.delete(id)
    this.sentShares.delete(id)
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
      if (this.phase === 'preparing') { this.fail('A player left while the race was loading.'); return }
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
    if (racer) { racer.left = true; this.changed() }
  }

  private endpoints(exclude?: string): string[] {
    return this.hostId ? [this.hostId] : [...this.guests.keys()].filter((id) => id !== exclude)
  }

  private sendControl(ids: string[], message: Control): void {
    if (!ids.length) return
    const active = this.generation
    this.record('control', { kind: message.type, result: 'started', recipients: ids.length })
    void this.transport.send(ids, encodeControl(message)).then(() => {
      if (active === this.generation) this.record('control', { kind: message.type, result: 'succeeded', recipients: ids.length })
    }).catch((error: unknown) => {
      this.record('control', { kind: message.type, result: 'failed', error: this.errorKind(error) })
      if (active !== this.generation) return
      if (message.type === 'finish' || message.type === 'left') {
        this.error = 'A player did not receive the latest race result.'
        this.changed()
      } else this.fail('A nearby race message could not be sent.')
    })
  }

  private begin(phase: Phase): number {
    this.timeline.length = 0
    this.diagnosticStart = this.now()
    this.lastFailure = null
    this.poseSync.resetCounts()
    this.error = null
    this.setPhase(phase)
    return ++this.generation
  }

  private perform(operation: string, action: () => Promise<void>, active: number, complete?: () => void): void {
    this.busy = this.busy.then(async () => {
      if (active !== this.generation) return
      this.record('operation', { operation, result: 'started' })
      await action()
      if (active === this.generation) {
        this.record('operation', { operation, result: 'succeeded' })
        complete?.()
      }
    }).catch((error: unknown) => {
      if (active === this.generation) {
        this.record('operation', { operation, result: 'failed', error: this.errorKind(error) })
        this.fail(error instanceof Error ? error.message : 'Nearby connection failed.', operation, error)
      }
    })
  }

  private queueStop(): void {
    this.busy = this.busy.then(async () => {
      this.record('operation', { operation: 'stop', result: 'started' })
      await this.transport.stop()
      this.record('operation', { operation: 'stop', result: 'succeeded' })
    }).catch((error: unknown) => {
      this.record('operation', { operation: 'stop', result: 'failed', error: this.errorKind(error) })
    })
  }

  private fail(message: string, source = 'flow', error?: unknown): void {
    this.lastFailure = { source, error: error === undefined ? 'flow_error' : this.errorKind(error), phase: this.phase, counts: this.diagnosticCounts() }
    this.record('failure', { source, error: this.lastFailure.error })
    this.reset(message)
    this.queueStop()
  }

  private reset(error: string | null): void {
    this.generation++
    this.clearTimeout()
    this.course = null
    this.incomingShare = null
    this.sharedPeers.clear()
    this.shareReady.clear()
    this.sentShares.clear()
    this.shareStatus = null
    this.sharePacked = null
    this.round = 0
    this.purpose = 'race'
    this.room = null
    this.hostId = null
    this.rooms.clear()
    this.pendingPairs.clear()
    this.guests.clear()
    this.ready.clear()
    this.armed.clear()
    this.localSceneReady = false
    this.lineup = null
    this.readySentAt = 0
    this.racers.clear()
    this.receiver = null
    this.prepared = null
    this.slot = 0
    this.poseSync.reset()
    this.error = error
    this.setPhase('idle')
  }

  private armTimeout(message: string): void {
    this.clearTimeout()
    this.timeout = setTimeout(() => this.fail(message), 30_000)
  }

  private clearTimeout(): void { clearTimeout(this.timeout) }
  private changed(): void { this.changes.publish() }
  private diagnosticCounts() {
    return { rooms: this.rooms.size, pendingPairs: this.pendingPairs.size,
      guests: this.guests.size, ready: this.ready.size, racers: this.racers.size }
  }

  private errorKind(error: unknown): string {
    // Arbitrary exception text can contain endpoint IDs, room names or track data.
    return error instanceof Error ? 'Error' : 'unknown'
  }

  private record(event: string, details: Record<string, unknown> = {}): void {
    this.timeline.push({ atMs: Math.max(0, Math.round(this.now() - this.diagnosticStart)), event,
      phase: this.phase, counts: this.diagnosticCounts(), ...details })
    if (this.timeline.length > NearbyRace.TIMELINE_LIMIT) this.timeline.shift()
  }

  private setPhase(phase: Phase): void {
    const from = this.phase
    this.phase = phase
    this.record('phase', { from, to: phase, role: this.role })
    this.changed()
  }
}
