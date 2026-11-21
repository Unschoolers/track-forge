import { EventBus } from '@/application/eventBus'
import type { GhostPose } from '@/application/race/ghostReplay'
import { CAR_IDS, type CarId, type LightingMode, type Track } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'
import { decodePose, decodePoseBatch, encodePose, encodePoseBatch, Packet, POSE_FAST_PERIOD_MS, POSE_PERIOD_MS, RemoteGhost } from './raceWire'
import { packTrack, TrackReceiver } from './trackTransfer'
import { DEFAULT_PLAYER_IDENTITY, isPlayerIdentity, normalizePlayerIdentity, type PlayerIdentity } from './playerIdentity'

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
  /** The race scene is staged first; GO is scheduled after every scene is ready. */
  readonly startsAt?: number
}

type Phase = 'idle' | 'opening' | 'hosting' | 'scanning' | 'connecting' | 'waiting' | 'preparing' | 'staging' | 'racing'
type Control =
  | { type: 'prepare'; slot: number; laps: number; lighting: LightingMode }
  | { type: 'ready'; car: CarId; identity: PlayerIdentity }
  | { type: 'lineup'; cars: (CarId | null)[]; identities: (PlayerIdentity | null)[] }
  | { type: 'armed' }
  | { type: 'start'; cars: (CarId | null)[]; delay: number; readyAge: number }
  | { type: 'finish'; slot: number; time: number | null }
  | { type: 'left'; slot: number }

interface Racer {
  ghost: RemoteGhost
  identity: PlayerIdentity
  time?: number | null
  left?: boolean
}

const MAX_PLAYERS = 4
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function controlBytes(message: Control): Uint8Array {
  const json = encoder.encode(JSON.stringify(message))
  const packet = new Uint8Array(json.length + 1)
  packet.set(json, 1)
  return packet
}

function readControl(bytes: Uint8Array): Control | null {
  if (bytes.length > 512) return null
  try {
    const value = JSON.parse(decoder.decode(bytes.subarray(1))) as Control | null
    if (!value) return null
    switch (value.type) {
      case 'prepare':
        return Number.isInteger(value.slot) && value.slot > 0 && value.slot < MAX_PLAYERS &&
          Number.isInteger(value.laps) && value.laps >= 1 && value.laps <= 5 &&
          (value.lighting === 'day' || value.lighting === 'night') ? value : null
      case 'ready':
        return CAR_IDS.includes(value.car) && isPlayerIdentity(value.identity) ? value : null
      case 'lineup':
        return Array.isArray(value.cars) && value.cars.length === MAX_PLAYERS &&
          value.cars.every((car) => car === null || CAR_IDS.includes(car)) &&
          Array.isArray(value.identities) && value.identities.length === MAX_PLAYERS &&
          value.identities.every((identity, index) => value.cars[index] === null
            ? identity === null : isPlayerIdentity(identity)) ? value : null
      case 'armed':
        return value
      case 'start':
        return Array.isArray(value.cars) && value.cars.length === MAX_PLAYERS &&
          value.cars.every((car) => car === null || CAR_IDS.includes(car)) &&
          Number.isFinite(value.delay) && value.delay >= 0 && value.delay <= 5000 &&
          Number.isFinite(value.readyAge) && value.readyAge >= 0 && value.readyAge <= 30_000 ? value : null
      case 'finish':
        return Number.isInteger(value.slot) && value.slot >= 0 && value.slot < MAX_PLAYERS &&
          (value.time === null || (Number.isFinite(value.time) && value.time > 0 && value.time < 86_400)) ? value : null
      case 'left':
        return Number.isInteger(value.slot) && value.slot > 0 && value.slot < MAX_PLAYERS ? value : null
      default: return null
    }
  } catch { return null }
}

