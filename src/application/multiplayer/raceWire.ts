import { captureGhost, ghostPoseAt, type GhostPose } from '@/application/race/ghostReplay'
import type { CarId } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'

export const POSE_BYTES = 19
export const POSE_SEQUENCE_MASK = 0xffff
export const POSE_RECOVERY_MASK = 0xff
export const POSE_PERIOD_MS = 1000 / 30
export const POSE_FAST_PERIOD_MS = 1000 / 60
const SCALE = 32
const TURN = 2 * Math.PI

export const Packet = { Control: 0, Pose: 1, Track: 2, PoseBatch: 3 } as const

export interface PosePacket {
  readonly slot: number
  readonly sequence: number
  readonly recovery: number
  readonly pose: Omit<GhostPose, 'car' | 't'>
}

const MIN_POSE_COORDINATE = -0x80000000
const MAX_POSE_COORDINATE = 0x7fffffff

function poseCoordinate(value: number): number {
  const fixed = Math.round(value * SCALE)
  if (!Number.isFinite(fixed) || fixed < MIN_POSE_COORDINATE || fixed > MAX_POSE_COORDINATE) {
    throw new RangeError('Invalid nearby pose values.')
  }
  return fixed
}

export function encodePose(slot: number, sequence: number, recovery: number, vehicle: RaceVehicle): Uint8Array {
  const pose = captureGhost(vehicle, 0)
  // DataView silently converts NaN to zero and wraps integer overflow.
  // Validate once, before allocating the high-frequency network packet.
  if (!Number.isInteger(slot) || slot < 0 || slot > 3 ||
      !Number.isInteger(sequence) || sequence < 0 || sequence > POSE_SEQUENCE_MASK ||
      !Number.isInteger(recovery) || recovery < 0 || recovery > POSE_RECOVERY_MASK ||
      !Number.isFinite(pose.angle)) {
    throw new RangeError('Invalid nearby pose values.')
  }
  const x = poseCoordinate(pose.x)
  const y = poseCoordinate(pose.y)
  const z = poseCoordinate(pose.z)
  const bytes = new Uint8Array(POSE_BYTES)
  const view = new DataView(bytes.buffer)
  bytes[0] = Packet.Pose
  bytes[1] = slot | (pose.structureRunId === null ? 0 : 4)
  bytes[2] = recovery
  view.setUint16(3, sequence, true)
  view.setInt32(5, x, true)
  view.setInt32(9, y, true)
  view.setInt32(13, z, true)
  view.setUint16(17, Math.round(pose.angle / TURN * 65536), true)
  return bytes
}

export function decodePose(bytes: Uint8Array): PosePacket | null {
  if (bytes.length !== POSE_BYTES || bytes[0] !== Packet.Pose) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = view.getUint8(1)
  if (flags > 7) return null
  return {
    slot: flags & 3,
    sequence: view.getUint16(3, true),
    recovery: view.getUint8(2),
    pose: {
      x: view.getInt32(5, true) / SCALE,
      y: view.getInt32(9, true) / SCALE,
      z: view.getInt32(13, true) / SCALE,
      angle: view.getUint16(17, true) * TURN / 65536,
      structureRunId: flags & 4 ? 'elevated' : null,
    },
  }
}

/** One host broadcast containing the latest unique slot positions. */
export function encodePoseBatch(packets: readonly Uint8Array[]): Uint8Array {
  if (!packets.length || packets.length > 4) throw new RangeError('Invalid nearby pose batch size.')
  const bytes = new Uint8Array(1 + packets.length * POSE_BYTES)
  const slots = new Set<number>()
  bytes[0] = Packet.PoseBatch
  packets.forEach((packet, index) => {
    const pose = decodePose(packet)
    if (!pose || slots.has(pose.slot)) throw new RangeError('Invalid or duplicate nearby pose.')
    slots.add(pose.slot)
    bytes.set(packet, 1 + index * POSE_BYTES)
  })
  return bytes
}

export function decodePoseBatch(bytes: Uint8Array): PosePacket[] | null {
  if (bytes[0] !== Packet.PoseBatch || bytes.length < POSE_BYTES + 1 ||
      bytes.length > 1 + 4 * POSE_BYTES || (bytes.length - 1) % POSE_BYTES !== 0) return null
  const packets: PosePacket[] = []
  const slots = new Set<number>()
  for (let offset = 1; offset < bytes.length; offset += POSE_BYTES) {
    const packet = decodePose(bytes.subarray(offset, offset + POSE_BYTES))
    if (!packet || slots.has(packet.slot)) return null
    slots.add(packet.slot)
    packets.push(packet)
  }
  return packets
}

export class RemoteGhost {
  private frames: GhostPose[] = []
  private sequence: number | undefined
  private recovery: number | undefined
  private arrival = 0
  private estimatedPeriodMs = POSE_PERIOD_MS

  constructor(readonly car: CarId) {}

  receive(packet: PosePacket, now: number): boolean {
    const advance = this.sequence === undefined ? 1 : (packet.sequence - this.sequence) & 0xffff
    if (advance === 0 || advance >= 0x8000) return false
    const last = this.frames.at(-1)
    // Accept 30-60 Hz and packet losses without assuming a fixed send cadence.
    if (!last || now - this.arrival > 500) {
      this.frames = []
      this.estimatedPeriodMs = POSE_PERIOD_MS
    } else {
      const observedPeriod = (now - this.arrival) / advance
      if (observedPeriod >= POSE_FAST_PERIOD_MS * 0.5 && observedPeriod <= 200) {
        this.estimatedPeriodMs = Math.max(POSE_FAST_PERIOD_MS, Math.min(100,
          this.estimatedPeriodMs * 0.8 + observedPeriod * 0.2))
      }
    }
    const time = this.frames.length && last
      ? Math.max(now - 75, Math.min(now + 75, last.t + advance * this.estimatedPeriodMs))
      : now
    this.frames.push({
      ...packet.pose, car: this.car, t: last && this.frames.length ? Math.max(last.t + 1, time) : time,
      cut: packet.recovery !== this.recovery,
    })
    if (this.frames.length > 8) this.frames.shift()
    this.sequence = packet.sequence
    this.recovery = packet.recovery
    this.arrival = now
    return true
  }

  pose(now: number): GhostPose | null {
    const last = this.frames.at(-1)
    const first = this.frames[0]
    if (!first || !last || now - this.arrival > 750) return null
    const target = Math.max(first.t, now - 100)
    if (target <= last.t) return ghostPoseAt({ car: this.car, frames: this.frames, time: last.t }, target)

    // Brief dead reckoning hides intermittent radio gaps. Never predict across
    // a recovery/teleport or a road elevation change; cap displacement and time.
    const previous = this.frames.at(-2)
    const deltaTime = previous ? last.t - previous.t : 0
    if (!previous || last.cut || previous.structureRunId !== last.structureRunId || deltaTime < 12) {
      return { ...last, car: this.car }
    }
    const dx = last.x - previous.x
    const dy = last.y - previous.y
    const distance = Math.hypot(dx, dy)
    const fraction = Math.min(120, target - last.t) / deltaTime
    const bounded = Math.min(fraction, 75 / Math.max(0.001, distance))
    const turn = Math.atan2(Math.sin(last.angle - previous.angle), Math.cos(last.angle - previous.angle))
    return {
      ...last, car: this.car, t: target,
      x: last.x + dx * bounded,
      y: last.y + dy * bounded,
      z: last.z + (last.z - previous.z) * bounded,
      angle: last.angle + turn * bounded,
    }
  }
}
