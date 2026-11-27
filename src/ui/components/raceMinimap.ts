import type { GhostPose } from '@/application/race/ghostReplay'
import type { RaceSessionSnapshot } from '@/application/race/raceSession'
import type { Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { element } from '@/ui/dom'

const SVG_NS = 'http://www.w3.org/2000/svg'
const VIEW_SIZE = 100
const MAP_PADDING = 8
const MAX_ROUTE_POINTS = 512

interface MapPoint extends Vector2 {}
interface Marker {
	readonly node: SVGCircleElement
	readonly heading?: SVGLineElement
	x: number
	y: number
}

function svgElement<K extends keyof SVGElementTagNameMap>(
	tag: K,
): SVGElementTagNameMap[K] {
	return document.createElementNS(SVG_NS, tag)
}

function finitePoint(point: Vector2): boolean {
	return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function samplePoints(points: readonly MapPoint[]): readonly MapPoint[] {
	if (points.length <= MAX_ROUTE_POINTS) return points.filter(finitePoint)
	const stride = (points.length - 1) / (MAX_ROUTE_POINTS - 1)
	const sampled: MapPoint[] = []
	for (let index = 0; index < MAX_ROUTE_POINTS; index += 1) {
		const point = points[Math.round(index * stride)]
		if (point && finitePoint(point)) sampled.push(point)
	}
	return sampled
}

function mapProjection(
	points: readonly MapPoint[],
): (point: Vector2) => MapPoint {
	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity
	for (const point of points) {
		minX = Math.min(minX, point.x)
		maxX = Math.max(maxX, point.x)
		minY = Math.min(minY, point.y)
		maxY = Math.max(maxY, point.y)
	}
	const width = maxX - minX
	const height = maxY - minY
	const drawable = VIEW_SIZE - MAP_PADDING * 2
	const scale = Math.min(
		drawable / Math.max(width, 1),
		drawable / Math.max(height, 1),
	)
	const drawnWidth = width * scale
	const drawnHeight = height * scale
	const offsetX = (VIEW_SIZE - drawnWidth) / 2
	const offsetY = (VIEW_SIZE - drawnHeight) / 2
	return ({ x, y }) => ({
		x: Math.max(0, Math.min(VIEW_SIZE, offsetX + (x - minX) * scale)),
		y: Math.max(0, Math.min(VIEW_SIZE, offsetY + (y - minY) * scale)),
	})
}

function setAttributeIfChanged(
	node: SVGElement,
	name: string,
	value: string,
): void {
	if (node.getAttribute(name) !== value) node.setAttribute(name, value)
}

export function createRaceMinimap(): {
	readonly element: HTMLElement
	update(snapshot: RaceSessionSnapshot, nearby: readonly GhostPose[]): void
} {
	const root = element('div', 'race-minimap')
	root.hidden = true
	let svg: SVGSVGElement | undefined
	let route: SVGPathElement | undefined
	let markerLayer: SVGGElement | undefined
	let playerLayer: SVGGElement | undefined
	let cachedPath: RoadPath | undefined
	let cachedRunId: number | undefined
	let project: ((point: Vector2) => MapPoint) | undefined
	const markers = new Map<string, Marker>()

	function clearMap(): void {
		root.replaceChildren()
		svg = undefined
		route = undefined
		markerLayer = undefined
		playerLayer = undefined
		cachedPath = undefined
		cachedRunId = undefined
		project = undefined
		markers.clear()
	}

	function prepare(path: RoadPath, runId: number | undefined): void {
		const points = samplePoints(path.points)
		const projection = points.length > 0 ? mapProjection(points) : undefined
		const nextSvg = svgElement('svg')
		nextSvg.setAttribute('viewBox', `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`)
		nextSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
		nextSvg.setAttribute('role', 'img')
		nextSvg.setAttribute('aria-label', 'Race minimap')
		const nextRoute = svgElement('path')
		nextRoute.setAttribute('data-kind', 'route')
		nextRoute.setAttribute('aria-hidden', 'true')
		if (points.length > 0 && projection) {
			const commands = points.map((point, index) => {
				const mapped = projection(point)
				return `${index === 0 ? 'M' : 'L'}${mapped.x.toFixed(2)},${mapped.y.toFixed(2)}`
			})
			if (path.closed && points.length > 2) commands.push('Z')
			nextRoute.setAttribute('d', commands.join(' '))
		} else {
			nextRoute.setAttribute('d', '')
		}
		const nextMarkerLayer = svgElement('g')
		nextMarkerLayer.setAttribute('aria-hidden', 'true')
		const nextPlayerLayer = svgElement('g')
		nextPlayerLayer.setAttribute('aria-hidden', 'true')
		nextSvg.append(nextRoute, nextMarkerLayer, nextPlayerLayer)
		root.replaceChildren(nextSvg)
		svg = nextSvg
		route = nextRoute
		markerLayer = nextMarkerLayer
		playerLayer = nextPlayerLayer
		cachedPath = path
		cachedRunId = runId
		project = projection
		markers.clear()
	}

	function updateMarker(
		key: string,
		kind: string,
		point: Vector2,
		angle?: number,
	): void {
		if (!svg || !markerLayer || !playerLayer || !project || !finitePoint(point))
			return
		let marker = markers.get(key)
		if (!marker) {
			let heading: SVGLineElement | undefined
			if (kind === 'player') {
				heading = svgElement('line')
				heading.setAttribute('data-kind', 'heading')
				heading.setAttribute('data-map-heading', '')
				heading.setAttribute('aria-hidden', 'true')
				heading.setAttribute('visibility', 'hidden')
			}
			const node = svgElement('circle')
			node.setAttribute('data-kind', kind)
			if (kind === 'player') node.setAttribute('data-map-player', '')
			node.setAttribute('aria-hidden', 'true')
			node.setAttribute(
				'r',
				kind === 'player' ? '3.4' : kind === 'ghost' ? '2.7' : '2.4',
			)
			const layer = kind === 'player' ? playerLayer : markerLayer
			if (heading) layer.append(heading)
			layer.append(node)
			marker = { node, ...(heading ? { heading } : {}), x: NaN, y: NaN }
			markers.set(key, marker)
		}
		const mapped = project(point)
		if (mapped.x !== marker.x) {
			setAttributeIfChanged(marker.node, 'cx', mapped.x.toFixed(2))
			marker.x = mapped.x
		}
		if (mapped.y !== marker.y) {
			setAttributeIfChanged(marker.node, 'cy', mapped.y.toFixed(2))
			marker.y = mapped.y
		}
		if (!marker.heading) return
		if (angle === undefined || !Number.isFinite(angle)) {
			setAttributeIfChanged(marker.heading, 'visibility', 'hidden')
			return
		}
		const headingLength = 8
		const endX = Math.max(
			0,
			Math.min(VIEW_SIZE, mapped.x + Math.cos(angle) * headingLength),
		)
		const endY = Math.max(
			0,
			Math.min(VIEW_SIZE, mapped.y + Math.sin(angle) * headingLength),
		)
		setAttributeIfChanged(marker.heading, 'x1', mapped.x.toFixed(2))
		setAttributeIfChanged(marker.heading, 'y1', mapped.y.toFixed(2))
		setAttributeIfChanged(marker.heading, 'x2', endX.toFixed(2))
		setAttributeIfChanged(marker.heading, 'y2', endY.toFixed(2))
		setAttributeIfChanged(marker.heading, 'visibility', 'visible')
	}

	function update(
		snapshot: RaceSessionSnapshot,
		nearby: readonly GhostPose[],
	): void {
		const setHidden = (hidden: boolean): void => {
			if (root.hidden !== hidden) root.hidden = hidden
		}
		const state = snapshot.state
		const path = state?.path
		if (!state || !path || path.points.length === 0) {
			setHidden(true)
			clearMap()
			return
		}
		if (!svg || path !== cachedPath || snapshot.runId !== cachedRunId)
			prepare(path, snapshot.runId)
		if (!svg || !route || !project) {
			setHidden(true)
			return
		}
		setHidden(false)

		const present = new Set<string>()
		for (const vehicle of state.vehicles) {
			const key = `vehicle:${vehicle.id}`
			if (!finitePoint(vehicle)) continue
			present.add(key)
			updateMarker(
				key,
				vehicle.player ? 'player' : 'vehicle',
				vehicle,
				vehicle.player ? vehicle.angle : undefined,
			)
		}
		nearby.forEach((pose, index) => {
			const key = `nearby:${index}`
			if (!finitePoint(pose)) return
			present.add(key)
			updateMarker(key, 'nearby', pose)
		})
		if (snapshot.ghost && finitePoint(snapshot.ghost)) {
			present.add('ghost:saved')
			updateMarker('ghost:saved', 'ghost', snapshot.ghost)
		}
		for (const [key, marker] of markers) {
			if (present.has(key)) continue
			marker.node.remove()
			marker.heading?.remove()
			markers.delete(key)
		}
	}

	return { element: root, update }
}
