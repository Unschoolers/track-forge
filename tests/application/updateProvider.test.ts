import { describe, expect, it, vi } from 'vitest'
import { GitHubUpdateProvider, isNewerRelease, parseReleaseChanges } from '@/application/updates/updateProvider'

describe('GitHub update checks', () => {
  it('compares run and attempt numerically', () => {
    expect(isNewerRelease('android-build-534-1', 533, 2)).toBe(true)
    expect(isNewerRelease('android-build-533-3', 533, 2)).toBe(true)
    expect(isNewerRelease('android-build-533-1', 533, 2)).toBe(false)
    expect(isNewerRelease('android-build-532-9', 533, 2)).toBe(false)
    expect(isNewerRelease('unexpected', 533, 2)).toBe(false)
  })

  it('returns an update only for a newer release', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'android-build-534-1', assets: [{ name: 'trackforge-debug.apk', browser_download_url: 'https://github.com/Unschoolers/track-forge/releases/download/android-build-534-1/trackforge-debug.apk' }] }), { status: 200 }))
    const provider = new GitHubUpdateProvider(533, 1, request as typeof fetch)
    expect(await provider.check()).toEqual({
      version: 'android-build-534-1',
      url: 'https://github.com/Unschoolers/track-forge/releases/latest',
      apkUrl: 'https://github.com/Unschoolers/track-forge/releases/download/android-build-534-1/trackforge-debug.apk',
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects missing build identity rather than claiming up-to-date', async () => {
    const provider = new GitHubUpdateProvider(Number.NaN, Number.NaN)
    await expect(provider.check()).rejects.toThrow('Installed build version is unavailable')
  })

  it('calls the global fetch as a method to support Android WebView', async () => {
    const original = globalThis.fetch
    const fetchMock = vi.fn(function (this: typeof globalThis, _input: RequestInfo | URL, _init?: RequestInit) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(new Response(JSON.stringify({ tag_name: 'android-build-535-1', assets: [{ name: 'trackforge-debug.apk', browser_download_url: 'https://github.com/Unschoolers/track-forge/releases/download/android-build-535-1/trackforge-debug.apk' }] }), { status: 200 }))
    })
    globalThis.fetch = fetchMock as typeof fetch
    try {
      const provider = new GitHubUpdateProvider(534, 1)
      expect((await provider.check())?.version).toBe('android-build-535-1')
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      globalThis.fetch = original
    }
  })

  it('rejects a release without the expected official APK asset', async () => {
    const provider = new GitHubUpdateProvider(533, 1, async () =>
      new Response(JSON.stringify({ tag_name: 'android-build-534-1', assets: [] }), { status: 200 }))
    await expect(provider.check()).rejects.toThrow('no verified APK')
  })

  it('reports server errors', async () => {
    const provider = new GitHubUpdateProvider(533, 1, async () => new Response('', { status: 503 }))
    await expect(provider.check()).rejects.toThrow('HTTP 503')
  })
  it('extracts only PR titles from generated release notes, not build metadata', () => {
    expect(parseReleaseChanges(`TrackForge build 533
## What's Changed
* Fix checkpoints missed at an angle by @dev in https://github.com/Unschoolers/track-forge/pull/150
* [Improve tire grip](https://github.com/Unschoolers/track-forge/pull/151)
## New Contributors
* @dev made their first contribution
### Build details
Commit: abc123`)).toEqual(['Fix checkpoints missed at an angle', 'Improve tire grip'])
    expect(parseReleaseChanges('TrackForge build 533 (Android version code 1000).')).toEqual([])
  })

  it('collects and sorts all published changes newer than the installed build', async () => {
    const releases = [
      { tag_name: 'android-build-535-1', published_at: '2026-11-21T10:00:00Z', body: "## What's Changed\\n* New race camera" },
      { tag_name: 'android-build-533-2', body: 'TrackForge 2.0.533.2 (build details only)' },
      { tag_name: 'android-build-534-1', body: "## What's Changed\\n* Better braking\\n* Better steering" },
      { tag_name: 'android-build-533-1', body: "## What's Changed\\n* Already installed" },
      { tag_name: 'android-build-532-1', body: "## What's Changed\\n* Too old" },
      { tag_name: 'v2.0', body: 'Other releases' },
    ]
    const request = vi.fn(async () => new Response(JSON.stringify(releases), { status: 200 }))
    const notes = await new GitHubUpdateProvider(533, 1, request as typeof fetch).changesSince('android-build-535-1')
    expect(notes.complete).toBe(true)
    expect(notes.releases.map((note) => note.version)).toEqual([
      'android-build-535-1', 'android-build-534-1', 'android-build-533-2',
    ])
    expect(notes.releases[1]?.changes).toEqual(['Better braking', 'Better steering'])
    expect(notes.releases[2]?.changes).toEqual([])
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects bad release-history responses without treating them as an empty changelog', async () => {
    const provider = new GitHubUpdateProvider(533, 1, async () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 200 }))
    await expect(provider.changesSince('android-build-534-1')).rejects.toThrow('Invalid release history response')
  })

})
