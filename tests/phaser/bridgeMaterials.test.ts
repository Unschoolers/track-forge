import { describe, expect, it } from 'vitest'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { buildBridgePresentation, type BridgePolygonPrimitive } from '@/phaser/rendering/bridgeRenderer'
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
