// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { requireFixture } from '../fixtures/requireFixture'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createLaneScenarios } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'
import { renderLaneReport } from '../../qa/lanes/report'

describe('AI lane report', () => {
	it('fits the map around a translated circuit without including the world origin', () => {
		const original = requireFixture(createLaneScenarios()[0])
		const track = {
			...original,
			points: original.points.map((p) => ({
				...p,
				x: p.x + 100000,
				y: p.y + 100000,
			})),
		}
		const run = runLaneCheck({
			path: buildRoadPath(track.points, track.terrain),
			trackName: track.name,
			seed: 1,
			difficulty: 'normal',
			reversed: false,
			seconds: 0.2,
			laps: 1,
			mode: 'solo',
			car: 'blue',
		})
		const viewBox = requireFixture(
			renderLaneReport([run]).match(/viewBox="([^"]+)"/),
		)[1]
		const bounds = requireFixture(viewBox).split(' ').map(Number)
		expect(bounds[0]).toBeGreaterThan(99000)
		expect(bounds[2]).toBeLessThan(1000)
		expect(bounds[3]).toBeLessThan(1000)
	})
	it('renders road geometry, actual dot trails and located findings without executable track content', () => {
		const track = requireFixture(createLaneScenarios()[0])
		const run = runLaneCheck({
			path: buildRoadPath(track.points, track.terrain),
			trackName: '<script>alert("track")</script>',
			seed: 42,
			difficulty: 'normal',
			reversed: true,
			seconds: 0.2,
			laps: 1,
			mode: 'solo',
			car: 'blue',
		})
		const html = renderLaneReport([run])
		expect(html).toContain('&lt;script&gt;')
		expect(html).not.toContain('<script>')
		expect(html).toContain('<svg')
		expect(html).toContain('data-vehicle="player"')
		expect(html).toContain('data-code="timeout"')
		expect(html).toContain('Reverse')
		expect(html).toContain('seed 42')
		expect(html).toContain(requireFixture(run.issues[0]).sectionId)
		expect(html).toContain('0 / 1')
		expect(html).not.toContain('NaN')
	})
	it('handles a batch without findings', () => {
		expect(renderLaneReport([])).toContain('0 runs')
	})
})
