// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { GRASS_ENVIRONMENT } from '@/presentation/environments/grass'

describe('Grass environment presentation', () => {
  it('preserves the day and night terrain palettes', () => {
    expect(GRASS_ENVIRONMENT.day).toEqual({
      editorGround: '#2d7344',
      raceGround: '#2d7344',
      flyoverGround: '#568453',
      hillSlope: 0x398858,
      hillPlateau: 0x4c9d63,
      flyoverHill: '#80a66a',
      shorelineLand: 0x83a764,
    })
    expect(GRASS_ENVIRONMENT.night).toEqual({
      editorGround: '#14251b',
      raceGround: '#0e2b1d',
      flyoverGround: '#182d2b',
      hillSlope: 0x1b452a,
      hillPlateau: 0x235433,
      flyoverHill: '#34533f',
      shorelineLand: 0x59715f,
    })
  })
})

import { getTrackEnvironment } from '@/presentation/environments'
import { buildSceneryPresentation } from '@/presentation/environments/sceneryPresentation'
import { getEnvironmentTileImage } from '@/presentation/environments/environmentTileImage'
import { vi } from 'vitest'

describe('themed environment presentation', () => {
  it('resolves themes and culls authored scenery while preserving world positions', () => {
    expect(getTrackEnvironment().day).toEqual(GRASS_ENVIRONMENT.day)
    const props = [
      { kind: 'city-building' as const, x: 100, y: 200 },
      { kind: 'desert-cactus' as const, x: 100, y: 200 },
      { kind: 'city-building' as const, x: 2000, y: 2000 },
    ]
    const bounds = { left: 0, top: 0, right: 400, bottom: 400 }
    const day = buildSceneryPresentation('cityscape', props, 'day', bounds)
    const night = buildSceneryPresentation('cityscape', props, 'night', bounds)
    expect(day.length).toBeGreaterThan(0)
    expect(night.length).toBe(day.length)
    expect(day).not.toEqual(night)
    expect(day).toEqual(buildSceneryPresentation('cityscape', props.slice(0, 1), 'day', bounds))
    const shifted = buildSceneryPresentation('cityscape', [{ kind: 'city-building', x: 200, y: 200 }], 'day', bounds)
    const shiftedShadow = shifted[0]
    const dayShadow = day[0]
    expect(shiftedShadow?.kind).toBe('ellipse')
    if (shiftedShadow?.kind === 'ellipse' && dayShadow?.kind === 'ellipse') expect(shiftedShadow.x - dayShadow.x).toBe(100)
  })

  it('caches bounded patterned tile images independently by theme and lighting', () => {
    const context = { beginPath: vi.fn(), ellipse: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), set fillStyle(_value: string) {}, set globalAlpha(_value: number) {} }
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const image = getEnvironmentTileImage('cityscape', 0, false)
    expect(image.width).toBe(384)
    expect(getEnvironmentTileImage('cityscape', 0, false)).toBe(image)
    expect(getEnvironmentTileImage('cityscape', 0, true)).not.toBe(image)
    expect(getEnvironmentTileImage('desert', 0, false)).not.toBe(image)
    getContext.mockRestore()
  })
})

import { SCENERY_KINDS_BY_ENVIRONMENT } from '@/domain/track/trackEnvironment'
import { visibleGroundTilesForViewport } from '@/presentation/environments/groundTexture'

it('provides day and night artwork for every selectable prop', () => {
  expect(SCENERY_KINDS_BY_ENVIRONMENT.grass).toHaveLength(4)
  for (const id of ['grass', 'cityscape', 'desert'] as const) {
    const environment = getTrackEnvironment(id)
    for (const kind of SCENERY_KINDS_BY_ENVIRONMENT[id]) {
      const art = environment.scenery[kind]
      expect(art?.radius).toBeGreaterThan(0)
      expect(art?.day.length).toBeGreaterThan(0)
      expect(art?.night.length).toBe(art?.day.length)
    }
  }
})

it('places grass props with the standard day/night scenery rendering and viewport culling', () => {
  const bounds = { left: 0, top: 0, right: 200, bottom: 200 }
  for (const kind of SCENERY_KINDS_BY_ENVIRONMENT.grass) {
    const props = [{ kind, x: 60, y: 60 }, { kind, x: 1200, y: 1200 }]
    const day = buildSceneryPresentation('grass', props, 'day', bounds)
    const night = buildSceneryPresentation('grass', props, 'night', bounds)
    expect(day.length).toBeGreaterThan(1)
    expect(night.length).toBe(day.length)
    expect(day).toEqual(buildSceneryPresentation('grass', props.slice(0, 1), 'day', bounds))
    expect(night).not.toEqual(day)
  }
})

it('keeps tile patterns stable across shifted and rotated camera windows', () => {
  const view = { centerX: -100, centerY: -100, width: 500, height: 300, zoom: 1, rotation: 0 }
  const first = visibleGroundTilesForViewport(view)
  const second = visibleGroundTilesForViewport({ ...view, centerX: -80, rotation: Math.PI / 6 })
  expect(first.length).toBeGreaterThan(0)
  expect(second.length).toBeLessThanOrEqual(64)
  for (const tile of first) {
    const overlap = second.find((other) => other.x === tile.x && other.y === tile.y)
    if (overlap) expect(overlap.variant).toBe(tile.variant)
  }
})
