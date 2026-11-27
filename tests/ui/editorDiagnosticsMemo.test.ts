// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSnapshot } from '@/application/appState'
import * as diagnostics from '@/domain/track/trackDiagnostics'
import { createEditorDiagnostics, createEditorDiagnosticsMemo } from '@/ui/editor/editorFrameControls'
import { createEditorState } from '@/domain/editor/editorState'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { asTrackId, type Track } from '@/domain/model'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

const squarePoints = [
  { id: 'a', x: 0, y: 0, surface: 'street' as const },
  { id: 'b', x: 300, y: 0, surface: 'street' as const },
  { id: 'c', x: 300, y: 300, surface: 'street' as const },
  { id: 'd', x: 0, y: 300, surface: 'street' as const },
  { id: 'a-close', x: 0, y: 0, surface: 'street' as const },
]

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: asTrackId('diagnostics-cache'), name: 'Diagnostics Cache', version: 8,
    points: squarePoints, trees: [], terrain: EMPTY_TERRAIN,
    start: { ratio: 0.125, reversed: false }, lighting: 'day',
    createdAt: 1, updatedAt: 1, ...overrides,
  }
}

function snapshot(overrides: Partial<AppSnapshot['editor']> = {}, currentTrack = track()) {
  const editor = {
    ...createEditorState(currentTrack.points, currentTrack.trees, currentTrack.start, currentTrack.terrain, currentTrack),
    ...overrides,
  }
  return { currentTrack, editor } as Pick<AppSnapshot, 'currentTrack' | 'editor'>
}

const geometry = buildTrackGeometry(track())

describe('editor diagnostics memo', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('reuses diagnostics for identical diagnostic inputs and invalidates changed dependencies', () => {
    const analyze = vi.spyOn(diagnostics, 'analyzeTrack')
    const memo = createEditorDiagnosticsMemo()
    const first = snapshot()
    const firstResult = memo.get(first, geometry)

    expect(memo.get(first, geometry)).toBe(firstResult)
    expect(analyze).toHaveBeenCalledOnce()

    const replacements: Array<[Pick<AppSnapshot, 'currentTrack' | 'editor'>, TrackGeometry]> = [
      [{ ...first, editor: { ...first.editor, points: [...first.editor.points] } }, geometry],
      [{ ...first, editor: { ...first.editor, trees: [...first.editor.trees] } }, geometry],
      [{ ...first, editor: { ...first.editor, terrain: { ...first.editor.terrain } } }, geometry],
      [{ ...first, editor: { ...first.editor, start: { ratio: 0.25, reversed: false } } }, geometry],
      [{ ...first, editor: { ...first.editor, routeKind: 'point-to-point' } }, geometry],
      [{ ...first, currentTrack: track({ name: 'Changed track object' }) }, geometry],
      [first, { ...geometry }],
    ]
    for (const [changedState, changedGeometry] of replacements) {
      memo.get(first, geometry)
      memo.get(changedState, changedGeometry)
    }

    expect(analyze).toHaveBeenCalledTimes(replacements.length * 2)
    memo.clear()
    memo.get(first, geometry)
    expect(analyze).toHaveBeenCalledTimes(1 + replacements.length * 2)
  })

  it('returns current repair commands and DOM after track inputs change', () => {
    const analyze = vi.spyOn(diagnostics, 'analyzeTrack')
      .mockImplementation((candidate) => [{
        id: candidate.name,
        severity: 'error',
        message: candidate.name,
        position: { x: 0, y: 0 },
        repair: { type: 'remove-tree', index: candidate.name === 'First' ? 0 : 1 },
      }])
    const memo = createEditorDiagnosticsMemo()
    const first = snapshot({}, track({ name: 'First' }))
    const second = snapshot({}, track({ name: 'Second' }))
    const edit = vi.fn()

    const firstPanel = createEditorDiagnostics(first, { edit }, geometry, memo)
    const secondPanel = createEditorDiagnostics(second, { edit }, geometry, memo)
    expect(firstPanel?.textContent).toContain('First')
    expect(secondPanel?.textContent).toContain('Second')
    secondPanel?.querySelector<HTMLButtonElement>('button')?.click()
    expect(edit).toHaveBeenCalledWith({ type: 'apply-track-repair', repair: { type: 'remove-tree', index: 1 } })
    expect(analyze).toHaveBeenCalledTimes(2)
  })
})
