import { captureGhost, ghostPoseAt, type GhostPose } from '@/application/race/ghostReplay'
import type { CarId } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'

export const POSE_BYTES = 19
export const POSE_PERIOD_MS = 50
const SCALE = 32
const TURN = 2 * Math.PI

export const enum Packet {
  Control = 0,
  Pose = 1,
  Track = 2,
}

export interface PosePacket {
  readonly slot: number
  readonly sequence: number
  readonly recovery: number
  readonly pose: Omit<GhostPose, 'car' | 't'>
}

export function encodePose(slot: number, sequence: number, recovery: number, vehicle: RaceVehicle): Uint8Array {
  const bytes = new Uint8Array(POSE_BYTES)
  const view = new DataView(bytes.buffer)
  const pose = captureGhost(vehicle, 0)
  bytes[0] = Packet.Pose
  bytes[1] = slot | (pose.structureRunId === null ? 0 : 4)
  bytes[2] = recovery
  view.setUint16(3, sequence, true)
  view.setInt32(5, Math.round(pose.x * SCALE), true)
  view.setInt32(9, Math.round(pose.y * SCALE), true)
  view.setInt32(13, Math.round(pose.z * SCALE), true)
  view.setUint16(17, Math.round(pose.angle / TURN * 65536), true)
  return bytes
}

export function decodePose(bytes: Uint8Array): PosePacket | null {
  if (bytes.length !== POSE_BYTES || bytes[0] !== Packet.Pose || bytes[1]! > 7) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    slot: bytes[1]! & 3,
    sequence: view.getUint16(3, true),
    recovery: bytes[2]!,
    pose: {
      x: view.getInt32(5, true) / SCALE,
      y: view.getInt32(9, true) / SCALE,
      z: view.getInt32(13, true) / SCALE,
      angle: view.getUint16(17, true) * TURN / 65536,
      structureRunId: bytes[1]! & 4 ? 'elevated' : null,
    },
  }
}

export class RemoteGhost {
  private frames: GhostPose[] = []
  private sequence: number | undefined
  private recovery: number | undefined
  private arrival = 0

  constructor(readonly car: CarId) {}

  receive(packet: PosePacket, now: number): boolean {
    const advance = this.sequence === undefined ? 1 : (packet.sequence - this.sequence) & 0xffff
    if (advance === 0 || advance >= 0x8000) return false
    const last = this.frames.at(-1)
    // Follow the sender's cadence while allowing slow clock drift. Rebase after stalls.
    if (!last || now - this.arrival > 500) this.frames = []
    const time = this.frames.length && last
      ? Math.max(now - 75, Math.min(now + 75, last.t + advance * POSE_PERIOD_MS))
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
    if (!last || now - this.arrival > 750) return null
    const target = Math.min(last.t, Math.max(this.frames[0]!.t, now - 100))
    return ghostPoseAt({ car: this.car, frames: this.frames, time: last.t }, target)
  }
}
