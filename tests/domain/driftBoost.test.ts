import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { stepRaceTick } from '@/domain/race/raceEngine'
import { recoverRacePlayer } from '@/domain/race/raceRecovery'
import {
	DRIFT_BOOST_V1_RULES,
	advanceDriftBoost,
	initialDriftBoostSnapshot,
	type DriftBoostSnapshot,
} from '@/domain/race/driftBoost'

const neutral = {
	speed: 200,
	angle: 0,
	vx: 200,
	vy: 0,
	onRoad: true,
	grounded: true,
	collision: false,
	recovering: false,
	braking: false,
}

describe('drift boost domain', () => {
	it('starts empty and does not charge for straight driving', () => {
		expect(initialDriftBoostSnapshot()).toEqual({
			charge: 0,
			phase: 'charging',
			remainingTicks: 0,
			continuousDriftSeconds: 0,
		})
		expect(
			advanceDriftBoost(undefined, DRIFT_BOOST_V1_RULES, neutral, 1 / 60)
				.snapshot.charge,
		).toBe(0)
	})

	it('charges qualifying drift by speed and counts braking drifts', () => {
		const sample = { ...neutral, vx: 160, vy: 70, braking: true }
		const result = advanceDriftBoost(
			undefined,
			DRIFT_BOOST_V1_RULES,
			sample,
			0.21,
		)
		expect(result.snapshot.charge).toBeCloseTo(
			(0.01 * Math.hypot(160, 70)) / 200,
		)
		expect(result.snapshot.phase).toBe('charging')
	})

	it('fills after one second of qualifying drift at the reference speed', () => {
		const sample = { ...neutral, vx: 160, vy: 120 }
		let state = initialDriftBoostSnapshot()
		for (let tick = 0; tick < 12; tick++) {
			state = advanceDriftBoost(state, DRIFT_BOOST_V1_RULES, sample, 1 / 60).snapshot
		}
		expect(state.charge).toBeCloseTo(0)
		for (let tick = 0; tick < 59; tick++) {
			state = advanceDriftBoost(state, DRIFT_BOOST_V1_RULES, sample, 1 / 60).snapshot
		}
		expect(state.charge).toBeCloseTo(59 / 60)
		expect(state.phase).toBe('charging')
		// Allow a tick for floating-point rounding at the full boundary.
		for (let tick = 0; tick < 2; tick++) {
			state = advanceDriftBoost(state, DRIFT_BOOST_V1_RULES, sample, 1 / 60).snapshot
		}
		expect(state.charge).toBe(1)
		expect(state.phase).toBe('ready')
	})

	it.each([
		['off road', { onRoad: false }],
		['airborne', { grounded: false }],
		['colliding', { collision: true }],
		['recovering', { recovering: true }],
		['reverse', { vx: -200, vy: 0 }],
		['stationary', { speed: 0, vx: 0, vy: 0 }],
		['invalid velocity', { vx: Number.NaN }],
	])('does not charge when %s', (_label, patch) => {
		const result = advanceDriftBoost(
			undefined,
			DRIFT_BOOST_V1_RULES,
			{ ...neutral, ...patch },
			1,
		)
		expect(result.snapshot.charge).toBe(0)
	})

	it('requires continuous qualifying drift and preserves charge through recovery', () => {
		let state: DriftBoostSnapshot | undefined
		state = advanceDriftBoost(
			state,
			DRIFT_BOOST_V1_RULES,
			{ ...neutral, vx: 160, vy: 70 },
			0.1,
		).snapshot
		state = advanceDriftBoost(
			state,
			DRIFT_BOOST_V1_RULES,
			neutral,
			0.1,
		).snapshot
		expect(state.charge).toBe(0)
		state = { ...state, charge: 0.4 }
		const recovered = advanceDriftBoost(
			state,
			DRIFT_BOOST_V1_RULES,
			{ ...neutral, recovering: true },
			1,
		)
		expect(recovered.snapshot.charge).toBe(0.4)
		expect(recovered.snapshot.phase).toBe('charging')
	})

	it('integrates the one-shot activation impulse into race physics', () => {
		const track = createStarterTrack(asTrackId('drift-boost'), 1)
		const race = createRace({
			path: buildRoadPath(track.points, track.terrain),
			playerCar: 'red',
			difficulty: 'normal',
			laps: 1,
			driftBoostRules: DRIFT_BOOST_V1_RULES,
		})
		const player = race.vehicles.find((vehicle) => vehicle.player)
		if (!player) throw new Error('Missing player fixture')
		const initialSpeed = 100
		const activated = stepRaceTick(
			{
				...race,
				phase: 'running',
				vehicles: race.vehicles.map((vehicle) =>
					vehicle.player
						? {
								...vehicle,
								vx: Math.cos(vehicle.angle) * initialSpeed,
								vy: Math.sin(vehicle.angle) * initialSpeed,
								speed: initialSpeed,
								driftBoost: { charge: 1, phase: 'ready', remainingTicks: 0 },
							}
						: vehicle,
				),
			},
			{
				tick: 1,
				controls: {
					[player.id]: {
						steering: 0,
						throttle: 0,
						braking: false,
						boostRequested: true,
					},
				},
			},
			{ next: () => 0.5 },
		)
		const updatedPlayer = activated.state.vehicles.find(
			(vehicle) => vehicle.player,
		)
		expect(updatedPlayer?.driftBoost?.phase).toBe('active')
		expect(updatedPlayer?.driftBoost?.charge).toBe(0)
		expect(updatedPlayer?.speed).toBeGreaterThan(initialSpeed * 1.8)
	})

	it('cancels active propulsion and preserves charge through manual recovery', () => {
		const track = createStarterTrack(asTrackId('drift-boost-recovery'), 1)
		const race = createRace({
			path: buildRoadPath(track.points, track.terrain),
			playerCar: 'red',
			difficulty: 'normal',
			laps: 1,
			driftBoostRules: DRIFT_BOOST_V1_RULES,
		})
		const recovered = recoverRacePlayer({
			...race,
			phase: 'running',
			vehicles: race.vehicles.map((vehicle) =>
				vehicle.player
					? {
							...vehicle,
							driftBoost: { charge: 0.4, phase: 'active', remainingTicks: 20 },
						}
					: vehicle,
			),
		})
		const player = recovered.vehicles.find((vehicle) => vehicle.player)
		expect(player?.driftBoost?.charge).toBe(0.4)
		expect(player?.driftBoost?.phase).toBe('returning')
		expect(player?.driftBoost?.remainingTicks).toBe(24)
	})

	it('consumes full charge once on activation and returns to ready/charging lifecycle', () => {
		const full: DriftBoostSnapshot = {
			charge: 1,
			phase: 'ready',
			remainingTicks: 0,
		}
		const activated = advanceDriftBoost(
			full,
			DRIFT_BOOST_V1_RULES,
			neutral,
			1 / 60,
			true,
		)
		expect(activated.activated).toBe(true)
		expect(activated.snapshot).toEqual({
			charge: 0,
			phase: 'active',
			remainingTicks: 59,
			continuousDriftSeconds: 0,
		})
		const braked = advanceDriftBoost(
			activated.snapshot,
			DRIFT_BOOST_V1_RULES,
			{ ...neutral, braking: true },
			1 / 60,
		)
		expect(braked.snapshot.phase).toBe('returning')
		expect(braked.snapshot.charge).toBe(0)
	})
})
