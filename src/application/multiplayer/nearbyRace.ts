import { EventBus } from '@/application/eventBus'
import type { GhostPose } from '@/application/race/ghostReplay'
import { CAR_IDS, type CarId, type LightingMode, type Track } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'
import { decodePose, encodePose, Packet, POSE_PERIOD_MS, RemoteGhost } from './raceWire'
import { packTrack, TrackReceiver } from './trackTransfer'

export type NearbyEvent =
  | { type: 'found'; id: string; name: string }
  | { type: 'lost' | 'connected' | 'disconnected'; id: string }
  | { type: 'pairing'; id: string; code: string }
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
}

interface Course {
  readonly track: Track
  readonly laps: number
  readonly lighting: LightingMode
  readonly car: CarId
}

export interface NearbyStart extends Course {
  readonly startsAt: number
}

type Phase = 'idle' | 'opening' | 'hosting' | 'scanning' | 'connecting' | 'waiting' | 'preparing' | 'racing'
type Control =
  | { type: 'prepare'; slot: number; laps: number; lighting: LightingMode }
  | { type: 'ready'; car: CarId }
  | { type: 'start'; cars: (CarId | null)[]; delay: number; readyAge: number }
  | { type: 'finish'; slot: number; time: number | null }
  | { type: 'left'; slot: number }

