import {
	CAR_IDS,
	DIFFICULTY_IDS,
	type CarId,
	type DifficultyId,
} from '@/domain/model'
import { SCENARIO_IDS } from './scenarios'

export interface LaneOptions {
	readonly seeds: readonly number[]
	readonly scenarios: readonly string[]
	readonly modes: readonly ('solo' | 'traffic')[]
	readonly difficulties: readonly DifficultyId[]
	readonly cars: readonly CarId[]
	readonly directions: readonly boolean[]
	readonly seconds: number
	readonly laps: number
	readonly out: string
	readonly trackFiles: readonly string[]
	readonly strict: boolean
	readonly help: boolean
}

export function parseLaneOptions(args: readonly string[]): LaneOptions {
	const values = new Map<string, string>()
	const trackFiles: string[] = []
	let strict = false
	let help = false
	const names = [
		'--seed',
		'--seeds',
		'--seconds',
		'--laps',
		'--out',
		'--track',
		'--scenario',
		'--mode',
		'--direction',
		'--difficulty',
		'--car',
	]
	for (let i = 0; i < args.length; i++) {
		const name = args[i] ?? ''
		if (name === '--strict') {
			strict = true
			continue
		}
		if (name === '--help' || name === '-h') {
			help = true
			continue
		}
		if (!names.includes(name)) throw new Error(`Unknown option: ${name}`)
		const value = args[++i]
		if (!value || value.startsWith('--'))
			throw new Error(`Missing value for ${name}`)
		if (name === '--track') trackFiles.push(value)
		else values.set(name, value)
	}
	const number = (
		name: string,
		fallback: number,
		min: number,
		max: number,
		integer = true,
	) => {
		const n = Number(values.get(name) ?? fallback)
		if (
			!Number.isFinite(n) ||
			n < min ||
			n > max ||
			(integer && !Number.isInteger(n))
		) {
			throw new Error(
				`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`,
			)
		}
		return n
	}
	const choice = (
		name: string,
		fallback: string,
		choices: readonly string[],
	) => {
		const value = values.get(name) ?? fallback
		if (!choices.includes(value))
			throw new Error(`Invalid ${name}: ${value}; use ${choices.join(', ')}`)
		return value
	}
	const count = number('--seeds', 3, 1, 100)
	const seed = number('--seed', 1, 0, 0xffff_ffff - count + 1)
	const scenario = choice('--scenario', 'starter', [...SCENARIO_IDS, 'all'])
	const mode = choice('--mode', 'traffic', ['solo', 'traffic', 'both'])
	const direction = choice('--direction', 'both', [
		'forward',
		'reverse',
		'both',
	])
	const difficulty = choice('--difficulty', 'normal', [
		...DIFFICULTY_IDS,
		'all',
	])
	const car = choice('--car', 'blue', [...CAR_IDS, 'all'])
	return {
		seeds: Array.from({ length: count }, (_, i) => seed + i),
		scenarios: scenario === 'all' ? SCENARIO_IDS : [scenario],
		modes: mode === 'both' ? ['solo', 'traffic'] : [mode as 'solo' | 'traffic'],
		directions:
			direction === 'both' ? [false, true] : [direction === 'reverse'],
		difficulties:
			difficulty === 'all' ? DIFFICULTY_IDS : [difficulty as DifficultyId],
		cars: car === 'all' ? CAR_IDS : [car as CarId],
		seconds: number('--seconds', 60, 1 / 60, 600, false),
		laps: number('--laps', 1, 1, 10),
		out: values.get('--out') ?? 'qa/results/lanes',
		trackFiles,
		strict,
		help,
	}
}
