import type { RoadPath } from '@/domain/track/pathBuilder'
import { clamp } from '@/domain/geometry/math'
import { turnAmountAt } from '@/domain/race/trackContext'

export type CornerPhase = 'approach' | 'turn' | 'exit' | 'straight'

export interface CornerTactics {
  readonly phase: CornerPhase
  readonly bend: number
  /** Turn sign along the selected travel direction, not the authored direction. */
  readonly turnSign: number
  /** Next bend reverses the current rotation before the chassis has settled. */
  readonly reversal: boolean
  /** Small early turn-in correction, never a replacement for lane following. */
  readonly headingLead: number
  readonly pursuitScale: number
  readonly drifting: boolean
  readonly sideslipGain: number
  readonly exitThrottle: number
  /** How much exit throttle the road can support while sliding sideways. */
  readonly exitTraction: number
}

/**
 * Read the local turn and the next arc before making control decisions.
 * Drift is *observed* from the real velocity vector: steering and throttle
 * manage an existing slide, never inject lateral velocity or bypass tire grip.
 * The same plan works when racing the road backwards or across a lap wrap.
 */
export function planCornerTactics(
  path: RoadPath,
  index: number,
  reversed: boolean,
  speed: number,
  slipAngle: number,
  roadOffset: number,
  roadRadius: number,
  lateralVelocity = 0,
): CornerTactics {
  const direction = reversed ? -1 : 1
  const past = turnAmountAt(path, index - direction * 12, 6) * direction
  const near = turnAmountAt(path, index, 6) * direction
  const next = turnAmountAt(path, index + direction * 12, 6) * direction
  const far = turnAmountAt(path, index + direction * 24, 6) * direction
  const bend = Math.max(Math.abs(near), Math.abs(next), Math.abs(far))
  const peakNext = Math.abs(next) >= Math.abs(far) ? next : far
  const approaching = Math.abs(peakNext) > Math.abs(near) * 1.3 && Math.abs(peakNext) > 0.03
  // A sharp apex can fall away in the very next sample; that's still the
  // turning phase until curvature is *declining* relative to the approach.
  const atApex = Math.abs(near) > 0.029 &&
    Math.abs(near) >= Math.abs(past) * 0.85 &&
    Math.abs(near) >= Math.abs(peakNext) * 0.85
  // On very sharp corners all rotation can be concentrated at a single
  // path sample. The previous turn still matters after the instantaneous
  // apex: this is the exit phase, not another straight to attack at full gas.
  const exiting = !atApex && (
    (Math.abs(near) > 0.025 && Math.abs(peakNext) < Math.abs(near) * 0.62) ||
    (Math.abs(past) > 0.055 && Math.abs(near) < Math.abs(past) * 0.5 &&
      Math.abs(peakNext) < Math.abs(past) * 0.5)
  )
  const phase: CornerPhase = atApex ? 'turn'
    : approaching ? 'approach'
    : exiting ? 'exit'
    : Math.abs(near) > 0.029 ? 'turn' : 'straight'
  const reversal = near * peakNext < 0 &&
    Math.abs(near) > 0.025 && Math.abs(peakNext) > 0.08
  const sign = Math.sign(reversal || approaching ? peakNext : exiting ? past : near)
  const edge = clamp((Math.abs(roadOffset) - roadRadius * 0.55) / (roadRadius * 0.25), 0, 1)
  // A small feed-forward yaw starts the rotation before the apex. Back out
  // near the edge: arriving too wide calls for recovering the road instead.
  // Chicanes require steering into the *next* direction while the current
  // corner is still unwinding. A simple pursuit chord reacts too late for
  // heavier chassis, especially at a quick right-to-left transition.
  const approachLead = phase === 'approach'
    ? sign * Math.min(0.13, bend * 0.23)
    : 0
  const reversalLead = reversal
    ? Math.sign(peakNext) * Math.min(0.15, Math.abs(peakNext) * 0.45)
    : 0
  const headingLead = clamp(approachLead + reversalLead, -0.22, 0.22) * (1 - edge)
  // Preserve a substantial pursuit horizon at speed; choking the target to
  // a handful of samples makes heavy cars oscillate rather than rotate.
  const pursuitScale = phase === 'turn' && bend > 0.17 ? 0.92
    : phase === 'approach' && bend > 0.15 ? 0.96 : 1
  const drifting = Math.abs(slipAngle) > 0.075 &&
    speed > 65 && (bend > 0.045 ||
      (exiting && Math.abs(past) > 0.055)) &&
    Math.abs(roadOffset) < roadRadius * 0.75
  // Controlled countersteering limits spin without suppressing lateral slip.
  const sideslipGain = drifting ? 0.84 : 0.65
  // When the road is opening, feed in power progressively. The friction
  // circle and chassis physics still decide whether the tires can take it.
  const exitThrottle = phase === 'exit' && drifting
    ? clamp(0.28 + (0.19 - Math.abs(peakNext)) * 1.5, 0.28, 0.52)
    : 0
  // Power on exit only once the *velocity* is taking the car back toward
  // the pavement. Looking at chassis heading alone misses a genuine slide.
  // This leaves friction-circle tire physics untouched and avoids braking
  // while the wheels are needed for lateral recovery.
  const predictedOffset = roadOffset + lateralVelocity * 0.28
  const exitTraction = (phase === 'turn' || phase === 'exit' || reversal) && speed > 50
    ? clamp((roadRadius * 0.85 - Math.abs(predictedOffset)) /
      (roadRadius * 0.45), 0, 1)
    : 1
  return { phase, bend, turnSign: sign, reversal, headingLead, pursuitScale, drifting,
    sideslipGain, exitThrottle, exitTraction }
}
