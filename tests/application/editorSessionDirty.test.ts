import { describe, expect, it } from 'vitest'
import { EditorSession } from '@/application/editor/editorSession'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'

const editor = new EditorSession({ save: () => true }, { schedule: () => () => undefined }, () => 500)
const stored = createStarterTrack(asTrackId('draft-persistence'), 100)

describe('editor draft dirty state', () => {
  it('treats a draft without a persisted baseline as unsaved, rather than silently losing it on exit', () => {
    expect(editor.isDirty(stored, undefined)).toBe(true)
    expect(editor.isDirty(null, undefined)).toBe(false)
  })

  it('ignores timestamp-only changes but detects edits to persisted content', () => {
    expect(editor.isDirty({ ...stored, updatedAt: 500 }, stored)).toBe(false)
    const changed = { ...stored, name: 'Unsaved change', updatedAt: 500 }
    expect(editor.isDirty(changed, stored)).toBe(true)
    expect(editor.isDirty(stored, stored)).toBe(false)
  })
})
