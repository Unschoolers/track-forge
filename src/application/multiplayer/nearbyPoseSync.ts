import type { GhostPose } from '@/application/race/ghostReplay'
import type { PlayerIdentity } from '@/application/multiplayer/playerIdentity'
import type { RaceVehicle } from '@/domain/race/raceState'
import {
  decodePose, decodePoseBatch, encodePose, encodePoseBatch,
  Packet, POSE_FAST_PERIOD_MS, POSE_PERIOD_MS,
  POSE_RECOVERY_MASK, POSE_SEQUENCE_MASK, type RemoteGhost,
} from '@/application/multiplayer/raceWire'

/** Lifecycle state belongs to the lobby; pose transport only reads it. */
export interface PoseRacer {
  ghost: RemoteGhost
  identity: PlayerIdentity
  name?: string
  time?: number | null
  left?: boolean
}

export class NearbyPoseSync {
  private readonly poseCounts = { sent: 0, received: 0, sendFailed: 0, relayed: 0 }
  private readonly latestPoses = new Map<number, { bytes: Uint8Array; receivedAt: number }>()
  private generation = 0
  private sequence = 0
  private recovery = 0
  private lastSentAt = -Infinity
  private poseSending = false
  private posePeriodMs = POSE_PERIOD_MS
  private healthySends = 0
  private fastRetryAfter = 0

  constructor(
    private readonly send: (recipients: string[], bytes: Uint8Array) => Promise<void>,
    private readonly now: () => number,
  ) {}

  get counts() { return { ...this.poseCounts } }
  get targetPoseHz(): number { return Math.round(1000 / this.posePeriodMs) }

  resetCounts(): void {
    Object.assign(this.poseCounts, { sent: 0, received: 0, sendFailed: 0, relayed: 0 })
  }

  /** Invalidate any late send completions when a room closes. */
  reset(): void {
    this.generation++
    this.resetCounts()
    this.latestPoses.clear()
    this.sequence = 0
    this.recovery = 0
    this.lastSentAt = -Infinity
    this.poseSending = false
    this.posePeriodMs = POSE_PERIOD_MS
    this.healthySends = 0
    this.fastRetryAfter = 0
  }

  recovered(): void { this.recovery = (this.recovery + 1) & POSE_RECOVERY_MASK }

  update(
    vehicle: RaceVehicle,
    localSlot: number,
    hostId: string | null,
    recipients: string[],
    racers: ReadonlyMap<number, PoseRacer>,
  ): void {
    const now = this.now()
    // One compact batch is broadcast to all connected guests. Native Nearby
    // drops obsolete per-endpoint poses if a recipient is still congested.
    if (this.poseSending || now - this.lastSentAt < this.posePeriodMs - 2 || !recipients.length) return
    const pose = encodePose(localSlot, this.sequence, this.recovery, vehicle)
    this.sequence = (this.sequence + 1) & POSE_SEQUENCE_MASK
    if (!hostId) this.latestPoses.set(localSlot, { bytes: pose, receivedAt: now })
    const bytes = hostId ? pose : encodePoseBatch(
      [...this.latestPoses].filter(([slot, value]) =>
        now - value.receivedAt <= 300 && !racers.get(slot)?.left &&
        racers.get(slot)?.time === undefined).map(([, value]) => value.bytes))
    this.lastSentAt = now
    this.poseSending = true
    this.poseCounts.sent++
    const active = this.generation
    void this.send(recipients, bytes)
      .then(() => { if (active === this.generation) this.updatePoseRate(now, true) })
      .catch(() => {
        if (active !== this.generation) return
        this.poseCounts.sendFailed++
        this.updatePoseRate(now, false)
      })
      .finally(() => { if (active === this.generation) this.poseSending = false })
  }

  /** Only consume position traffic; leave control/track messages to the lobby. */
  receive(
    bytes: Uint8Array,
    fromHost: boolean,
    guestSlot: number | undefined,
    localSlot: number,
    racers: ReadonlyMap<number, PoseRacer>,
  ): boolean {
    if (bytes[0] === Packet.PoseBatch && fromHost) {
      const packets = decodePoseBatch(bytes)
      if (!packets) return true
      const now = this.now()
      for (const packet of packets) {
        const racer = racers.get(packet.slot)
        if (!racer || racer.left || packet.slot === localSlot) continue
        this.poseCounts.received++
        racer.ghost.receive(packet, now)
      }
      return true
    }
    if (bytes[0] === Packet.Pose) {
      const packet = decodePose(bytes)
      const racer = packet && racers.get(packet.slot)
      if (!packet || !racer || racer.left || packet.slot === localSlot ||
          (!fromHost && packet.slot !== guestSlot)) return true
      this.poseCounts.received++
      if (racer.ghost.receive(packet, this.now()) && !fromHost) {
        this.latestPoses.set(packet.slot, { bytes: new Uint8Array(bytes), receivedAt: this.now() })
        this.poseCounts.relayed++
      }
      return true
    }
    return false
  }

  remotePoses(racers: ReadonlyMap<number, PoseRacer>, localSlot: number): GhostPose[] {
    const time = this.now()
    return [...racers].flatMap(([slot, racer]) => {
      const pose = slot !== localSlot && !racer.left && racer.time === undefined ? racer.ghost.pose(time) : null
      return pose ? [{ ...pose, identity: racer.identity }] : []
    })
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
}
