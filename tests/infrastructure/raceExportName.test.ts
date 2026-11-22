import { describe, expect, it } from 'vitest'
import { raceDiagnosticsFilename } from '@/infrastructure/export/raceExportName'

describe('race diagnostics export naming', () => {
  it('preserves Unicode letters but removes path and file separator characters', () => {
    expect(raceDiagnosticsFilename('Émile / Côte: 2', '2026-11-22T14:01:02.123Z'))
      .toBe('trackforge-race-Émile-Côte-2-2026-11-22T14-01-02-123Z.json')
  })

  it('falls back to a safe name for punctuation-only tracks', () => {
    expect(raceDiagnosticsFilename('../../***', '2026-11-22T14:01:02.123Z'))
      .toBe('trackforge-race-track-2026-11-22T14-01-02-123Z.json')
  })

  it('truncates long track names while keeping the timestamp intact', () => {
    const result = raceDiagnosticsFilename('A'.repeat(80), '2026-11-22T14:01:02.123Z')
    expect(result).toContain('A'.repeat(48))
    expect(result.endsWith('-2026-11-22T14-01-02-123Z.json')).toBe(true)
  })
})
