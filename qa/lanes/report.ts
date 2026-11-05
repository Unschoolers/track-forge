import { CAR_SPECS, ROAD_GEOMETRY } from '@/domain/config'
import type { LaneRun } from './simulation'

function escapeHtml(value: string | number): string {
	return String(value).replace(
		/[&<>"']/g,
		(char) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			})[char] ?? char,
	)
}
const decimal = (n: number) => n.toFixed(1)
const errors = (run: LaneRun) =>
	run.issues.filter((i) => i.severity === 'error').length
const warnings = (run: LaneRun) =>
	run.issues.filter((i) => i.severity === 'warning').length
const label = (run: LaneRun) =>
	`${run.mode} · ${run.difficulty} · ${run.reversed ? 'Reverse' : 'Forward'} · seed ${run.seed} · ${run.car}`

function mapSvg(run: LaneRun): string {
	const positions = [...run.road, ...run.samples, ...run.issues]
	const bounds = positions.reduce(
		(box, point) => ({
			minX: Math.min(box.minX, point.x),
			minY: Math.min(box.minY, point.y),
			maxX: Math.max(box.maxX, point.x),
			maxY: Math.max(box.maxY, point.y),
		}),
		{ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
	)
	const minX = (positions.length ? bounds.minX : 0) - 60
	const minY = (positions.length ? bounds.minY : 0) - 60
	const width = (positions.length ? bounds.maxX : 0) - minX + 60
	const height = (positions.length ? bounds.maxY : 0) - minY + 60
	const points = run.road.map((p) => `${p.x},${p.y}`).join(' ')
	const close = run.road[0]
	const loop = close ? `${points} ${close.x},${close.y}` : points
	const dots = run.samples
		.map(
			(s) =>
				`<circle data-vehicle="${escapeHtml(s.vehicleId)}" cx="${s.x}" cy="${s.y}" r="2" fill="${CAR_SPECS[s.car].color}" opacity=".65"><title>${escapeHtml(`${s.vehicleId} · ${decimal(s.time)} s · lane ${decimal(s.lane)} / target ${decimal(s.targetLane)} · ${s.sectionId} · z ${decimal(s.z)} · ${s.phase} · speed ${decimal(s.speed)}`)}</title></circle>`,
		)
		.join('')
	const markers = run.issues
		.map(
			(i) =>
				`<circle data-code="${i.code}" cx="${i.x}" cy="${i.y}" r="6" fill="none" stroke="${i.severity === 'error' ? '#ff5967' : '#ffc75b'}" stroke-width="2"><title>${escapeHtml(`${i.code} · ${i.vehicleId} · ${decimal(i.time)} s · ${i.sectionId}: ${i.detail}`)}</title></circle>`,
		)
		.join('')
	return `<svg role="img" aria-label="Road and recorded AI dot trails" viewBox="${minX} ${minY} ${width} ${height}"><polyline points="${loop}" fill="none" stroke="#69707e" stroke-width="${ROAD_GEOMETRY.edgeWidth}" stroke-linejoin="round"/><polyline points="${loop}" fill="none" stroke="#313846" stroke-width="${ROAD_GEOMETRY.surfaceWidth}" stroke-linejoin="round"/><polyline points="${loop}" fill="none" stroke="#a4adbc" stroke-width="1" stroke-dasharray="6 8"/>${dots}${markers}</svg>`
}

export function renderLaneReport(runs: readonly LaneRun[]): string {
	const errorCount = runs.reduce((sum, run) => sum + errors(run), 0)
	const warningCount = runs.reduce((sum, run) => sum + warnings(run), 0)
	const rows = runs
		.map(
			(run, index) =>
				`<tr><td><a href="#run-${index}">${index + 1}. ${escapeHtml(run.trackName)}</a></td><td>${escapeHtml(label(run))}</td><td>${run.vehicles.filter((v) => v.finishedAt !== null).length} / ${run.vehicles.length}</td><td>${errors(run)}</td><td>${warnings(run)}</td><td>${decimal(run.simulatedSeconds)} s</td></tr>`,
		)
		.join('')
	const groups = new Map<
		string,
		{
			track: string
			section: string
			code: string
			count: number
			errors: number
			run: number
		}
	>()
	runs.forEach((run, index) => {
		run.issues.forEach((issue) => {
			const key = JSON.stringify([run.trackName, issue.sectionId, issue.code])
			const group = groups.get(key) ?? {
				track: run.trackName,
				section: issue.sectionId,
				code: issue.code,
				count: 0,
				errors: 0,
				run: index,
			}
			group.count++
			if (issue.severity === 'error') group.errors++
			groups.set(key, group)
		})
	})
	const hotspots = [...groups.values()]
		.sort((a, b) => b.errors - a.errors || b.count - a.count)
		.slice(0, 20)
		.map(
			(g) =>
				`<tr><td><a href="#run-${g.run}">${escapeHtml(g.track)}</a></td><td>${escapeHtml(g.section)}</td><td>${g.code}</td><td>${g.count}</td></tr>`,
		)
		.join('')
	const details = runs
		.map((run, index) => {
			const metrics = run.vehicles
				.map(
					(v) =>
						`<tr><td style="color:${CAR_SPECS[v.car].color}">${escapeHtml(v.vehicleId)} (${v.car})</td><td>${v.finishedAt === null ? 'Unfinished' : `${decimal(v.finishedAt)} s`}</td><td>${v.laps}</td><td>${decimal(v.maxLaneError)}</td><td>${decimal(v.offRoadSeconds)} s</td><td>${v.recoveries}</td></tr>`,
				)
				.join('')
			const findings = run.issues
				.map(
					(i) =>
						`<tr><td class="${i.severity}">${i.severity}</td><td>${decimal(i.time)} s</td><td>${escapeHtml(i.vehicleId)}</td><td>${i.code}</td><td>${escapeHtml(i.sectionId)} (#${i.pathIndex})<br>(${decimal(i.x)}, ${decimal(i.y)})</td><td>${escapeHtml(i.detail)}</td></tr>`,
				)
				.join('')
			return `<details id="run-${index}"${index === 0 ? ' open' : ''}><summary>${index + 1}. ${escapeHtml(run.trackName)} — ${escapeHtml(label(run))} — ${errors(run)} errors, ${warnings(run)} warnings</summary><p>Start ${decimal(run.startRatio * 100)}% · ${run.laps} lap(s) · ${run.steps} steps · stopped: ${run.stoppedReason}</p>${mapSvg(run)}<div class="scroll"><table><thead><tr><th>Driver</th><th>Finish</th><th>Laps</th><th>Max lane error</th><th>Off road</th><th>Recoveries</th></tr></thead><tbody>${metrics}</tbody></table><table><thead><tr><th>Severity</th><th>Time</th><th>Driver</th><th>Finding</th><th>Road location</th><th>Detail</th></tr></thead><tbody>${findings || '<tr><td colspan="6">No findings.</td></tr>'}</tbody></table></div></details>`
		})
		.join('')
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TrackForge AI lane checker</title><style>
  :root{color-scheme:dark;font:15px system-ui;background:#141923;color:#e8edf5}body{max-width:1100px;margin:32px auto;padding:0 20px}h1{margin-bottom:8px;font-size:30px}h2{font-size:20px;margin-top:32px}p{color:#b9c3d3;line-height:1.6}a{color:#87b9ff}strong{color:#fff}.error{color:#ff5967}.warning{color:#ffc75b}table{border-collapse:collapse;width:100%;margin:18px 0;font-size:13px}th,td{text-align:left;padding:10px;border-bottom:1px solid #363e4c;vertical-align:top}th{color:#b9c3d3}details{border:1px solid #3d4656;border-radius:8px;padding:18px;margin:18px 0;background:#1b2230}summary{cursor:pointer;font-weight:650;line-height:1.7}svg{display:block;width:100%;max-height:650px;background:#101620;border-radius:6px}.scroll{overflow-x:auto}code{color:#dce8ff}footer{margin:32px 0;color:#b9c3d3}
  </style></head><body><h1>AI lane checker</h1><p><strong>${runs.length} runs</strong> · <span class="error">${errorCount} errors</span> · <span class="warning">${warningCount} warnings</span></p><p>Actual race engine at 60 Hz. Dots sampled at 10 Hz; colours identify cars. Red rings mark errors, amber rings mark warnings. Hover a dot or ring for telemetry. Expand a run for its map and exact findings.</p><div class="scroll"><table><thead><tr><th>Track / run</th><th>Scenario</th><th>Finished</th><th>Errors</th><th>Warnings</th><th>Simulated</th></tr></thead><tbody>${rows}</tbody></table></div><h2>Road sections to inspect first</h2><p>Grouped across seeds and directions; errors first, then frequency. A warning is a diagnostic signal, not proof of a bug.</p><div class="scroll"><table><thead><tr><th>Track</th><th>Section</th><th>Finding</th><th>Occurrences</th></tr></thead><tbody>${hotspots}</tbody></table></div>${details}<footer>Thresholds: off road ≥ 0.25 s; lane error &gt; 18 units for ≥ 1 s; reverse speed &gt; 15 for ≥ 0.75 s; no forward progress ≥ 5 s. Recoveries and time-budget failures are errors. Finished cars are excluded from checks. Full samples and run parameters are in <a href="report.json">report.json</a>.</footer></body></html>`
}
