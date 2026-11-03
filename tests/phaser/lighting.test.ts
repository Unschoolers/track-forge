import { describe, expect, it } from 'vitest'
import type {
  TerrainMaterial,
  TerrainSurface,
} from '@/domain/terrain/terrainSurface'
import type { Vector2 } from '@/domain/model'
import { clamp } from '@/domain/geometry/math'
import { projectSunShadowOntoTerrain } from '@/phaser/rendering/lighting'

function terrainSurface(
  heightAt: (position: Vector2) => number,
  materialAt: (position: Vector2) => TerrainMaterial = () => 'grass',
): TerrainSurface {
  return {
    contours: [],
    heightSampleAt: (position) => ({
      height: heightAt(position),
      gradient: { x: 0, y: 0 },
    }),
    heightAt,
    materialAt,
    gradeAt: () => 0,
  }
}

function expectSelfConsistentProjection(
  surface: TerrainSurface,
  start: Vector2,
  absoluteHeight: number,
): void {
  const projection = projectSunShadowOntoTerrain(
    start,
    absoluteHeight,
    surface,
  )

  expect(projection.terrainHeight).toBeCloseTo(
    surface.heightAt(projection.point),
    5,
  )
  expect(projection.material).toBe(surface.materialAt(projection.point))
  expect(projection.clearance + projection.terrainHeight).toBeCloseTo(
    absoluteHeight,
    4,
  )
}

describe('terrain receiving shadow projection', () => {
  it('converges from ground toward an increasing slope', () => {
    const surface = terrainSurface(({ x }) => clamp(x * 0.5, 0, 24))

    expectSelfConsistentProjection(surface, { x: -20, y: 0 }, 24)
  })

  it('converges from a slope toward its plateau', () => {
    const surface = terrainSurface(({ x }) =>
      clamp(8 + x * 0.5, 0, 24),
    )

    expectSelfConsistentProjection(surface, { x: 0, y: 0 }, 48)
  })

  it('converges across the reverse plateau-to-slope transition', () => {
    const surface = terrainSurface(({ x }) =>
      clamp(24 - x * 0.2, 0, 24),
    )

    expectSelfConsistentProjection(surface, { x: 0, y: 0 }, 48)
  })
})
