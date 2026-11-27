import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const script = join(root, 'qa/perf/editor-chrome-profile.mjs')

test('profiles cached editor chrome and diagnostics for unchanged and changing snapshots', () => {
	const directory = mkdtempSync(join(tmpdir(), 'editor-chrome-profile-'))
	try {
		const input = join(directory, 'fixture.json')
		writeFileSync(
			input,
			JSON.stringify({
				track: {
					id: 'editor-chrome-fixture',
					name: 'Editor chrome fixture',
					version: 8,
					routeKind: 'circuit',
					points: [
						{ x: 0, y: 0, surface: 'street' },
						{ x: 100, y: 0, surface: 'street' },
						{ x: 100, y: 100, surface: 'street' },
					],
					trees: [],
					terrain: { cellSize: 64, cells: [] },
					start: { ratio: 0, reversed: false },
					scenery: [],
					environmentId: 'grass',
				},
			}),
		)
		const result = spawnSync(
			process.execPath,
			[script, input, '--iterations', '3', '--warmup', '1'],
			{
				cwd: root,
				encoding: 'utf8',
			},
		)
		assert.equal(result.status, 0, result.stderr)
		const report = JSON.parse(result.stdout)
		assert.equal(report.track.name, 'Editor chrome fixture')
		assert.equal(report.measuredIterations, 3)
		assert.equal(report.warmupIterations, 1)
		assert.equal(report.diagnosticsMemoEnabled, true)
		for (const scenario of ['unchangedSnapshot', 'changingSnapshot']) {
			assert.equal(report.scenarios[scenario].analyzeTrack.count, 3)
			assert.equal(
				report.scenarios[scenario].createEditorChromeAndAttach.count,
				3,
			)
			for (const stage of ['analyzeTrack', 'createEditorChromeAndAttach']) {
				for (const quantile of ['p50', 'p95', 'p99']) {
					assert.equal(
						typeof report.scenarios[scenario][stage][quantile],
						'number',
					)
					assert.ok(report.scenarios[scenario][stage][quantile] >= 0)
				}
			}
			assert.equal(typeof report.scenarios[scenario].diagnosticCount, 'number')
		}
		assert.match(
			report.notes.join(' '),
			/does not perform browser style\/layout/,
		)
		const uncached = spawnSync(
			process.execPath,
			[script, input, '--iterations', '2', '--warmup', '0', '--no-cache'],
			{ cwd: root, encoding: 'utf8' },
		)
		assert.equal(uncached.status, 0, uncached.stderr)
		assert.equal(JSON.parse(uncached.stdout).diagnosticsMemoEnabled, false)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('rejects unknown profiler options', () => {
	const result = spawnSync(
		process.execPath,
		[script, 'unused.trackforge.json', '--unknown'],
		{ cwd: root, encoding: 'utf8' },
	)
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /Unknown option or unexpected argument/)
})

test('fails loudly when the input is not a valid track', () => {
	const directory = mkdtempSync(
		join(tmpdir(), 'editor-chrome-profile-invalid-'),
	)
	try {
		const input = join(directory, 'invalid.json')
		writeFileSync(input, JSON.stringify({ track: { id: 'invalid' } }))
		const result = spawnSync(process.execPath, [script, input], {
			cwd: root,
			encoding: 'utf8',
		})
		assert.notEqual(result.status, 0)
		assert.match(result.stderr, /did not decode as a valid Track Forge track/)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
