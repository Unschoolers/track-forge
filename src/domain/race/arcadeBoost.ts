/** Deterministic automatic drift boost with no new touch control. */
export interface ArcadeBoostState {
  readonly charge: number
  readonly remaining: number
}

export interface ArcadeBoostSample {
  readonly speed: number
  readonly slip: number
  readonly steering: number
  readonly grounded: boolean
}

export interface ArcadeBoostTick extends ArcadeBoostState {
  readonly activated: boolean
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * A sustained slide earns charge; straightening the wheel releases it.
 * The short speed burst is applied by the race engine on subsequent steps.
 */
export function advanceArcadeBoost(
  state: ArcadeBoostState,
  sample: ArcadeBoostSample,
  deltaSeconds: number,
  enabled = true,
): ArcadeBoostTick {
  if (!enabled) return { charge: 0, remaining: 0, activated: false }
  const dt = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05)
  const remaining = Math.max(0, state.remaining - dt)
  const drifting =
    sample.grounded &&
    sample.speed > 100 &&
    sample.slip > 17 &&
    Math.abs(sample.steering) > 0.22
  const charge = clamp(
    state.charge + (remaining <= 0 && drifting ? dt * 0.8 : 0),
    0,
    1,
  )
  if (remaining <= 0 && charge >= 1 && Math.abs(sample.steering) < 0.18) {
    return { charge: 0, remaining: 1.3, activated: true }
  }
  return { charge, remaining, activated: false }
}
