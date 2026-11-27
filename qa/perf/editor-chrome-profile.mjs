// Profile editor DOM construction and diagnostics against a saved track.
// This measures Node/jsdom JavaScript work only; it does not measure browser
// layout, paint, Phaser rendering, GPU work, or real touch/frame performance.
// Run: node qa/perf/editor-chrome-profile.mjs path/to/track.trackforge.json
// Optional bounds: --iterations 100 --warmup 20 (iterations <= 2000).
// Pass --no-cache to compare against the uncached diagnostics path.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

function usage() {
	console.error(
		'Usage: node qa/perf/editor-chrome-profile.mjs <track-json-path> [--iterations N] [--warmup N] [--no-cache]',
	)
}

function integerOption(args, name, fallback, minimum, maximum) {
	const index = args.indexOf(name)
	if (index < 0) return fallback
	const value = Number(args[index + 1])
	if (!Number.isInteger(value) || value < minimum || value > maximum) {
		throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`)
	}
	return value
}

const args = process.argv.slice(2)
if (args.length === 0 || args.includes('--help')) {
	usage()
	process.exit(args.includes('--help') ? 0 : 2)
}
const inputPath = args[0]
if (!inputPath || inputPath.startsWith('--')) {
	usage()
	process.exit(2)
}
const optionArgs = args.slice(1)
const noCache = optionArgs.includes('--no-cache')
const seenOptions = new Set()
for (let index = 0; index < optionArgs.length; index += 1) {
	const option = optionArgs[index]
	if (option === '--no-cache') continue
	if (option !== '--iterations' && option !== '--warmup') {
		throw new Error(`Unknown option or unexpected argument: ${option}`)
	}
	if (seenOptions.has(option)) {
		throw new Error(`Option ${option} may only be provided once.`)
	}
	seenOptions.add(option)
	if (!optionArgs[index + 1] || optionArgs[index + 1].startsWith('--')) {
		throw new Error(`Option ${option} requires a numeric value.`)
	}
	index += 1
}
const iterations = integerOption(optionArgs, '--iterations', 100, 1, 2_000)
const warmup = integerOption(optionArgs, '--warmup', 20, 0, 200)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dom = new JSDOM('<!doctype html><html><body></body></html>')
for (const name of [
	'window',
	'document',
	'HTMLElement',
	'Element',
	'Node',
	'Event',
]) {
	globalThis[name] = name === 'window' ? dom.window : dom.window[name]
}

const server = await createServer({
	root,
	configFile: resolve(root, 'vite.config.ts'),
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true, hmr: false, watch: null },
	appType: 'custom',
	logLevel: 'error',
})

function summarize(samples) {
	const ordered = [...samples].sort((a, b) => a - b)
	const at = (quantile) =>
		ordered[Math.ceil(ordered.length * quantile) - 1] ?? null
	return {
		count: ordered.length,
		p50: at(0.5),
		p95: at(0.95),
		p99: at(0.99),
		totalMs: Number(ordered.reduce((sum, value) => sum + value, 0).toFixed(3)),
	}
}

try {
	const [
		{ decodeTrack },
		{ createEditorState },
		{ TrackGeometryService },
		{ analyzeTrack },
		{ createEditorChrome },
		{ createEditorDiagnosticsMemo },
	] = await Promise.all([
		server.ssrLoadModule('/src/domain/track/trackCodec.ts'),
		server.ssrLoadModule('/src/domain/editor/editorState.ts'),
		server.ssrLoadModule('/src/domain/track/trackGeometryService.ts'),
		server.ssrLoadModule('/src/domain/track/trackDiagnostics.ts'),
		server.ssrLoadModule('/src/ui/screens/editorChrome.ts'),
		server.ssrLoadModule('/src/ui/editor/editorFrameControls.ts'),
	])
	const rawText = await readFile(resolve(inputPath), 'utf8')
	let raw
	try {
		raw = JSON.parse(rawText)
	} catch (error) {
		throw new Error(`Invalid JSON in ${resolve(inputPath)}: ${error.message}`)
	}
	const track = decodeTrack(raw?.track ?? raw, 1)
	if (!track)
		throw new Error(
			`The input did not decode as a valid Track Forge track: ${resolve(inputPath)}`,
		)

	const geometryService = new TrackGeometryService()
	const preferences = {
		car: 'blue',
		difficulty: 'normal',
		audioEnabled: true,
		hapticsEnabled: true,
		dynamicZoomEnabled: true,
	}
	const editorUi = {
		tool: 'select',
		surface: 'street',
		structure: 'surface',
		terrainBrush: { mode: 'ground', radius: 48 },
		grid: true,
		cameraRequest: null,
		selectedCrossing: null,
		selectedPoint: null,
	}
	const actions = Object.fromEntries(
		[
			'home',
			'race',
			'menu',
			'save',
			'load',
			'toggleGrid',
			'edit',
			'tool',
			'surface',
			'structure',
			'terrainMode',
			'terrainRadius',
			'scenery',
			'camera',
		].map((key) => [key, () => undefined]),
	)

	function makeSnapshot(offset) {
		const points =
			offset === 0
				? track.points
				: track.points.map((point, index) =>
						index === Math.floor(track.points.length / 2)
							? { ...point, x: point.x + offset }
							: point,
					)
		const editor = offset === 0 ? baseEditor : { ...baseEditor, points }
		return {
			mode: 'editor',
			paused: false,
			overlay: { type: 'none' },
			tracks: [track],
			currentTrack: track,
			editor,
			editorUi,
			preferences,
			scoresByTrack: {},
			notice: null,
		}
	}
	const baseEditor = createEditorState(
		track.points,
		track.trees,
		track.start,
		track.terrain,
		track,
	)

	const scenarios = {}
	for (const [name, changing] of [
		['unchangedSnapshot', false],
		['changingSnapshot', true],
	]) {
		const diagnosticsMemo = noCache ? undefined : createEditorDiagnosticsMemo()
		const diagnosticSamples = []
		const chromeSamples = []
		let diagnosticsCount = null
		for (let index = -warmup; index < iterations; index++) {
			const snapshot = makeSnapshot(
				changing ? Math.max(1, index + warmup + 1) : 0,
			)
			const geometry = geometryService.get({
				routeKind: snapshot.editor.routeKind,
				points: snapshot.editor.points,
				terrain: snapshot.editor.terrain,
				...(snapshot.editor.start ? { start: snapshot.editor.start } : {}),
			})
			const diagnosticStart = performance.now()
			const diagnostics = analyzeTrack(
				{
					...track,
					routeKind: snapshot.editor.routeKind,
					points: snapshot.editor.points,
					trees: snapshot.editor.trees,
					terrain: snapshot.editor.terrain,
					...(snapshot.editor.start ? { start: snapshot.editor.start } : {}),
				},
				geometry,
			)
			const diagnosticElapsed = performance.now() - diagnosticStart
			const chromeStart = performance.now()
			const screen = createEditorChrome(
				snapshot,
				actions,
				geometry,
				diagnosticsMemo,
			)
			dom.window.document.body.replaceChildren(screen)
			const chromeElapsed = performance.now() - chromeStart
			if (index >= 0) {
				diagnosticSamples.push(diagnosticElapsed)
				chromeSamples.push(chromeElapsed)
				diagnosticsCount = diagnostics.length
			}
		}
		scenarios[name] = {
			diagnosticCount: diagnosticsCount ?? 0,
			analyzeTrack: summarize(diagnosticSamples),
			createEditorChromeAndAttach: summarize(chromeSamples),
		}
	}

	console.log(
		JSON.stringify(
			{
				input: resolve(inputPath),
				track: {
					id: track.id,
					name: track.name,
					pointCount: track.points.length,
					terrainCellCount: track.terrain.cells.length,
					treeCount: track.trees.length,
					sceneryCount: track.scenery.length,
				},
				warmupIterations: warmup,
				measuredIterations: iterations,
				diagnosticsMemoEnabled: !noCache,
				scenarios,
				notes: [
					'Single-process Node/Vite SSR with jsdom; Vite startup and module loading are excluded.',
					'Timings cover JavaScript diagnostics and editor DOM construction/attachment only.',
					'The changing-input scenario offsets one road point synthetically; it does not simulate or validate a pointer gesture.',
					'jsdom does not perform browser style/layout, paint, Phaser canvas rendering, GPU work, or touch/frame sampling.',
					`Diagnostics memo ${noCache ? 'disabled' : 'enabled'}; pass --no-cache for an uncached comparison under the same workload.`,
					'Use the opt-in Playwright editor drag profiler for browser frame and live gesture measurements.',
				],
			},
			null,
			2,
		),
	)
} finally {
	await server.close()
	dom.window.close()
}
