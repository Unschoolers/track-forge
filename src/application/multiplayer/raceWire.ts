import { captureGhost, ghostPoseAt, type GhostPose } from '@/application/race/ghostReplay'
import type { CarId } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'

export const POSE_BYTES = 19
export const PROGRESS_BYTES = 8
export const PROGRESS_PERIOD_MS = 150
export const POSE_SEQUENCE_MASK = 0xffff
export const POSE_RECOVERY_MASK = 0xff
/** Five unused header bits isolate in-flight packets across rematches for up to
 * 32 concurrent round epochs without growing the 19-byte/8-byte payloads.
 * Old clients understand round zero; later rounds require this protocol version.
 */
export const WIRE_ROUND_MASK = 31

function roundBits(round: number): number {
  if (!Number.isInteger(round) || round < 0 || round > 65_535) {
    throw new RangeError('Invalid nearby race round.')
  }
  return round & WIRE_ROUND_MASK
}

/** Compare unsigned 16-bit wire sequences without accepting delayed/replayed packets. */
export function isNewerWireSequence(next: number, previous: number | undefined): boolean {
  if (!Number.isInteger(next) || next < 0 || next > POSE_SEQUENCE_MASK) return false
  if (previous === undefined) return true
  if (!Number.isInteger(previous) || previous < 0 || previous > POSE_SEQUENCE_MASK) return false
  const advance = (next - previous) & POSE_SEQUENCE_MASK
  return advance !== 0 && advance < 0x8000
}
/** A brief radio pause should freeze a rival, not make its car vanish. */
export const REMOTE_POSE_EXPIRY_MS = 2000
export const POSE_PERIOD_MS = 1000 / 30
export const POSE_FAST_PERIOD_MS = 1000 / 60
const SCALE = 32
const TURN = 2 * Math.PI

export const Packet = { Control: 0, Pose: 1, Track: 2, PoseBatch: 3, Progress: 4 } as const

/** Separate, optional telemetry keeps legacy 19-byte car poses compatible. */
export interface ProgressPacket {
  readonly slot: number
  readonly round: number
  readonly sequence: number
  /** Same path-index based measure used by single-player ranking. */
  readonly progress: number
}

export function encodeProgress(slot: number, sequence: number, progress: number, round = 0): Uint8Array {
  const epoch = roundBits(round)
  if (!Number.isInteger(slot) || slot < 0 || slot > 3 ||
      !Number.isInteger(sequence) || sequence < 0 || sequence > POSE_SEQUENCE_MASK ||
      !Number.isFinite(progress) || Math.abs(progress) > 10_000_000) {
    throw new RangeError('Invalid nearby race progress.')
  }
  const bytes = new Uint8Array(PROGRESS_BYTES)
  const view = new DataView(bytes.buffer)
  bytes[0] = Packet.Progress
  bytes[1] = slot | (epoch << 2)
  view.setUint16(2, sequence, true)
  view.setFloat32(4, progress, true)
  return bytes
}

export function decodeProgress(bytes: Uint8Array): ProgressPacket | null {
  if (bytes.length !== PROGRESS_BYTES || bytes[0] !== Packet.Progress) return null
  const header = bytes[1]!
  if (header & 0x80) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const progress = view.getFloat32(4, true)
  if (!Number.isFinite(progress) || Math.abs(progress) > 10_000_000) return null
  return { slot: header & 3, round: (header >> 2) & WIRE_ROUND_MASK,
    sequence: view.getUint16(2, true), progress }
}

export interface PosePacket {
  readonly slot: number
  readonly round: number
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

export function encodePose(slot: number, sequence: number, recovery: number, vehicle: RaceVehicle, round = 0): Uint8Array {
  const epoch = roundBits(round)
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
  bytes[1] = slot | (pose.structureRunId === null ? 0 : 4) | (epoch << 3)
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
  return {
    slot: flags & 3,
    round: flags >> 3,
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
  let round: number | undefined
  bytes[0] = Packet.PoseBatch
  packets.forEach((packet, index) => {
    const pose = decodePose(packet)
    if (!pose || slots.has(pose.slot) || (round !== undefined && pose.round !== round)) {
      throw new RangeError('Invalid, mixed-round or duplicate nearby pose.')
    }
    round = pose.round
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
  let round: number | undefined
  for (let offset = 1; offset < bytes.length; offset += POSE_BYTES) {
    const packet = decodePose(bytes.subarray(offset, offset + POSE_BYTES))
    if (!packet || slots.has(packet.slot) || (round !== undefined && packet.round !== round)) return null
    round = packet.round
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
    if (!isNewerWireSequence(packet.sequence, this.sequence)) return false
    const advance = this.sequence === undefined ? 1 : (packet.sequence - this.sequence) & POSE_SEQUENCE_MASK
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
    if (!first || !last || now - this.arrival > REMOTE_POSE_EXPIRY_MS) return null
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
