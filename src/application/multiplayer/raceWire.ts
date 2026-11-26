import { captureGhost, ghostPoseAt, type GhostPose } from '@/application/race/ghostReplay'
import type { CarId } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'

export const POSE_BYTES = 19
export const TIMED_POSE_BYTES = POSE_BYTES + 4
const MIN_SAMPLE_TIME_MS = -5000
const MAX_SAMPLE_TIME_MS = 86_400_000
export const PROGRESS_BYTES = 8
export const PROGRESS_PERIOD_MS = 150
export const POSE_SEQUENCE_MASK = 0xffff
export const POSE_RECOVERY_MASK = 0xff
/** Four header bits isolate in-flight packets across rematches for up to
 * 16 round epochs while reserving three bits for eight player slots.
 * Old clients understand round zero; later rounds require this protocol version.
 */
export const WIRE_ROUND_MASK = 15
export const WIRE_PLAYER_COUNT = 8

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
  if (!Number.isInteger(slot) || slot < 0 || slot >= WIRE_PLAYER_COUNT ||
      !Number.isInteger(sequence) || sequence < 0 || sequence > POSE_SEQUENCE_MASK ||
      !Number.isFinite(progress) || Math.abs(progress) > 10_000_000) {
    throw new RangeError('Invalid nearby race progress.')
  }
  const bytes = new Uint8Array(PROGRESS_BYTES)
  const view = new DataView(bytes.buffer)
  bytes[0] = Packet.Progress
  bytes[1] = slot | (epoch << 3)
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
  return { slot: header & 7, round: (header >> 3) & WIRE_ROUND_MASK,
    sequence: view.getUint16(2, true), progress }
}

