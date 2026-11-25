import { describe, expect, it } from 'vitest'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { bridgeRenderPasses, buildBridgePresentation, chunkBridgePrimitives, type BridgePolygonPrimitive } from '@/phaser/rendering/bridgeRenderer'
import { BRIDGE_THEMES, bridgeJointFractions, bridgePaintCommands } from '@/presentation/environments/bridgeMaterials'
import { roadColorsForEnvironment } from '@/presentation/environments/roadMaterials'
import { buildRoadRibbonQuads } from '@/presentation/environments/roadRibbonQuads'
import { bridgeBitmapPrimitives, roadBitmapTransform } from '@/presentation/environments/meadowBitmapTiles'
import { BRIDGE_APPROACH_BITMAP_DEPTH, BRIDGE_DECK_BITMAP_DEPTH } from '@/phaser/rendering/meadowBitmapRenderer'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'

const geometry = buildTrackGeometry({
  routeKind: 'point-to-point',
  points: [
    { x: -300, y: 0, surface: 'street' },
    { x: 0, y: 0, surface: 'street', structure: 'overpass' },
    { x: 600, y: 0, surface: 'street' },
    { x: 900, y: 0, surface: 'street' },
  ],
  terrain: EMPTY_TERRAIN,
})

describe('environment bridge artwork', () => {
  it('chunks bridge primitives in painter order with bounds covering every item', () => {
    const primitives = buildBridgePresentation(geometry)
    const batches = chunkBridgePrimitives(primitives, 7)
    expect(batches.flatMap(batch => batch.items)).toEqual(primitives)
    for (const batch of batches) {
      for (const primitive of batch.items) {
        const points = 'polygon' in primitive ? primitive.polygon : [primitive.start, primitive.end]
        for (const point of points) {
          expect(point.x).toBeGreaterThanOrEqual(batch.bounds.left)
          expect(point.x).toBeLessThanOrEqual(batch.bounds.right)
          expect(point.y).toBeGreaterThanOrEqual(batch.bounds.top)
          expect(point.y).toBeLessThanOrEqual(batch.bounds.bottom)
        }
      }
    }
  })

  it('assigns each primitive once and keeps underlay before ramp and deck passes', () => {
    const primitives = buildBridgePresentation(geometry)
    const passes = bridgeRenderPasses(primitives)
    const rendered = [...passes.underlay, ...passes.rampApproach, ...passes.deck, ...passes.walls]
    expect(new Set(rendered).size).toBe(primitives.length)
    for (const pass of [passes.underlay, passes.rampApproach, passes.deck, passes.walls]) {
      expect(pass.map(item => primitives.indexOf(item))).toEqual(pass.map(item => primitives.indexOf(item)).sort((a, b) => a - b))
    }
    expect(passes.underlay.every(item => item.kind === 'shadow-soft' || item.kind === 'shadow-core' || item.kind === 'pillar')).toBe(true)
    expect(passes.rampApproach.length).toBeGreaterThan(0)
    expect(passes.rampApproach.every(item => item.rampApproach === true)).toBe(true)
    expect(passes.deck.every(item => item.kind !== 'wall' && item.kind !== 'pillar' && item.kind !== 'shadow-soft' && item.kind !== 'shadow-core' && !item.rampApproach)).toBe(true)
    expect(passes.walls.every(item => item.kind === 'wall')).toBe(true)
  })

  it('uses exact canonical road quads and texture phases for elevated surfaces', () => {
    const road = buildRoadRibbonQuads(geometry.path, geometry.ribbon)
    const surfaces = buildBridgePresentation(geometry).filter(
      (p): p is BridgePolygonPrimitive => p.kind === 'surface',
    )
    expect(surfaces.length).toBeGreaterThan(0)
    for (const surface of surfaces) {
      const quad = surface.roadQuad
      if (!quad) throw new Error('Expected bridge road quad')
      const original = road.find(p => p.from.distance === quad.from.distance)
      if (!original) throw new Error('Expected canonical road quad')
      expect(quad).toEqual(original)
      expect(roadBitmapTransform(quad, 96, 48, 3)).toEqual(roadBitmapTransform(original, 96, 48, 3))
    }
  })

  it('separates ramp overlays from the elevated deck without changing vehicle depths', () => {
    const primitives = buildBridgePresentation(geometry)
    const approach = bridgeBitmapPrimitives(primitives, true)
    const deck = bridgeBitmapPrimitives(primitives, false)
    expect(approach.some(p => p.kind === 'surface')).toBe(true)
    expect(deck.some(p => p.kind === 'surface')).toBe(true)
    expect(deck.some(p => p.kind === 'wall')).toBe(true)
    expect(approach.every(p => p.rampApproach && p.kind !== 'wall')).toBe(true)
    expect(deck.every(p => !p.rampApproach)).toBe(true)
    expect(BRIDGE_APPROACH_BITMAP_DEPTH).toBeGreaterThan(WORLD_RENDER_DEPTH.structureUnderlay)
    expect(BRIDGE_APPROACH_BITMAP_DEPTH).toBeLessThan(WORLD_RENDER_DEPTH.lowerVehicle)
    expect(BRIDGE_DECK_BITMAP_DEPTH).toBeGreaterThan(WORLD_RENDER_DEPTH.structureDeck)
    expect(BRIDGE_DECK_BITMAP_DEPTH).toBeLessThan(WORLD_RENDER_DEPTH.structureWall)
  })

  it('preserves authored surface colors in vector fallback and gives all themes distinct rails', () => {
    const primitive = buildBridgePresentation(geometry).find(p => p.kind === 'surface')
    const wall = buildBridgePresentation(geometry).find(p => p.kind === 'wall')
    if (!primitive || !wall) throw new Error('Expected bridge presentation')
    for (const night of [false, true]) {
      const rails = new Set<number>()
      for (const env of ['grass', 'desert', 'cityscape', 'kids-room'] as const) {
        for (const surface of ['street', 'dirt', 'ice'] as const) {
          const p = { ...primitive, surface }
          const road = roadColorsForEnvironment(surface, env)
          const expected = Number.parseInt((night ? road.nightRoad : road.road).slice(1), 16)
          expect(bridgePaintCommands(p, env, night)[0]).toMatchObject({ kind: 'fill', color: expected })
          expect(bridgePaintCommands(p, env, night, true).every(c => c.kind === 'line')).toBe(true)
        }
        const first = bridgePaintCommands(wall, env, night)[0]
        expect(first).toMatchObject({ kind: 'line', color: BRIDGE_THEMES[env][night ? 'night' : 'day'].rail })
        if (!first) throw new Error('Expected rail color')
        rails.add(first.color)
      }
      expect(rails.size).toBe(4)
    }
  })

  it('places joints once at a shared sample boundary, not once per road quad', () => {
    expect(bridgeJointFractions(0, 96, 96)).toEqual([1])
    expect(bridgeJointFractions(96, 100, 96)).toEqual([])
    expect(bridgeJointFractions(90, 102, 96)).toEqual([0.5])
    expect(bridgeJointFractions(100, 100, 96)).toEqual([])
  })
})

