import { describe, expect, it, vi } from 'vitest'
import { EditorSession } from '@/application/editor/editorSession'
import { asTrackId, type Track } from '@/domain/model'
import { decodeTrack } from '@/domain/track/trackCodec'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { createEditorState } from '@/domain/editor/editorState'

const editor = new EditorSession({ save: () => true }, () => 500)
const stored = createStarterTrack(asTrackId('draft-persistence'), 100)

describe('editor draft dirty state', () => {
  it('clears an imported creator replay when its race geometry changes', () => {
    const challenged: Track = { ...stored, creatorChallenge: { car: 'red', laps: 1, time: 1, frames: [
      { t: 0, x: 0, y: 0, angle: 0, z: 0, structureRunId: null },
      { t: 1, x: 1, y: 1, angle: 0, z: 0, structureRunId: null },
    ] } }
    const draft = createEditorState(challenged.points, challenged.trees, challenged.start,
      challenged.terrain, challenged)
    const changed = editor.apply(draft, challenged, { type: 'set-route-kind', routeKind: 'point-to-point' })
    expect('track' in changed ? changed.track?.creatorChallenge : undefined).toBeUndefined()
  })

  it('treats a draft without a persisted baseline as unsaved, rather than silently losing it on exit', () => {
    expect(editor.isDirty(stored, undefined)).toBe(true)
    expect(editor.isDirty(null, undefined)).toBe(false)
  })

  it('recognizes a successful save after the repository normalizes road and scenery fields', () => {
    let persisted: Track | undefined
    const store = { save: vi.fn((track: Track) => {
      persisted = decodeTrack(track, 500)
      return persisted !== undefined
    }) }
    const session = new EditorSession(store, () => 500)
    const draft: Track = {
      ...stored,
      points: [...stored.points, { id: 'new-point', x: 40, y: 90, surface: 'street' }],
      scenery: [{ x: 10, y: 15, kind: 'grass-boulder' }],
    }

    expect(session.isDirty(draft, stored)).toBe(true)
    expect(session.save(draft)).toBe(true)
    expect(persisted?.points.at(-1)).toHaveProperty('structure', 'surface')
    expect(session.isDirty(draft, persisted)).toBe(false)
    expect(session.isDirty({ ...draft, name: 'Changed again' }, persisted)).toBe(true)
  })

  it('ignores timestamp-only changes but detects edits to persisted content', () => {
    expect(editor.isDirty({ ...stored, updatedAt: 500 }, stored)).toBe(false)
    const changed = { ...stored, name: 'Unsaved change', updatedAt: 500 }
    expect(editor.isDirty(changed, stored)).toBe(true)
    expect(editor.isDirty(stored, stored)).toBe(false)
  })
})
