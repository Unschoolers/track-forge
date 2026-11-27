import { describe, expect, it, vi } from 'vitest'

vi.mock('@/presentation/environments/sceneryBitmapArt', () => ({
  getSceneryAtlas: () => undefined,
}))
vi.mock('@/presentation/environments/meadowBitmapArt', () => ({
  getMeadowBitmapArt: () => undefined,
}))

import { renderTrees } from '@/phaser/rendering/treeRenderer'

describe('tree renderer viewport refresh', () => {
  it('replaces prior shadow commands when the visible tree window changes', () => {
    let commands: number[][] = []
    let clearCount = 0
    const graphics = {
      depth: 1,
      scene: {},
      clear() {
        clearCount += 1
        commands = []
      },
      fillStyle() {},
      fillEllipse(x: number, y: number, width: number, height: number) {
        commands.push([x, y, width, height])
      },
    }

    renderTrees(graphics as never, [{ x: 50, y: 50 }], false, undefined, 'desert', {
      left: 0, top: 0, right: 100, bottom: 100,
    })
    expect(commands).toHaveLength(3)

    renderTrees(graphics as never, [{ x: 50, y: 50 }, { x: 500, y: 500 }], false, undefined, 'desert', {
      left: 450, top: 450, right: 550, bottom: 550,
    })

    expect(clearCount).toBe(2)
    expect(commands).toHaveLength(3)
    expect(commands.every(([x]) => x !== undefined && x > 450)).toBe(true)
  })
})