export interface PosePacket {
  readonly slot: number
  readonly round: number
  readonly sequence: number
  readonly recovery: number
  readonly sampleTimeMs?: number
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

export function encodePose(slot: number, sequence: number, recovery: number, vehicle: RaceVehicle, round = 0, sampleTimeMs?: number): Uint8Array {
  const epoch = roundBits(round)
  const pose = captureGhost(vehicle, 0)
  // DataView silently converts NaN to zero and wraps integer overflow.
  // Validate once, before allocating the high-frequency network packet.
  if (!Number.isInteger(slot) || slot < 0 || slot >= WIRE_PLAYER_COUNT ||
      !Number.isInteger(sequence) || sequence < 0 || sequence > POSE_SEQUENCE_MASK ||
      !Number.isInteger(recovery) || recovery < 0 || recovery > POSE_RECOVERY_MASK ||
      !Number.isFinite(pose.angle)) {
    throw new RangeError('Invalid nearby pose values.')
  }
  const x = poseCoordinate(pose.x)
  const y = poseCoordinate(pose.y)
  const z = poseCoordinate(pose.z)
  if (sampleTimeMs !== undefined && (!Number.isInteger(sampleTimeMs) ||
      sampleTimeMs < MIN_SAMPLE_TIME_MS || sampleTimeMs > MAX_SAMPLE_TIME_MS)) {
    throw new RangeError('Invalid nearby pose sample time.')
  }
  const bytes = new Uint8Array(sampleTimeMs === undefined ? POSE_BYTES : TIMED_POSE_BYTES)
  const view = new DataView(bytes.buffer)
  bytes[0] = Packet.Pose
  bytes[1] = slot | (pose.structureRunId === null ? 0 : 8) | (epoch << 4)
  bytes[2] = recovery
  view.setUint16(3, sequence, true)
  view.setInt32(5, x, true)
  view.setInt32(9, y, true)
  view.setInt32(13, z, true)
  view.setUint16(17, Math.round(pose.angle / TURN * 65536), true)
  if (sampleTimeMs !== undefined) view.setInt32(POSE_BYTES, sampleTimeMs, true)
  return bytes
}

export function decodePose(bytes: Uint8Array): PosePacket | null {
  if ((bytes.length !== POSE_BYTES && bytes.length !== TIMED_POSE_BYTES) || bytes[0] !== Packet.Pose) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = view.getUint8(1)
  const sampleTimeMs = bytes.length === TIMED_POSE_BYTES ? view.getInt32(POSE_BYTES, true) : undefined
  if (sampleTimeMs !== undefined && (sampleTimeMs < MIN_SAMPLE_TIME_MS || sampleTimeMs > MAX_SAMPLE_TIME_MS)) return null
  return {
    slot: flags & 7,
    round: flags >> 4,
    sequence: view.getUint16(3, true),
    recovery: view.getUint8(2),
    ...(sampleTimeMs !== undefined ? { sampleTimeMs } : {}),
    pose: {
      x: view.getInt32(5, true) / SCALE,
      y: view.getInt32(9, true) / SCALE,
      z: view.getInt32(13, true) / SCALE,
      angle: view.getUint16(17, true) * TURN / 65536,
      structureRunId: flags & 8 ? 'elevated' : null,
    },
  }
}

/** One host broadcast containing the latest unique slot positions. */
export function encodePoseBatch(packets: readonly Uint8Array[]): Uint8Array {
  if (!packets.length || packets.length > WIRE_PLAYER_COUNT) throw new RangeError('Invalid nearby pose batch size.')
  const size = packets[0]?.length ?? 0
  if (size !== POSE_BYTES && size !== TIMED_POSE_BYTES) throw new RangeError('Invalid nearby pose size.')
  const bytes = new Uint8Array(1 + packets.length * size)
  const slots = new Set<number>()
  let round: number | undefined
  bytes[0] = Packet.PoseBatch
  packets.forEach((packet, index) => {
    const pose = decodePose(packet)
    if (!pose || packet.length !== size || slots.has(pose.slot) || (round !== undefined && pose.round !== round)) {
      throw new RangeError('Invalid, mixed-round or duplicate nearby pose.')
    }
    round = pose.round
    slots.add(pose.slot)
    bytes.set(packet, 1 + index * size)
  })
  return bytes
}

export function decodePoseBatch(bytes: Uint8Array): PosePacket[] | null {
  const length = bytes.length - 1
  const size = length % TIMED_POSE_BYTES === 0 ? TIMED_POSE_BYTES : POSE_BYTES
  if (bytes[0] !== Packet.PoseBatch || length < size ||
      length > WIRE_PLAYER_COUNT * size || length % size !== 0) return null
  const packets: PosePacket[] = []
  const slots = new Set<number>()
  let round: number | undefined
  for (let offset = 1; offset < bytes.length; offset += size) {
    const packet = decodePose(bytes.subarray(offset, offset + size))
    if (!packet || slots.has(packet.slot) || (round !== undefined && packet.round !== round)) return null
    round = packet.round
    slots.add(packet.slot)
    packets.push(packet)
  }
  return packets
}

const REMOTE_INITIAL_DELAY_MS = 100
const REMOTE_MIN_DELAY_MS = 50
const REMOTE_MAX_DELAY_MS = 150
const REMOTE_DELAY_WARMUP_SAMPLES = 4
const REMOTE_HISTORY_LIMIT = 24
const REMOTE_CLOCK_RESPONSE_MS = 250
const REMOTE_CLOCK_MIN_RATE = 0.8
const REMOTE_CLOCK_MAX_RATE = 1.2
const REMOTE_CORRECTION_MS = 100
const REMOTE_PREDICTION_MS = 120
const REMOTE_PREDICTION_DISTANCE = 75

function wrappedTurn(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export class RemoteGhost {
  private frames: GhostPose[] = []
  private sequence: number | undefined
  private recovery: number | undefined
  private arrival = 0
  private estimatedPeriodMs = POSE_PERIOD_MS
  private arrivalPeriodMs = POSE_PERIOD_MS
  private arrivalJitterMs = 0
  private arrivalSamples = 0
  private interpolationDelayMs = REMOTE_INITIAL_DELAY_MS
  private lastPresentationTime = Number.NEGATIVE_INFINITY
  private lastPresentationAt = Number.NEGATIVE_INFINITY
  private correction: { x: number; y: number; angle: number; at: number } | null = null
  private readonly metrics = {
    samples: 0, delaySumMs: 0, minDelayMs: Infinity, maxDelayMs: -Infinity,
    clockHeldMs: 0, predictionMs: 0, predictionHeldMs: 0, corrections: 0,
    maxCorrectionDistance: 0, timedSamples: 0, transitSumMs: 0, maxTransitMs: -Infinity,
  }

  constructor(readonly car: CarId) {}

  receive(packet: PosePacket, now: number, sampleAt?: number): boolean {
    if (!isNewerWireSequence(packet.sequence, this.sequence)) return false
    const advance = this.sequence === undefined ? 1 : (packet.sequence - this.sequence) & POSE_SEQUENCE_MASK
    const last = this.frames.at(-1)
    // Timed samples are on the receiver's monotonic clock via shared GO.
    // Reject implausibly old/future or regressing samples before changing state.
    if (sampleAt !== undefined && (!Number.isFinite(sampleAt) || sampleAt < 0 ||
        sampleAt > now + 100 || sampleAt < now - REMOTE_POSE_EXPIRY_MS ||
        (last && sampleAt <= last.t))) return false
    const continuous = !!last && now - this.arrival <= 500 &&
      packet.recovery === this.recovery && packet.pose.structureRunId === last.structureRunId
    // Capture the old predicted position at the same playback timestamp before
    // replacing it with newly received data. No extra sampling on normal packets.
    const oldPrediction = continuous && last && this.lastPresentationTime > last.t
      ? this.correctedPose(this.sampleAt(this.lastPresentationTime), this.lastPresentationAt)
      : null
    if (!continuous) this.correction = null
    // Accept 30-60 Hz and packet losses without assuming a fixed send cadence.
    if (!last || now - this.arrival > 500) {
      this.frames = []
      this.estimatedPeriodMs = POSE_PERIOD_MS
      this.arrivalPeriodMs = POSE_PERIOD_MS
      this.arrivalJitterMs = 0
      this.arrivalSamples = 0
      this.interpolationDelayMs = REMOTE_INITIAL_DELAY_MS
      this.lastPresentationTime = Number.NEGATIVE_INFINITY
      this.lastPresentationAt = Number.NEGATIVE_INFINITY
    } else {
      const arrivalGap = Math.max(0, now - this.arrival)
      // Use actual arrival spacing, not spacing divided by sequence advance:
      // missing samples consume interpolation buffer just like network jitter.
      this.arrivalJitterMs = this.arrivalJitterMs * 0.8 +
        Math.abs(arrivalGap - this.arrivalPeriodMs) * 0.2
      this.arrivalPeriodMs = this.arrivalPeriodMs * 0.8 + arrivalGap * 0.2
      if (++this.arrivalSamples >= REMOTE_DELAY_WARMUP_SAMPLES) {
        // With actual source timestamps we can predict toward shared present,
        // rather than buffering the full arrival cadence on top of transit.
        const desired = sampleAt === undefined
          ? Math.max(REMOTE_MIN_DELAY_MS, Math.min(REMOTE_MAX_DELAY_MS,
            this.arrivalPeriodMs * 1.5 + this.arrivalJitterMs * 2))
          : Math.max(25, Math.min(100, 25 + this.arrivalJitterMs * 2))
        // This is a target delay, not the actual playback clock.
        this.interpolationDelayMs = Math.max(desired, this.interpolationDelayMs - 2)
      }
      const observedPeriod = arrivalGap / advance
      if (observedPeriod >= POSE_FAST_PERIOD_MS * 0.5 && observedPeriod <= 200) {
        this.estimatedPeriodMs = Math.max(POSE_FAST_PERIOD_MS, Math.min(100,
          this.estimatedPeriodMs * 0.8 + observedPeriod * 0.2))
      }
    }
    const time = sampleAt ?? (this.frames.length && last
      ? Math.max(now - 75, Math.min(now + 75, last.t + advance * this.estimatedPeriodMs))
      : now)
    this.frames.push({
      ...packet.pose, car: this.car, t: last && this.frames.length ? Math.max(last.t + 1, time) : time,
      cut: packet.recovery !== this.recovery,
    })
    if (this.frames.length > REMOTE_HISTORY_LIMIT) this.frames.shift()
    if (oldPrediction) {
      const fresh = this.sampleAt(this.lastPresentationTime)
      if (fresh && fresh.structureRunId === oldPrediction.structureRunId) {
        const dx = oldPrediction.x - fresh.x
        const dy = oldPrediction.y - fresh.y
        const distance = Math.hypot(dx, dy)
        // Blend small prediction errors, never disguise a teleport or bridge cut.
        if (distance <= REMOTE_PREDICTION_DISTANCE) {
          const angle = wrappedTurn(oldPrediction.angle - fresh.angle)
          this.correction = { x: dx, y: dy, angle, at: this.lastPresentationAt }
          this.metrics.corrections++
          this.metrics.maxCorrectionDistance = Math.max(this.metrics.maxCorrectionDistance, distance)
        } else this.correction = null
      } else this.correction = null
    }
    if (sampleAt !== undefined) {
      this.metrics.timedSamples++
      this.metrics.transitSumMs += now - sampleAt
      this.metrics.maxTransitMs = Math.max(this.metrics.maxTransitMs, now - sampleAt)
    }
    this.sequence = packet.sequence
    this.recovery = packet.recovery
    this.arrival = now
    return true
  }

  /** The trace samples this same clock without moving it or changing render metrics. */
  peekPose(now: number): GhostPose | null {
    const target = this.presentationTarget(now)
    return target === null ? null : this.correctedPose(this.sampleAt(target), now)
  }

  pose(now: number): GhostPose | null {
    const target = this.presentationTarget(now)
    if (target === null) return null
    const previousTime = this.lastPresentationTime
    const dt = now - this.lastPresentationAt
    // Before the first buffered sample, wait for history instead of predicting
    // from a single stationary packet. This is startup, not a playback stall.
    if (Number.isFinite(previousTime) || now - this.interpolationDelayMs >= this.frames[0]!.t) {
      this.lastPresentationTime = target
      this.lastPresentationAt = Math.max(now, this.lastPresentationAt)
      if (Number.isFinite(dt) && dt > 0 && dt <= 500) {
        const delay = now - target
        this.metrics.samples++
        this.metrics.delaySumMs += delay
        this.metrics.minDelayMs = Math.min(this.metrics.minDelayMs, delay)
        this.metrics.maxDelayMs = Math.max(this.metrics.maxDelayMs, delay)
        if (target <= previousTime) this.metrics.clockHeldMs += dt
        const last = this.frames.at(-1)!
        if (target > last.t) {
          this.metrics.predictionMs += dt
          const previous = this.frames.at(-2)
          const gap = previous ? last.t - previous.t : 0
          const distance = previous ? Math.hypot(last.x - previous.x, last.y - previous.y) : 0
          if (!previous || last.cut || previous.structureRunId !== last.structureRunId || gap < 12 ||
              target - last.t >= REMOTE_PREDICTION_MS ||
              distance * (target - last.t) / gap >= REMOTE_PREDICTION_DISTANCE) {
            this.metrics.predictionHeldMs += dt
          }
        }
      }
    }
    return this.correctedPose(this.sampleAt(target), now)
  }

  presentationDiagnostics() {
    const m = this.metrics
    return {
      samples: m.samples, targetDelayMs: this.interpolationDelayMs,
      meanDelayMs: m.samples ? m.delaySumMs / m.samples : null,
      minDelayMs: m.samples ? m.minDelayMs : null, maxDelayMs: m.samples ? m.maxDelayMs : null,
      clockHeldMs: m.clockHeldMs, predictionMs: m.predictionMs,
      predictionHeldMs: m.predictionHeldMs, corrections: m.corrections,
      maxCorrectionDistance: m.maxCorrectionDistance,
      timedSamples: m.timedSamples,
      meanSampleAgeMs: m.timedSamples ? m.transitSumMs / m.timedSamples : null,
      maxSampleAgeMs: m.timedSamples ? m.maxTransitMs : null,
    }
  }

  private presentationTarget(now: number): number | null {
    const first = this.frames[0]
    if (!first || now - this.arrival > REMOTE_POSE_EXPIRY_MS) return null
    const desired = Math.max(first.t, now - this.interpolationDelayMs)
    if (!Number.isFinite(this.lastPresentationTime)) return desired
    const dt = Math.max(0, now - this.lastPresentationAt)
    if (!dt) return this.lastPresentationTime
    // Resume after a suspended render loop without spending seconds catching up.
    if (dt > 500) return Math.max(this.lastPresentationTime, desired)
    const predicted = this.lastPresentationTime + dt
    const error = desired - predicted
    const correction = Math.max((REMOTE_CLOCK_MIN_RATE - 1) * dt,
      Math.min((REMOTE_CLOCK_MAX_RATE - 1) * dt, error * Math.min(1, dt / REMOTE_CLOCK_RESPONSE_MS)))
    return Math.max(first.t, predicted + correction)
  }

  private correctedPose(pose: GhostPose | null, now: number): GhostPose | null {
    if (!pose || !this.correction) return pose
    const weight = Math.max(0, Math.min(1, 1 - (now - this.correction.at) / REMOTE_CORRECTION_MS))
    if (!weight) return pose
    return { ...pose, x: pose.x + this.correction.x * weight,
      y: pose.y + this.correction.y * weight, angle: pose.angle + this.correction.angle * weight }
  }

  private sampleAt(target: number): GhostPose | null {
    const last = this.frames.at(-1)
    if (!last) return null
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
    const fraction = Math.min(REMOTE_PREDICTION_MS, target - last.t) / deltaTime
    const bounded = Math.min(fraction, REMOTE_PREDICTION_DISTANCE / Math.max(0.001, distance))
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
