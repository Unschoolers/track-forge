import { describe, expect, it } from 'vitest'
import { allocateUniqueTrackName } from '@/application/library/uniqueTrackName'

describe('copied track name allocation', () => {
  it('keeps an available name and handles duplicates case-insensitively', () => {
    expect(allocateUniqueTrackName('Harbor', ['Meadow'])).toBe('Harbor')
    expect(allocateUniqueTrackName('Harbor', ['harbor'])).toBe('Harbor (2)')
    expect(allocateUniqueTrackName('Harbor', ['HARBOR', 'Harbor (2)'])).toBe('Harbor (3)')
  })

  it('respects 32 characters while generating successive unique suffixes', () => {
    const base = 'A'.repeat(32)
    expect(allocateUniqueTrackName(base, [base])).toBe(`${'A'.repeat(28)} (2)`)
    expect(allocateUniqueTrackName(base, [base, `${'A'.repeat(28)} (2)`]))
      .toBe(`${'A'.repeat(28)} (3)`)
  })

  it('does not mutate existing names', () => {
    const existing = ['Sunset', 'sunset (2)']
    expect(allocateUniqueTrackName('Sunset', existing)).toBe('Sunset (3)')
    expect(existing).toEqual(['Sunset', 'sunset (2)'])
  })
})