interface Racer {
  ghost: RemoteGhost
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
        return CAR_IDS.includes(value.car) ? value : null
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
  private readonly unsubscribe: () => void
  private phase: Phase = 'idle'
  private generation = 0
  private busy: Promise<void> = Promise.resolve()
  private error: string | null = null
  private room: string | null = null
  private hostId: string | null = null
  private course: Course | null = null
  private localCar: CarId = CAR_IDS[0]
  private readonly rooms = new Map<string, string>()
  private readonly pairs = new Map<string, string>()
  private readonly pendingPairs = new Set<string>()
  private readonly guests = new Map<string, number>()
  private readonly ready = new Map<string, { car: CarId; receivedAt: number }>()
  private readonly racers = new Map<number, Racer>()
  private readonly forwarding = new Set<string>()
  private receiver: TrackReceiver | null = null
  private prepared: Pick<Course, 'laps' | 'lighting'> | null = null
  private readySentAt = 0
  private slot = 0
  private sequence = 0
  private recovery = 0
  private lastSentAt = -Infinity
  private poseSending = false
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
      rooms: [...this.rooms], pairing: [...this.pairs], players: 1 + this.guests.size,
      canStart: this.phase === 'hosting' && this.guests.size > 0 && this.pairs.size === 0 && this.pendingPairs.size === 0,
    }
  }

  subscribe(listener: () => void) { return this.changes.subscribe(listener) }
  onStart(listener: (start: NearbyStart) => void) { return this.starts.subscribe(listener) }

  host(course: Course): void {
    if (this.phase !== 'idle') return
    this.course = course
    const random = crypto.getRandomValues(new Uint16Array(1))[0] ?? 0
    const room = `Room ${1000 + random % 9000}`
    this.room = room
    const active = this.begin('opening')
    this.perform(() => this.transport.host(room), active, () => this.setPhase('hosting'))
  }

  scan(car: CarId): void {
    if (this.phase !== 'idle') return
    this.localCar = car
    const active = this.begin('scanning')
    this.perform(() => this.transport.scan(), active)
  }

  connect(id: string): void {
    const room = this.rooms.get(id)
    if (this.phase !== 'scanning' || !room) return
    this.hostId = id
    this.room = room
    this.setPhase('connecting')
    this.armTimeout('Could not connect to the nearby room.')
    this.perform(() => this.transport.connect(id), this.generation)
  }

  respond(id: string, accepted: boolean): void {
    if (!this.pairs.delete(id)) return
    if (accepted) this.pendingPairs.add(id)
    const active = this.generation
    this.perform(() => this.transport.respond(id, accepted), active, () => {
      if (!accepted && id === this.hostId) this.fail('Pairing declined.')
    })
    this.changed()
  }

  start(): void {
    if (!this.snapshot().canStart || !this.course) return
    const course = this.course
    const active = this.generation
    this.setPhase('preparing')
    this.armTimeout('A player did not load the track in time.')
    void this.prepareGuests(course, active).catch((error: unknown) => {
      if (active === this.generation) this.fail(error instanceof Error ? error.message : 'Could not share the track.')
    })
  }

  private async prepareGuests(course: Course, active: number): Promise<void> {
    await this.transport.lock()
    const chunks = await packTrack(course.track)
    if (active !== this.generation) return
    const guests = [...this.guests]
    await Promise.all(guests.map(([id, slot]) =>
      this.transport.send([id], controlBytes({ type: 'prepare', slot, laps: course.laps, lighting: course.lighting }))))
    for (const chunk of chunks) {
      if (active !== this.generation) return
      await this.transport.send(guests.map(([id]) => id), chunk)
    }
  }

  update(vehicle: RaceVehicle): void {
    const now = this.now()
    if (this.phase !== 'racing' || this.poseSending || now - this.lastSentAt < POSE_PERIOD_MS) return
    const ids = this.endpoints()
    if (!ids.length) return
    this.lastSentAt = now
    this.poseSending = true
    const active = this.generation
    void this.transport.send(ids, encodePose(this.slot, this.sequence++, this.recovery, vehicle))
      .catch(() => undefined)
      .finally(() => { if (active === this.generation) this.poseSending = false })
  }

  recovered(): void { this.recovery++ }

  remotePoses(): GhostPose[] {
    const time = this.now()
    return [...this.racers].flatMap(([slot, racer]) => {
      const pose = slot !== this.slot && !racer.left && racer.time === undefined ? racer.ghost.pose(time) : null
      return pose ? [pose] : []
    })
  }

  finish(time: number | null): void {
    if (this.phase !== 'racing') return
    this.recordFinish(this.slot, time)
    this.sendControl(this.endpoints(), { type: 'finish', slot: this.slot, time })
  }

  standings() {
    return [...this.racers].map(([slot, racer]) => ({
      slot, car: racer.ghost.car, local: slot === this.slot, time: racer.time, left: racer.left ?? false,
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
  }

  private onEvent(event: NearbyEvent): void {
    if (this.phase === 'idle') return
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
      case 'pairing':
        if (event.id === this.hostId || (this.phase === 'hosting' &&
            this.guests.size + this.pairs.size + this.pendingPairs.size < MAX_PLAYERS - 1)) {
          this.pairs.set(event.id, event.code)
          this.changed()
        } else {
          void this.transport.respond(event.id, false).catch(() => undefined)
        }
        break
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
          this.pairs.delete(event.id)
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
    if (bytes[0] === Packet.Pose && this.phase === 'racing') {
      const packet = decodePose(bytes)
      const racer = packet && this.racers.get(packet.slot)
      if (!packet || !racer || racer.left || packet.slot === this.slot || (!fromHost && packet.slot !== guestSlot)) return
      if (racer.ghost.receive(packet, this.now()) && !fromHost) this.relayPose(id, bytes)
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
        this.sendControl([id], { type: 'ready', car: this.localCar })
        this.changed()
      }).catch((error: unknown) => {
        if (active === this.generation) this.fail(error instanceof Error ? error.message : 'Could not load the nearby track.')
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
      this.ready.set(id, { car: message.car, receivedAt: this.now() })
      if (this.ready.size === this.guests.size) this.startHost()
    } else if (fromHost && this.phase === 'preparing' && message.type === 'start' && this.course &&
        message.cars[0] && message.cars[this.slot] === this.localCar) {
      const now = this.now()
      const halfRoundTrip = Math.max(0, now - this.readySentAt - message.readyAge) / 2
      this.launch(this.course, message.cars, now + Math.max(0, message.delay - halfRoundTrip))
    } else if (this.phase === 'racing' && message.type === 'finish' &&
        message.slot !== this.slot && (fromHost || message.slot === guestSlot)) {
      if (this.recordFinish(message.slot, message.time) && !fromHost) this.sendControl(this.endpoints(id), message)
    } else if (this.phase === 'racing' && fromHost && message.type === 'left' && message.slot !== this.slot) {
      this.markLeft(message.slot)
    }
  }

  private relayPose(id: string, bytes: Uint8Array): void {
    const recipients = this.endpoints(id)
    if (!recipients.length || this.forwarding.has(id)) return
    const generation = this.generation
    this.forwarding.add(id)
    void this.transport.send(recipients, bytes).catch(() => undefined).finally(() => {
      if (generation === this.generation) this.forwarding.delete(id)
    })
  }

  private startHost(): void {
    if (!this.course) return
    const cars: (CarId | null)[] = [this.course.car, null, null, null]
    for (const [id, slot] of this.guests) {
      const guest = this.ready.get(id)
      if (!guest) return
      cars[slot] = guest.car
    }
    const startsAt = this.now() + 4000
    for (const [id, guest] of this.ready) {
      const now = this.now()
      this.sendControl([id], { type: 'start', cars, delay: startsAt - now, readyAge: now - guest.receivedAt })
    }
    this.launch(this.course, cars, startsAt)
  }

  private launch(course: Course, cars: (CarId | null)[], startsAt: number): void {
    this.clearTimeout()
    cars.forEach((car, slot) => { if (car) this.racers.set(slot, { ghost: new RemoteGhost(car) }) })
    this.phase = 'racing'
    this.starts.publish({ ...course, startsAt })
  }

  private recordFinish(slot: number, time: number | null): boolean {
    const racer = this.racers.get(slot)
    if (!racer || racer.time !== undefined || racer.left) return false
    racer.time = time
    this.changed()
    return true
  }

  private disconnected(id: string): void {
    this.pairs.delete(id)
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
    void this.transport.send(ids, controlBytes(message)).catch(() => {
      if (active === this.generation) this.fail('A nearby race message could not be sent.')
    })
  }

  private begin(phase: Phase): number {
    this.error = null
    this.setPhase(phase)
    return ++this.generation
  }

  private perform(action: () => Promise<void>, active: number, complete?: () => void): void {
    this.busy = this.busy.then(async () => {
      if (active !== this.generation) return
      await action()
      if (active === this.generation) complete?.()
    }).catch((error: unknown) => {
      if (active === this.generation) this.fail(error instanceof Error ? error.message : 'Nearby connection failed.')
    })
  }

  private queueStop(): void {
    this.busy = this.busy.then(() => this.transport.stop()).catch(() => undefined)
  }

  private fail(message: string): void {
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
    this.pairs.clear()
    this.pendingPairs.clear()
    this.guests.clear()
    this.ready.clear()
    this.racers.clear()
    this.forwarding.clear()
    this.receiver = null
    this.prepared = null
    this.slot = this.sequence = this.recovery = 0
    this.lastSentAt = -Infinity
    this.poseSending = false
    this.error = error
    this.setPhase('idle')
  }

  private armTimeout(message: string): void {
    this.clearTimeout()
    this.timeout = setTimeout(() => this.fail(message), 30_000)
  }

  private clearTimeout(): void { clearTimeout(this.timeout) }
  private changed(): void { this.changes.publish() }
  private setPhase(phase: Phase): void { this.phase = phase; this.changed() }
}
