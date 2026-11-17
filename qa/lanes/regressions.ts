import type { LaneIssue } from './monitor'
import type { LaneRun } from './simulation'

type RegressionRun = Pick<
	LaneRun,
	'car' | 'difficulty' | 'seed' | 'laps' | 'seconds' | 'startRatio' | 'mode' | 'reversed' | 'stoppedReason'
> & { readonly issues: readonly Pick<LaneIssue, 'code' | 'severity'>[] }

// Normal difficulty, Blue, seed 1, one lap, 60 seconds, default start line.
const recoveryLimits = new Map([
	['hairpin:solo:reverse', 2],
	['hairpin:traffic:forward', 2],
	['hairpin:traffic:reverse', 4],
	['bridge:solo:reverse', 1],
	['bridge:traffic:forward', 1],
	['bridge:traffic:reverse', 2],
])

export function laneRegressions(run: RegressionRun, scenarioId?: string): readonly string[] {
	const knownRun = scenarioId && run.difficulty === 'normal' && run.car === 'blue' &&
		run.seed === 1 && run.laps === 1 && run.seconds === 60 && run.startRatio === 0
	const direction = run.reversed ? 'reverse' : 'forward'
	const allowedRecoveries = knownRun ? recoveryLimits.get(`${scenarioId}:${run.mode}:${direction}`) ?? 0 : 0
	const errors = run.issues.filter((issue) => issue.severity === 'error')
	const recoveries = errors.filter((issue) => issue.code === 'recovery').length
	const failures = new Set<string>(
		errors.filter((issue) => issue.code !== 'recovery').map((issue) => issue.code),
	)
	if (run.stoppedReason !== 'finished') failures.add(run.stoppedReason)
	if (recoveries > allowedRecoveries) failures.add(`${recoveries} recoveries (allowed ${allowedRecoveries})`)
	return [...failures]
}
