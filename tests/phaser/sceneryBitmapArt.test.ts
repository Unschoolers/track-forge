import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { SCENERY_KINDS_BY_ENVIRONMENT, type SceneryProp } from '@/domain/track/trackEnvironment'
import { getTrackEnvironment } from '@/presentation/environments'
import { buildSceneryRenderPlan } from '@/presentation/environments/sceneryPresentation'
import { SCENERY_SPRITE_INDEX, type ScenerySpriteKind } from '@/presentation/environments/sceneryBitmapArt'
import { SceneryRenderer } from '@/phaser/rendering/sceneryRenderer'

const bitmap = {} as HTMLCanvasElement
const bounds = { left: -100, top: -100, right: 100, bottom: 100 }

describe('generated scenery artwork', () => {
  it('maps every existing prop and tree to a unique atlas cell', () => {
    const kinds = Object.values(SCENERY_KINDS_BY_ENVIRONMENT).flat()
    expect(kinds).toHaveLength(18)
    const indices = [...kinds, 'tree' as const].map(kind => SCENERY_SPRITE_INDEX[kind])
    expect(new Set(indices).size).toBe(19)
    expect([...indices].sort((a, b) => a - b)).toEqual(Array.from({ length: 19 }, (_, i) => i))
  })

  it('preserves every prop radius, position, lighting and environment filter', () => {
    const resolve = vi.fn((_kind: ScenerySpriteKind, _night: boolean) => bitmap)
    for (const environment of ['grass', 'desert', 'cityscape', 'kids-room'] as const) {
      const kinds = SCENERY_KINDS_BY_ENVIRONMENT[environment]
      const props = kinds.map(kind => ({ kind, x: 12, y: -17 }))
      const plan = buildSceneryRenderPlan(environment, props, 'night', bounds, resolve)
      expect(plan.sprites).toHaveLength(kinds.length)
      for (const sprite of plan.sprites) {
        const art = getTrackEnvironment(environment).scenery[sprite.kind]
        expect(art).toBeDefined()
        expect(sprite).toMatchObject({ image: bitmap, x: 12, y: -17, size: (art?.radius ?? 0) * 2 })
        expect(resolve).toHaveBeenCalledWith(sprite.kind, true)
      }
    }
    const props: readonly SceneryProp[] = [
      { kind: 'city-building', x: 0, y: 0 },
      { kind: 'city-house', x: 1000, y: 0 },
      { kind: 'desert-cactus', x: 0, y: 0 },
    ]
    const plan = buildSceneryRenderPlan('cityscape', props, 'day', bounds, resolve)
    expect(plan.sprites.map(sprite => sprite.kind)).toEqual(['city-building'])
    expect(plan.primitives).toHaveLength(1)
    expect(resolve).toHaveBeenCalledWith('city-building', false)
    const fallback = buildSceneryRenderPlan('cityscape', props, 'day', bounds, () => undefined)
    expect(fallback.sprites).toHaveLength(0)
    expect(fallback.primitives.length).toBeGreaterThan(1)
  })

  it('reuses sprite objects and textures during drag and releases deleted props', () => {
    const registered = new Set<string>()
    const sprite = {
      setDepth: vi.fn().mockReturnThis(),
      setTexture: vi.fn().mockReturnThis(),
      setPosition: vi.fn().mockReturnThis(),
      setDisplaySize: vi.fn().mockReturnThis(),
      setRotation: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    }
    const scene = {
      textures: {
        exists: vi.fn((key: string) => registered.has(key)),
        addCanvas: vi.fn((key: string) => { registered.add(key); return {} }),
      },
      add: { image: vi.fn(() => sprite) },
    }
    const graphics = {
      scene, depth: -15, clear: vi.fn(), fillStyle: vi.fn(), fillEllipse: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fillPath: vi.fn(),
      save: vi.fn(), restore: vi.fn(), translateCanvas: vi.fn(), rotateCanvas: vi.fn(),
    }
    const renderer = new SceneryRenderer(graphics as unknown as Phaser.GameObjects.Graphics, () => bitmap)
    const view = { centerX: 0, centerY: 0, width: 100, height: 100, zoom: 1, rotation: 0 }
    const props = [{ kind: 'city-building' as const, x: 0, y: 0, rotation: 90, scale: 1.25 }]
    renderer.render(view, 'cityscape', props, false)
    expect(scene.add.image).toHaveBeenCalledTimes(1)
    expect(sprite.setRotation).toHaveBeenLastCalledWith(Math.PI / 2)
    const radius = getTrackEnvironment('cityscape').scenery['city-building']?.radius ?? 0
    expect(sprite.setDisplaySize).toHaveBeenLastCalledWith(radius * 2 * 1.25, radius * 2 * 1.25)
    expect(scene.textures.addCanvas).toHaveBeenCalledTimes(1)
    renderer.render(view, 'cityscape', props, false, { index: 0, position: { x: 20, y: 30 } })
    expect(scene.add.image).toHaveBeenCalledTimes(1)
    expect(scene.textures.addCanvas).toHaveBeenCalledTimes(1)
    expect(sprite.setPosition).toHaveBeenLastCalledWith(20, 30)
    renderer.render(view, 'cityscape', props, true)
    expect(scene.textures.addCanvas).toHaveBeenCalledTimes(2)
    expect(sprite.setTexture).toHaveBeenLastCalledWith('trackforge-scenery-city-building-night')
    renderer.render(view, 'cityscape', [], true)
    expect(sprite.destroy).toHaveBeenCalledTimes(1)
    renderer.render(view, 'cityscape', props, true)
    expect(scene.textures.addCanvas).toHaveBeenCalledTimes(2)
    renderer.destroy()
    expect(sprite.destroy).toHaveBeenCalledTimes(2)
  })
})
