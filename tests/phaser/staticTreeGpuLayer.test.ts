import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { renderStaticTreeCanopies, type TreePrimitive } from '@/phaser/rendering/treeRenderer'

describe('static race tree GPU batches', () => {
  it('uses bounded GPU layers with the same canopy size, origin, position and depth', () => {
    const addMember = vi.fn()
    const layer = { addMember, setDepth: vi.fn().mockReturnThis() }
    const spriteGPULayer = vi.fn(() => layer)
    const scene = { add: { spriteGPULayer } } as unknown as Phaser.Scene
    const canopy: TreePrimitive = {
      layer: 'canopy', x: 12, y: 32, radiusX: 15, radiusY: 15, color: 0xffffff, alpha: 1, baseHeight: 0,
    }
    renderStaticTreeCanopies(scene, 'tree', 68, 34, 5, Array.from({ length: 513 }, () => canopy))
    expect(spriteGPULayer.mock.calls).toEqual([['tree', 512], ['tree', 1]])
    expect(layer.setDepth).toHaveBeenCalledWith(5)
    expect(addMember).toHaveBeenCalledTimes(513)
    expect(addMember).toHaveBeenCalledWith({
      x: 12, y: 32, frame: '__BASE', originX: 0.5, originY: 0.5, scaleX: 0.5, scaleY: 1,
    })
  })
})
