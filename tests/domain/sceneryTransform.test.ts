import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { decodeTrack } from '@/domain/track/trackCodec'
import { describe, expect, it } from 'vitest'
import { createEditorState, reduceEditor } from '@/domain/editor/editorState'
import { normalizeSceneryTransform, stepSceneryScale } from '@/domain/track/sceneryTransform'
import { normalizeSceneryProps } from '@/domain/track/trackEnvironment'

describe('authored scenery transforms', () => {
  it('keeps legacy defaults, canonicalizes a full turn and rejects unsafe sizes', () => {
    expect(normalizeSceneryTransform({})).toEqual({})
    expect(normalizeSceneryTransform({ rotation: 360, scale: 1 })).toEqual({})
    expect(normalizeSceneryTransform({ scale: Infinity })).toBeUndefined()
    expect(normalizeSceneryTransform({ rotation: -1 })).toBeUndefined()
    expect(stepSceneryScale(1, 1)).toBe(1.05)
    expect(stepSceneryScale(1.5, 1)).toBe(1.5)
    expect(stepSceneryScale(0.5, -1)).toBe(0.5)
    expect(normalizeSceneryTransform({ scale: 0.49 })).toBeUndefined()
    expect(normalizeSceneryTransform({ scale: 1.51 })).toBeUndefined()
    expect(normalizeSceneryTransform({ scale: 0.5 })).toEqual({ scale: 0.5 })
    expect(normalizeSceneryTransform({ scale: 1.5 })).toEqual({ scale: 1.5 })
  })

  it('stores a prop transform during normalization', () => {
    const prop = { kind: 'city-house', x: 12, y: 15, rotation: 135, scale: 1.15 }
    expect(normalizeSceneryProps([prop])).toEqual([prop])
  })

  it('round trips authored transformations and rejects invalid imported tree scale', () => {
    const track = { ...createStarterTrack(asTrackId('scenery-transform'), 1),
      environmentId: 'cityscape' as const,
      trees: [{ x: 0, y: 0 }, { x: 80, y: 80, rotation: 33, scale: 1.2 }],
      scenery: [{ kind: 'city-house' as const, x: 150, y: 150, rotation: 270, scale: 0.85 }],
    }
    const decoded = decodeTrack(JSON.parse(JSON.stringify(track)), 1)
    expect(decoded?.trees).toEqual(track.trees)
    expect(decoded?.scenery).toEqual(track.scenery)
    expect(decodeTrack({ ...track, trees: [{ x: 0, y: 0, scale: 500 }] }, 1)).toBeUndefined()
  })

  it('preserves tree transforms on move, undo, redo and reset', () => {
    const original = createEditorState([], [{ x: 0, y: 0 }])
    const changed = reduceEditor(original, { type: 'transform-scenery', target: { type: 'tree', index: 0 }, transform: { rotation: 135, scale: 1.15 } })
    expect(changed.trees[0]).toEqual({ x: 0, y: 0, rotation: 135, scale: 1.15 })
    const moved = reduceEditor(changed, { type: 'move-tree', index: 0, position: { x: 50, y: 50 } })
    expect(moved.trees[0]).toEqual({ x: 50, y: 50, rotation: 135, scale: 1.15 })
    expect(reduceEditor(moved, { type: 'undo' }).trees).toEqual(changed.trees)
    expect(reduceEditor(reduceEditor(moved, { type: 'undo' }), { type: 'redo' }).trees).toEqual(moved.trees)
    expect(reduceEditor(changed, { type: 'transform-scenery', target: { type: 'tree', index: 0 }, transform: {} }).trees).toEqual(original.trees)
  })
})
