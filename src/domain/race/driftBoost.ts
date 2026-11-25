export interface DriftBoostRules {
	readonly enabled: true
	readonly revision: 'drift-boost-v1.1'
	readonly referenceSpeed: 200
	readonly secondsToFull: 1
	readonly minimumSpeed: 90
	readonly minimumSlipAngleDegrees: 12
	readonly maximumSlipAngleDegrees: 45
	readonly minimumDriftSeconds: 0.2
	readonly boostDurationSeconds: 1
	readonly initialSpeedMultiplier: 2
	readonly speedCeilingMultiplier: 2
	readonly accelerationMultiplier: 2
	readonly returnSeconds: 0.4
}

export const DRIFT_BOOST_V1_RULES: DriftBoostRules = Object.freeze({
	enabled: true,
	revision: 'drift-boost-v1.1',
	referenceSpeed: 200,
	secondsToFull: 1,
	minimumSpeed: 90,
	minimumSlipAngleDegrees: 12,
	maximumSlipAngleDegrees: 45,
	minimumDriftSeconds: 0.2,
	boostDurationSeconds: 1,
	initialSpeedMultiplier: 2,
	speedCeilingMultiplier: 2,
	accelerationMultiplier: 2,
	returnSeconds: 0.4,
})

export type DriftBoostPhase = 'charging' | 'ready' | 'active' | 'returning'

export interface DriftBoostSnapshot {
	readonly charge: number
	readonly phase: DriftBoostPhase
	/** Remaining fixed simulation ticks while active or returning. */
	readonly remainingTicks: number
	/** Internal continuity timer, in seconds; UI consumers can ignore it. */
	readonly continuousDriftSeconds?: number
}

export interface DriftBoostSample {
	readonly angle: number
	readonly vx: number
	readonly vy: number
	readonly onRoad: boolean
	readonly grounded: boolean
	readonly collision: boolean
	readonly recovering: boolean
	readonly braking: boolean
}

export interface DriftBoostStep {
	readonly snapshot: DriftBoostSnapshot
	readonly activated: boolean
}

const FIXED_STEP_SECONDS = 1 / 60

export function initialDriftBoostSnapshot(): DriftBoostSnapshot {
	return {
		charge: 0,
		phase: 'charging',
		remainingTicks: 0,
		continuousDriftSeconds: 0,
	}
}

function clampedDt(dt: number): number {
	return Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.25)) : 0
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

function qualifies(sample: DriftBoostSample, rules: DriftBoostRules): boolean {
	if (
		!sample.onRoad ||
		!sample.grounded ||
		sample.collision ||
		sample.recovering
	)
		return false
	if (![sample.angle, sample.vx, sample.vy].every(Number.isFinite)) return false
	const headingX = Math.cos(sample.angle)
	const headingY = Math.sin(sample.angle)
	const longitudinalSpeed = sample.vx * headingX + sample.vy * headingY
	const lateralSpeed = -sample.vx * headingY + sample.vy * headingX
	if (longitudinalSpeed < rules.minimumSpeed) return false
	const slipDegrees =
		(Math.abs(Math.atan2(lateralSpeed, longitudinalSpeed)) * 180) / Math.PI
	return (
		slipDegrees >= rules.minimumSlipAngleDegrees &&
		slipDegrees <= rules.maximumSlipAngleDegrees
	)
}

export function advanceDriftBoost(
	previous: DriftBoostSnapshot | undefined,
	rules: DriftBoostRules | undefined,
	sample: DriftBoostSample,
	deltaSeconds: number,
	activationRequested = false,
): DriftBoostStep {
	const current = previous ?? initialDriftBoostSnapshot()
	if (!rules?.enabled)
		return { snapshot: initialDriftBoostSnapshot(), activated: false }
	const dt = clampedDt(deltaSeconds)
	if (current.phase === 'active') {
		if (sample.braking || sample.recovering) {
			return {
				snapshot: {
					...current,
					phase: 'returning',
					remainingTicks: Math.ceil(rules.returnSeconds / FIXED_STEP_SECONDS),
				},
				activated: false,
			}
		}
		const remainingTicks = Math.max(0, current.remainingTicks - 1)
		return {
			snapshot:
				remainingTicks > 0
					? { ...current, remainingTicks }
					: {
							...current,
							phase: 'returning',
							remainingTicks: Math.ceil(
								rules.returnSeconds / FIXED_STEP_SECONDS,
							),
						},
			activated: false,
		}
	}
	if (current.phase === 'returning') {
		if (current.remainingTicks <= 0) {
			return {
				snapshot: {
					...current,
					phase: current.charge >= 1 ? 'ready' : 'charging',
					remainingTicks: 0,
				},
				activated: false,
			}
		}
		return {
			snapshot: { ...current, remainingTicks: current.remainingTicks - 1 },
			activated: false,
		}
	}

	const canCharge = !sample.recovering && qualifies(sample, rules)
	const continuousDriftSeconds = canCharge
		? (current.continuousDriftSeconds ?? 0) + dt
		: 0
	const chargeSeconds = canCharge
		? Math.max(
				0,
				continuousDriftSeconds -
					Math.max(
						current.continuousDriftSeconds ?? 0,
						rules.minimumDriftSeconds,
					),
			)
		: 0
	const charge =
		canCharge && chargeSeconds > 0
			? clamp(
					current.charge +
						((chargeSeconds / rules.secondsToFull) *
							Math.hypot(sample.vx, sample.vy)) /
							rules.referenceSpeed,
					0,
					1,
				)
			: current.charge
	const phase = charge >= 1 ? 'ready' : 'charging'
	if (
		activationRequested &&
		phase === 'ready' &&
		!sample.braking &&
		!sample.recovering
	) {
		const activeTicks = Math.max(
			1,
			Math.ceil(rules.boostDurationSeconds / FIXED_STEP_SECONDS) - 1,
		)
		return {
			snapshot: {
				charge: 0,
				phase: 'active',
				remainingTicks: activeTicks,
				continuousDriftSeconds: 0,
			},
			activated: true,
		}
	}
	return {
		snapshot: { charge, phase, remainingTicks: 0, continuousDriftSeconds },
		activated: false,
	}
}
