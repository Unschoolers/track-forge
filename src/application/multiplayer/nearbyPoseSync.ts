import type { GhostPose } from '@/application/race/ghostReplay'
import type { PlayerIdentity } from '@/application/multiplayer/playerIdentity'
import type { RaceVehicle } from '@/domain/race/raceState'
import {
  decodePose, decodePoseBatch, encodePose, encodePoseBatch,
  Packet, POSE_PERIOD_MS,
  POSE_RECOVERY_MASK, POSE_SEQUENCE_MASK, WIRE_ROUND_MASK, type RemoteGhost,
} from '@/application/multiplayer/raceWire'

/** Preserve insertion order and avoid intermediate filter/map arrays per host send. */
export function activePosePackets(
  poses: ReadonlyMap<number, { readonly bytes: Uint8Array; readonly receivedAt: number }>,
  racers: ReadonlyMap<number, { readonly left?: boolean | undefined; readonly time?: number | null | undefined }>,
  now: number,
): Uint8Array[] {
  const packets: Uint8Array[] = []
  for (const [slot, value] of poses) {
    const racer = racers.get(slot)
    // A live pose can arrive before the room roster is updated. Keep it,
    // matching the original relay rule, until the roster says left or finished.
    if (racer?.left || racer?.time !== undefined || now - value.receivedAt > 2000) continue
    packets.push(value.bytes)
  }
  return packets
}

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
  private round = 0
  private sequence = 0
  private recovery = 0
  private lastSentAt = -Infinity
  private nextSendAt = -Infinity
  private poseSending = false

  constructor(
    private readonly send: (recipients: string[], bytes: Uint8Array) => Promise<void>,
    private readonly now: () => number,
    private readonly observePose?: (slot: number, sequence: number, accepted: boolean, at: number) => void,
  ) {}

  get counts() { return { ...this.poseCounts } }
  get targetPoseHz(): number { return Math.round(1000 / POSE_PERIOD_MS) }

  resetCounts(): void {
    Object.assign(this.poseCounts, { sent: 0, received: 0, sendFailed: 0, relayed: 0 })
  }

  /** Invalidate any late send completions when a room closes. */
  reset(): void {
    this.generation++
    this.resetCounts()
    this.latestPoses.clear()
    this.round = 0
    this.sequence = 0
    this.recovery = 0
    this.lastSentAt = -Infinity
    this.nextSendAt = -Infinity
    this.poseSending = false
  }

  setRound(round: number): void { this.round = round & WIRE_ROUND_MASK }

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
    // Retain the 30 Hz deadline instead of resetting the cadence to each late
    // render frame. Otherwise missed vsyncs permanently lower the send rate.
    // Do not burst after a stall; at most one fresh pose per update, separated
    // by at least half a period. Never queue while bridge admission is pending.
    if (this.poseSending || !recipients.length || now + 2 < this.nextSendAt ||
        now - this.lastSentAt < POSE_PERIOD_MS / 2) return
    const pose = encodePose(localSlot, this.sequence, this.recovery, vehicle, this.round)
    this.sequence = (this.sequence + 1) & POSE_SEQUENCE_MASK
    if (!hostId) this.latestPoses.set(localSlot, { bytes: pose, receivedAt: now })
    const bytes = hostId ? pose : encodePoseBatch(
      activePosePackets(this.latestPoses, racers, now))
    const deadline = Number.isFinite(this.nextSendAt) ? this.nextSendAt : now
    const periods = Math.max(1, Math.floor((now + 2 - deadline) / POSE_PERIOD_MS) + 1)
    this.nextSendAt = deadline + periods * POSE_PERIOD_MS
    this.lastSentAt = now
    this.poseSending = true
    this.poseCounts.sent++
    const active = this.generation
    void this.send(recipients, bytes)
      .catch(() => {
        if (active === this.generation) this.poseCounts.sendFailed++
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
      if (!packets || packets.some(packet => packet.round !== this.round)) return true
      const now = this.now()
      for (const packet of packets) {
        const racer = racers.get(packet.slot)
        if (!racer || racer.left || packet.slot === localSlot) continue
        this.poseCounts.received++
        const accepted = racer.ghost.receive(packet, now)
        this.observePose?.(packet.slot, packet.sequence, accepted, now)
      }
      return true
    }
    if (bytes[0] === Packet.Pose) {
      const packet = decodePose(bytes)
      const racer = packet && racers.get(packet.slot)
      if (!packet || packet.round !== this.round || !racer || racer.left || packet.slot === localSlot ||
          (!fromHost && packet.slot !== guestSlot)) return true
      this.poseCounts.received++
      const now = this.now()
      const accepted = racer.ghost.receive(packet, now)
      this.observePose?.(packet.slot, packet.sequence, accepted, now)
      if (accepted && !fromHost) {
        this.latestPoses.set(packet.slot, { bytes: new Uint8Array(bytes), receivedAt: now })
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

}