export class NearbyRace {
  private readonly changes = new EventBus<void>()
  private readonly starts = new EventBus<NearbyStart>()
  private readonly countdownStarts = new EventBus<number>()
  private readonly unsubscribe: () => void
  private phase: Phase = 'idle'
  private role: 'host' | 'guest' | null = null
  private readonly timeline: Record<string, unknown>[] = []
  private diagnosticStart = 0
  private lastFailure: Record<string, unknown> | null = null
  private readonly poseCounts = { sent: 0, received: 0, sendFailed: 0, relayed: 0 }
  private static readonly TIMELINE_LIMIT = 100
  private generation = 0
  private busy: Promise<void> = Promise.resolve()
  private error: string | null = null
  private room: string | null = null
  private hostId: string | null = null
  private course: Course | null = null
  private localCar: CarId = CAR_IDS[0]
  private localIdentity: PlayerIdentity = DEFAULT_PLAYER_IDENTITY
  private readonly rooms = new Map<string, string>()
  private readonly pendingPairs = new Set<string>()
  private readonly guests = new Map<string, number>()
  private readonly ready = new Map<string, { car: CarId; identity: PlayerIdentity; receivedAt: number }>()
  private readonly armed = new Map<string, number>()
  private localSceneReady = false
  private lineup: (CarId | null)[] | null = null
  private readonly racers = new Map<number, Racer>()
  private readonly latestPoses = new Map<number, { bytes: Uint8Array; receivedAt: number }>()
  private receiver: TrackReceiver | null = null
  private prepared: Pick<Course, 'laps' | 'lighting'> | null = null
  private readySentAt = 0
  private slot = 0
  private sequence = 0
  private recovery = 0
  private lastSentAt = -Infinity
  private poseSending = false
  private posePeriodMs = POSE_PERIOD_MS
  private healthySends = 0
  private fastRetryAfter = 0
  private timeout: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly transport: NearbyTransport,
    private readonly validateTrack: (track: Track) => boolean,
    private readonly now = () => performance.now(),
  ) {
    this.unsubscribe = transport.subscribe((event) => this.onEvent(event))
  }

  snapshot() {
    return {
      phase: this.phase, error: this.error, room: this.room, track: this.course?.track.name,
      rooms: [...this.rooms], players: 1 + this.guests.size,
      canStart: this.phase === 'hosting' && this.guests.size > 0 && this.pendingPairs.size === 0,
    }
  }

  async diagnostics(): Promise<Record<string, unknown>> {
    const report: Record<string, unknown> = {
      version: 1,
      role: this.role,
      phase: this.phase,
      counts: this.diagnosticCounts(),
      timeline: this.timeline.map((entry) => ({ ...entry })),
      poseCounts: { ...this.poseCounts },
      targetPoseHz: Math.round(1000 / this.posePeriodMs),
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

  host(course: Course): void {
    if (this.phase !== 'idle') return
    this.role = 'host'
    this.course = course
    const random = crypto.getRandomValues(new Uint16Array(1))[0] ?? 0
    const room = `Room ${1000 + random % 9000}`
    this.room = room
    const active = this.begin('opening')
    this.perform('host', () => this.transport.host(room), active, () => this.setPhase('hosting'))
  }

  scan(car: CarId): void {
    if (this.phase !== 'idle') return
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

  start(): void {
    if (!this.snapshot().canStart || !this.course) return
    const course = this.course
    const active = this.generation
    this.setPhase('preparing')
    this.armTimeout('A player did not load the track in time.')
    void this.prepareGuests(course, active).catch((error: unknown) => {
      if (active === this.generation) this.fail(error instanceof Error ? error.message : 'Could not share the track.', 'prepare', error)
    })
  }

  private async prepareGuests(course: Course, active: number): Promise<void> {
    this.record('transfer', { stage: 'lock' })
    await this.transport.lock()
    const chunks = await packTrack(course.track)
    this.record('transfer', { stage: 'packed', chunks: chunks.length, bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0), recipients: this.guests.size })
    if (active !== this.generation) return
    const guests = [...this.guests]
    await Promise.all(guests.map(([id, slot]) =>
      this.transport.send([id], controlBytes({ type: 'prepare', slot, laps: course.laps, lighting: course.lighting }))))
    for (const chunk of chunks) {
      if (active !== this.generation) return
      await this.transport.send(guests.map(([id]) => id), chunk)
    }
    this.record('transfer', { stage: 'sent', chunks: chunks.length, recipients: guests.length })
  }

  update(vehicle: RaceVehicle): void {
    const now = this.now()
    // Leave two milliseconds of tolerance for a 60 FPS frame clock so the
    // 30 Hz cadence does not slip to one update every three frames.
    if (this.phase !== 'racing' || this.poseSending ||
      now - this.lastSentAt < this.posePeriodMs - 2) return
    const ids = this.endpoints()
    if (!ids.length) return
    const pose = encodePose(this.slot, this.sequence++, this.recovery, vehicle)
    // Guests upload one pose. Host broadcasts one shared snapshot to all
    // guests instead of relaying every guest's packet individually.
    if (!this.hostId) this.latestPoses.set(this.slot, { bytes: pose, receivedAt: now })
    const bytes = this.hostId ? pose : encodePoseBatch(
      [...this.latestPoses].filter(([slot, value]) =>
        now - value.receivedAt <= 300 && !this.racers.get(slot)?.left &&
        this.racers.get(slot)?.time === undefined).map(([, value]) => value.bytes))
    this.lastSentAt = now
    this.poseSending = true
    this.poseCounts.sent++
    const active = this.generation
    void this.transport.send(ids, bytes)
      .then(() => { if (active === this.generation) this.updatePoseRate(now, true) })
      .catch(() => {
        if (active !== this.generation) return
        this.poseCounts.sendFailed++
        this.updatePoseRate(now, false)
      })
      .finally(() => { if (active === this.generation) this.poseSending = false })
  }

  private updatePoseRate(startedAt: number, success: boolean): void {
    const now = this.now()
    const duration = Math.max(0, now - startedAt)
    if (!success || duration > 25) {
      this.posePeriodMs = POSE_PERIOD_MS
      this.healthySends = 0
      this.fastRetryAfter = now + 5000
    } else if (now >= this.fastRetryAfter) {
      this.healthySends = duration <= 12 ? this.healthySends + 1 : 0
      if (this.healthySends >= 30) this.posePeriodMs = POSE_FAST_PERIOD_MS
    }
  }

  recovered(): void { this.recovery++ }

  /** Called only when Phaser has created the race scene and bound its controls. */
  sceneReady(): void {
    if (this.phase !== 'staging' || this.localSceneReady) return
    this.localSceneReady = true
    this.record('scene_ready')
    if (this.role === 'guest' && this.hostId) {
      this.readySentAt = this.now()
      this.sendControl([this.hostId], { type: 'armed' })
    } else if (this.role === 'host') {
      this.scheduleHostCountdown()
    }
  }

  remotePoses(): GhostPose[] {
    const time = this.now()
    return [...this.racers].flatMap(([slot, racer]) => {
      const pose = slot !== this.slot && !racer.left && racer.time === undefined ? racer.ghost.pose(time) : null
      return pose ? [{ ...pose, identity: racer.identity }] : []
    })
  }

  finish(time: number | null): void {
    if (this.phase !== 'racing') return
    this.recordFinish(this.slot, time)
    this.sendControl(this.endpoints(), { type: 'finish', slot: this.slot, time })
  }

  standings() {
    return [...this.racers].map(([slot, racer]) => ({
      slot, car: racer.ghost.car, identity: racer.identity, local: slot === this.slot,
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
        if (this.phase === 'scanning' && /^Room \d{4}$/.test(event.name) && this.rooms.size < 32) {
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
        } else if (this.phase === 'hosting') {
          const slot = [1, 2, 3].find((candidate) => ![...this.guests.values()].includes(candidate))
          if (slot !== undefined) this.guests.set(event.id, slot)
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
    if (!fromHost && guestSlot === undefined) return
    if (bytes[0] === Packet.PoseBatch && fromHost && this.phase === 'racing') {
      const packets = decodePoseBatch(bytes)
      if (!packets) return
      const now = this.now()
      for (const packet of packets) {
        const racer = this.racers.get(packet.slot)
        if (!racer || racer.left || packet.slot === this.slot) continue
        this.poseCounts.received++
        racer.ghost.receive(packet, now)
      }
      return
    }
    if (bytes[0] === Packet.Pose && this.phase === 'racing') {
      const packet = decodePose(bytes)
      const racer = packet && this.racers.get(packet.slot)
      if (!packet || !racer || racer.left || packet.slot === this.slot || (!fromHost && packet.slot !== guestSlot)) return
      this.poseCounts.received++
      if (racer.ghost.receive(packet, this.now()) && !fromHost) {
        this.latestPoses.set(packet.slot, { bytes: new Uint8Array(bytes), receivedAt: this.now() })
        this.poseCounts.relayed++
      }
      return
    }
    if (bytes[0] === Packet.Track && fromHost && this.phase === 'preparing' && this.receiver) {
      const active = this.generation
      const receiver = this.receiver
      void receiver.receive(bytes).then((track) => {
        if (!track || active !== this.generation || this.receiver !== receiver || !this.prepared) return
        if (!this.validateTrack(track)) throw new Error('The nearby track is not ready to race.')
        this.receiver = null
        this.course = { ...this.prepared, track, car: this.localCar }
        this.readySentAt = this.now()
        this.sendControl([id], { type: 'ready', car: this.localCar, identity: this.localIdentity })
        this.changed()
      }).catch((error: unknown) => {
        if (active === this.generation) this.fail(error instanceof Error ? error.message : 'Could not load the nearby track.', 'receive_track', error)
      })
      return
    }
    if (bytes[0] !== Packet.Control) return
    const message = readControl(bytes)
    if (!message) return
    if (fromHost && this.phase === 'waiting' && message.type === 'prepare') {
      this.slot = message.slot
      this.prepared = { laps: message.laps, lighting: message.lighting }
      this.receiver = new TrackReceiver()
      this.setPhase('preparing')
      this.armTimeout('The host did not start the race in time.')
    } else if (guestSlot !== undefined && this.phase === 'preparing' && message.type === 'ready') {
      if (!this.ready.has(id)) this.ready.set(id, { car: message.car, identity: message.identity, receivedAt: this.now() })
      if (this.ready.size === this.guests.size) this.startHost()
    } else if (fromHost && this.phase === 'preparing' && message.type === 'lineup' && this.course &&
        message.cars[0] && message.cars[this.slot] === this.localCar) {
      this.stage(this.course, message.cars, message.identities)
    } else if (guestSlot !== undefined && this.phase === 'staging' && message.type === 'armed') {
      if (!this.armed.has(id)) this.armed.set(id, this.now())
      this.scheduleHostCountdown()
    } else if (fromHost && this.phase === 'staging' && message.type === 'start' && this.course &&
        message.cars[0] && message.cars[this.slot] === this.localCar && this.localSceneReady) {
      const now = this.now()
      // Estimate one-way transit after the scene-ready packet, excluding time
      // spent at the host. Device clocks may have arbitrary independent origins.
      const halfRoundTrip = Math.max(0, now - this.readySentAt - message.readyAge) / 2
      this.beginCountdown(now + message.delay - halfRoundTrip)
    } else if (this.phase === 'racing' && message.type === 'finish' &&
        message.slot !== this.slot && (fromHost || message.slot === guestSlot)) {
      if (this.recordFinish(message.slot, message.time) && !fromHost) this.sendControl(this.endpoints(id), message)
    } else if (this.phase === 'racing' && fromHost && message.type === 'left' && message.slot !== this.slot) {
      this.markLeft(message.slot)
    }
  }

  private startHost(): void {
    if (!this.course || this.phase !== 'preparing') return
    const cars: (CarId | null)[] = [this.course.car, null, null, null]
    const identities: (PlayerIdentity | null)[] = [this.localIdentity, null, null, null]
    for (const [id, slot] of this.guests) {
      const guest = this.ready.get(id)
      if (!guest) return
      cars[slot] = guest.car
      identities[slot] = guest.identity
    }
    this.stage(this.course, cars, identities)
    this.sendControl([...this.guests.keys()], { type: 'lineup', cars, identities })
  }

  private stage(course: Course, cars: (CarId | null)[], identities: (PlayerIdentity | null)[]): void {
    this.lineup = cars
    cars.forEach((car, slot) => {
      if (car) this.racers.set(slot, {
        ghost: new RemoteGhost(car), identity: identities[slot] ?? DEFAULT_PLAYER_IDENTITY,
      })
    })
    this.setPhase('staging')
    this.armTimeout('A player did not finish loading the race scene.')
    this.starts.publish({ ...course })
  }

  private scheduleHostCountdown(): void {
    if (this.role !== 'host' || this.phase !== 'staging' || !this.localSceneReady ||
        this.armed.size !== this.guests.size || !this.lineup) return
    const startsAt = this.now() + 4000
    for (const [id, receivedAt] of this.armed) {
      const now = this.now()
      this.sendControl([id], {
        type: 'start', cars: this.lineup, delay: startsAt - now, readyAge: now - receivedAt,
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
        this.sendControl(this.endpoints(), { type: 'left', slot })
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
    void this.transport.send(ids, controlBytes(message)).then(() => {
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
    Object.assign(this.poseCounts, { sent: 0, received: 0, sendFailed: 0, relayed: 0 })
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
    this.latestPoses.clear()
    this.receiver = null
    this.prepared = null
    this.slot = this.sequence = this.recovery = 0
    this.lastSentAt = -Infinity
    this.poseSending = false
    this.posePeriodMs = POSE_PERIOD_MS
    this.healthySends = 0
    this.fastRetryAfter = 0
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
