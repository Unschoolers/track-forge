import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let server
try {
	server = await createServer({
		root,
		configFile: resolve(root, 'vite.config.ts'),
		server: { middlewareMode: true, hmr: false, watch: null },
		appType: 'custom',
		logLevel: 'error',
	})
	const { parseLaneOptions } = await server.ssrLoadModule(
		'/qa/lanes/options.ts',
	)
	const options = parseLaneOptions(process.argv.slice(2))
	if (options.help) {
		console.log(`TrackForge AI lane checker — real physics, no renderer

npm run qa:lanes -- [options]
  --scenario starter|hairpin|bridge|all   Default: starter
  --track file.json                      Saved track or track array; repeatable
  --mode solo|traffic|both                Default: traffic
  --direction forward|reverse|both       Default: both
  --difficulty easy|normal|hard|all       Default: normal
  --car blue|red|green|yellow|all         Default: blue
  --seeds N --seed N                     Count (default 3), first seed (default 1)
  --seconds N --laps N                   Per-run budget (default 60), laps (default 1)
  --out directory                       Default: qa/results/lanes
  --strict                              Exit 1 if any error findings

Custom tracks replace built-in scenarios and keep their authored start ratio.
Default directions test both ways. Reports: report.html and report.json.`)
	} else {
		const { createLaneScenarios, decodeTrackInput, prepareLanePath } =
			await server.ssrLoadModule('/qa/lanes/scenarios.ts')
		const { runLaneCheck } = await server.ssrLoadModule(
			'/qa/lanes/simulation.ts',
		)
		const { renderLaneReport } = await server.ssrLoadModule(
			'/qa/lanes/report.ts',
		)
		const tracks =
			options.trackFiles.length > 0
				? (
						await Promise.all(
							options.trackFiles.map(async (file) =>
								decodeTrackInput(
									JSON.parse(await readFile(resolve(file), 'utf8')),
								),
							),
						)
					).flat()
				: createLaneScenarios().filter((track) =>
						options.scenarios.includes(track.id),
					)
		const runs = []
		const started = performance.now()
		for (const track of tracks) {
			const path = prepareLanePath(track)
			for (const difficulty of options.difficulties)
				for (const car of options.cars)
					for (const mode of options.modes)
						for (const reversed of options.directions)
							for (const seed of options.seeds) {
								const run = runLaneCheck({
									path,
									trackName: track.name,
									seed,
									difficulty,
									car,
									mode,
									reversed,
									startRatio: track.start?.ratio ?? 0,
									seconds: options.seconds,
									laps: options.laps,
								})
								runs.push(run)
								const errors = run.issues.filter(
									(issue) => issue.severity === 'error',
								).length
								console.log(
									`${runs.length}. ${track.name} | ${mode} ${difficulty} ${car} ${reversed ? 'reverse' : 'forward'} seed ${seed}: ${run.vehicles.filter((v) => v.finishedAt !== null).length}/${run.vehicles.length} finished, ${errors} errors, ${run.issues.length - errors} warnings`,
								)
							}
		}
		const elapsed = (performance.now() - started) / 1000
		const simulated = runs.reduce((sum, run) => sum + run.simulatedSeconds, 0)
		const out = resolve(options.out)
		await mkdir(out, { recursive: true })
		await writeFile(
			resolve(out, 'report.json'),
			`${JSON.stringify({ schemaVersion: 1, timestep: 1 / 60, sampleHz: 10, runs })}\n`,
		)
		await writeFile(resolve(out, 'report.html'), renderLaneReport(runs))
		const errors = runs.reduce(
			(sum, run) =>
				sum + run.issues.filter((issue) => issue.severity === 'error').length,
			0,
		)
		console.log(
			`\n${runs.length} runs: ${simulated.toFixed(1)} simulated seconds in ${elapsed.toFixed(2)} s (${(simulated / Math.max(0.001, elapsed)).toFixed(1)}× real time).\nReport: ${resolve(out, 'report.html')}`,
		)
		if (options.strict && errors > 0) process.exitCode = 1
	}
} catch (error) {
	console.error(
		`Lane checker: ${error instanceof Error ? error.message : String(error)}`,
	)
	process.exitCode = 2
} finally {
	await server?.close()
}
