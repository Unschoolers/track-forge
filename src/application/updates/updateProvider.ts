/** Distribution-neutral update metadata; Play can provide another UpdateProvider later. */
export interface UpdateInfo {
  readonly version: string
  readonly url: string
  readonly apkUrl: string
}
export interface UpdateProvider {
  check(): Promise<UpdateInfo | null>
}

export interface ReleaseNote {
  readonly version: string
  readonly publishedAt: string | null
  readonly changes: readonly string[]
}
export interface ReleaseNotes {
  readonly fromVersion: string
  readonly toVersion: string
  readonly releases: readonly ReleaseNote[]
  /** False when the GitHub releases history exceeded our pagination limit. */
  readonly complete: boolean
}

const RELEASES_API = 'https://api.github.com/repos/Unschoolers/track-forge/releases'
const RELEASES_PAGE = 'https://github.com/Unschoolers/track-forge/releases/latest'
const TAG_PATTERN = /^android-build-(\d+)-(\d+)$/
const PAGE_SIZE = 100
const MAX_PAGES = 5

function buildId(tag: string): readonly [number, number] | null {
  const match = TAG_PATTERN.exec(tag)
  if (!match) return null
  const run = Number(match[1])
  const attempt = Number(match[2])
  return Number.isSafeInteger(run) && Number.isSafeInteger(attempt) ? [run, attempt] : null
}

function compareBuilds(left: string, right: string): number {
  const a = buildId(left)
  const b = buildId(right)
  if (!a || !b) throw new Error('Invalid Android release version.')
  return a[0] - b[0] || a[1] - b[1]
}

export function isNewerRelease(tag: string, currentRun: number, currentAttempt: number): boolean {
  const id = buildId(tag)
  return id !== null && (id[0] > currentRun || (id[0] === currentRun && id[1] > currentAttempt))
}

/** Parse GitHub-generated "What's Changed" PR titles; never render remote Markdown as HTML. */
export function parseReleaseChanges(body: string): readonly string[] {
  const changes: string[] = []
  let inChanges = false
  for (const line of body.split(/\r?\n/)) {
    if (/^#{1,3}\s+/.test(line)) {
      inChanges = /^#{1,3}\s+what(?:'|’)?s (?:changed|new)\b/i.test(line)
      continue
    }
    if (!inChanges) continue
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line)
    if (!bullet) continue
    const title = bullet[1]!
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+by\s+@[\w-]+\s+in\s+https:\/\/github\.com\/[^\s]+\/pull\/\d+\s*$/i, '')
      .trim()
    if (title && !changes.includes(title)) changes.push(title.slice(0, 240))
  }
  return changes
}

interface GithubRelease {
  readonly tag_name: string
  readonly body?: string | null
  readonly published_at?: string | null
  readonly draft?: boolean
}

function isGithubRelease(value: unknown): value is GithubRelease {
  return value !== null && typeof value === 'object' && 'tag_name' in value &&
    typeof value.tag_name === 'string'
}

export class GitHubUpdateProvider implements UpdateProvider {
  constructor(
    private readonly run: number,
    private readonly attempt: number,
    private readonly fetchRelease: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {}

  private installedVersion(): string {
    if (!Number.isSafeInteger(this.run) || this.run < 1 || !Number.isSafeInteger(this.attempt) || this.attempt < 1) {
      throw new Error('Installed build version is unavailable.')
    }
    return `android-build-${this.run}-${this.attempt}`
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetchRelease(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status}).`)
    return response.json() as Promise<unknown>
  }

  async check(): Promise<UpdateInfo | null> {
    this.installedVersion()
    const release = await this.getJson(`${RELEASES_API}/latest`)
    if (!isGithubRelease(release)) throw new Error('Invalid update response.')
    if (!isNewerRelease(release.tag_name, this.run, this.attempt)) return null
    const apkUrl = `https://github.com/Unschoolers/track-forge/releases/download/${release.tag_name}/trackforge-debug.apk`
    if (!('assets' in release) || !Array.isArray(release.assets) ||
      !release.assets.some((asset: unknown) => asset && typeof asset === 'object' &&
        'name' in asset && asset.name === 'trackforge-debug.apk' &&
        'browser_download_url' in asset && asset.browser_download_url === apkUrl)) {
      throw new Error('The latest release has no verified APK download.')
    }
    return { version: release.tag_name, url: RELEASES_PAGE, apkUrl }
  }

  /** Collect every published build after the installed APK, up to the selected update. */
  async changesSince(targetVersion: string): Promise<ReleaseNotes> {
    const fromVersion = this.installedVersion()
    if (!buildId(targetVersion)) throw new Error('Invalid Android release version.')
    if (compareBuilds(targetVersion, fromVersion) <= 0) {
      return { fromVersion, toVersion: targetVersion, releases: [], complete: true }
    }
    const releases: ReleaseNote[] = []
    let complete = false
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await this.getJson(`${RELEASES_API}?per_page=${PAGE_SIZE}&page=${page}`)
      if (!Array.isArray(data)) throw new Error('Invalid release history response.')
      for (const item of data) {
        if (!isGithubRelease(item) || item.draft || !buildId(item.tag_name)) continue
        if (compareBuilds(item.tag_name, fromVersion) <= 0) {
          complete = true
          continue
        }
        if (compareBuilds(item.tag_name, targetVersion) > 0) continue
        releases.push({
          version: item.tag_name,
          publishedAt: typeof item.published_at === 'string' ? item.published_at : null,
          changes: parseReleaseChanges(typeof item.body === 'string' ? item.body : ''),
        })
      }
      if (complete || data.length < PAGE_SIZE) {
        complete = true
        break
      }
    }
    releases.sort((a, b) => compareBuilds(b.version, a.version))
    return { fromVersion, toVersion: targetVersion, releases, complete }
  }
}
