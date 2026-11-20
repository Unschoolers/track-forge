/** Distribution-neutral update metadata; Play can provide another UpdateProvider later. */
export interface UpdateInfo {
  readonly version: string
  readonly url: string
}
export interface UpdateProvider {
  check(): Promise<UpdateInfo | null>
}

const RELEASES_API = 'https://api.github.com/repos/Unschoolers/track-forge/releases/latest'
const RELEASES_PAGE = 'https://github.com/Unschoolers/track-forge/releases/latest'
const TAG_PATTERN = /^android-build-(\d+)-(\d+)$/

export function isNewerRelease(tag: string, currentRun: number, currentAttempt: number): boolean {
  const match = TAG_PATTERN.exec(tag)
  if (!match) return false
  const run = Number(match[1])
  const attempt = Number(match[2])
  return Number.isSafeInteger(run) && Number.isSafeInteger(attempt) &&
    (run > currentRun || (run === currentRun && attempt > currentAttempt))
}

export class GitHubUpdateProvider implements UpdateProvider {
  constructor(
    private readonly run: number,
    private readonly attempt: number,
    private readonly fetchRelease: typeof fetch = fetch,
  ) {}

  async check(): Promise<UpdateInfo | null> {
    if (!Number.isSafeInteger(this.run) || this.run < 1 || !Number.isSafeInteger(this.attempt) || this.attempt < 1) {
      throw new Error('Installed build version is unavailable.')
    }
    const response = await this.fetchRelease(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status}).`)
    const release: unknown = await response.json()
    if (!release || typeof release !== 'object' || !('tag_name' in release) || typeof release.tag_name !== 'string') {
      throw new Error('Invalid update response.')
    }
    if (!isNewerRelease(release.tag_name, this.run, this.attempt)) return null
    return { version: release.tag_name, url: RELEASES_PAGE }
  }
}
