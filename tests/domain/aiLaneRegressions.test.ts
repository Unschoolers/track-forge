import { describe, expect, it } from 'vitest'
import { laneRegressions } from '../../qa/lanes/regressions'
import { parseLaneOptions } from '../../qa/lanes/options'

const recovery = { code: 'recovery', severity: 'error' } as const
const hairpin = {
	car: 'blue', difficulty: 'normal', seed: 1, laps: 1, seconds: 60, startRatio: 0,
	mode: 'solo', reversed: true, stoppedReason: 'finished', issues: [recovery, recovery],
} as const

describe('AI lane regression gate', () => {
	it('allows existing or fewer recoveries for the exact fixture run', () => {
		expect(laneRegressions(hairpin, 'hairpin')).toEqual([])
		expect(laneRegressions({ ...hairpin, issues: [recovery] }, 'hairpin')).toEqual([])
		expect(laneRegressions({ ...hairpin, issues: [...hairpin.issues, recovery] }, 'hairpin'))
			.toEqual(['3 recoveries (allowed 2)'])
	})

	it('requires clean recoveries for other runs and imported tracks', () => {
		expect(laneRegressions({ ...hairpin, seed: 2 }, 'hairpin')).toEqual(['2 recoveries (allowed 0)'])
		expect(laneRegressions({ ...hairpin, reversed: false }, 'hairpin')).toEqual(['2 recoveries (allowed 0)'])
		expect(laneRegressions(hairpin)).toEqual(['2 recoveries (allowed 0)'])
	})

	it('fails on every other error or early stop while reporting warnings', () => {
		expect(laneRegressions({ ...hairpin, stoppedReason: 'timeout' }, 'hairpin')).toEqual(['timeout'])
		expect(laneRegressions({ ...hairpin, stoppedReason: 'invalid-state' }, 'hairpin'))
			.toEqual(['invalid-state'])
		expect(laneRegressions({ ...hairpin, issues: [{ code: 'path-jump', severity: 'error' }] }, 'hairpin'))
			.toEqual(['path-jump'])
		expect(laneRegressions({ ...hairpin, issues: [{ code: 'wrong-way', severity: 'warning' }] }, 'hairpin'))
			.toEqual([])
	})

	it('opts into the gate independently of strict diagnostics', () => {
		expect(parseLaneOptions(['--fail-on-regressions'])).toMatchObject({ failOnRegressions: true, strict: false })
	})
})