describe('bridge material relief', () => {
  it('adds only bounded, translucent fascia bevels within the canonical side face', () => {
    const face = buildBridgePresentation(geometry).find(p => p.kind === 'side-face')
    if (!face || !('polygon' in face)) throw new Error('Expected side face')
    const commands = bridgePaintCommands(face, 'cityscape', false)
    expect(commands[0]).toMatchObject({ kind: 'fill', polygon: face.polygon })
    expect(commands).toHaveLength(5)
    const [a, b, c, d] = face.polygon
    const along = (p: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }) => {
      const dx = to.x - from.x, dy = to.y - from.y
      const len = dx * dx + dy * dy
      return len > 0 ? ((p.x - from.x) * dx + (p.y - from.y) * dy) / len : 0
    }
    for (const command of commands.slice(1)) {
      if (command.kind !== 'fill') throw new Error('Expected fascia band')
      expect(command.alpha).toBeLessThan(1)
      for (const [point, from, to] of [[command.polygon[0], a, d], [command.polygon[1], b, c], [command.polygon[2], b, c], [command.polygon[3], a, d]] as const) {
        expect(along(point, from, to)).toBeGreaterThanOrEqual(-1e-8)
        expect(along(point, from, to)).toBeLessThanOrEqual(1 + 1e-8)
      }
    }
  })
})
