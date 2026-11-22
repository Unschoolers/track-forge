/** Filename policy for race diagnostics; keep authored names out of path components. */
export function raceDiagnosticsFilename(trackName: string, capturedAt: string): string {
  const label = trackName.replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'track'
  const timestamp = capturedAt.replace(/[:.]/g, '-')
  return `trackforge-race-${label}-${timestamp}.json`
}
