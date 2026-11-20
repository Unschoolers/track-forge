import { describe, expect, it, vi } from 'vitest'
import { GitHubUpdateProvider, isNewerRelease } from '@/application/updates/updateProvider'

describe('GitHub update checks', () => {
  it('compares run and attempt numerically', () => {
    expect(isNewerRelease('android-build-534-1', 533, 2)).toBe(true)
    expect(isNewerRelease('android-build-533-3', 533, 2)).toBe(true)
    expect(isNewerRelease('android-build-533-1', 533, 2)).toBe(false)
    expect(isNewerRelease('android-build-532-9', 533, 2)).toBe(false)
    expect(isNewerRelease('unexpected', 533, 2)).toBe(false)
  })

  it('returns an update only for a newer release', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'android-build-534-1' }), { status: 200 }))
    const provider = new GitHubUpdateProvider(533, 1, request as typeof fetch)
    expect(await provider.check()).toEqual({
      version: 'android-build-534-1',
      url: 'https://github.com/Unschoolers/track-forge/releases/latest',
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects missing build identity rather than claiming up-to-date', async () => {
    const provider = new GitHubUpdateProvider(Number.NaN, Number.NaN)
    await expect(provider.check()).rejects.toThrow('Installed build version is unavailable')
  })

  it('reports server errors', async () => {
    const provider = new GitHubUpdateProvider(533, 1, async () => new Response('', { status: 503 }))
    await expect(provider.check()).rejects.toThrow('HTTP 503')
  })
})
