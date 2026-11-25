import { describe, expect, it } from 'vitest'
import { selectAheadTiles } from '@/phaser/rendering/meadowBitmapRenderer'

const view = {
  centerX: 128,
  centerY: 128,
  width: 400,
  height: 300,
  zoom: 1,
  rotation: -Math.PI / 2,
}

describe('selectAheadTiles', () => {
  it('selects a bounded set of forward tiles and excludes visible tiles', () => {
    const visible = [{ x: 0, y: 0, variant: 0 }]
    const candidates = [
      { x: -1, y: 0, variant: 0 },
      { x: 1, y: 0, variant: 0 },
      { x: 2, y: 0, variant: 0 },
      { x: 0, y: 1, variant: 0 },
      { x: 0, y: 0, variant: 0 },
    ]

    expect(selectAheadTiles(view, visible, candidates, 1)).toEqual([{ x: 1, y: 0, variant: 0 }])
    expect(selectAheadTiles(view, visible, candidates, 0)).toEqual([])
  })

  it('follows the camera heading after rotation', () => {
    const rotated = { ...view, rotation: 0 }
    const candidates = [
      { x: 0, y: -1, variant: 0 },
      { x: 0, y: 1, variant: 0 },
    ]

    expect(selectAheadTiles(rotated, [], candidates, 2)).toEqual([{ x: 0, y: -1, variant: 0 }])
  })
})
