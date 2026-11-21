import { afterEach, expect, it, vi } from 'vitest'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'
import { shareTrack } from '@/infrastructure/export/trackExport'

const track = createStarterTrack(asTrackId('share'), 1)
afterEach(() => vi.unstubAllGlobals())

it('shares a portable track file with the challenge text', async () => {
  let payload: ShareData | undefined
  vi.stubGlobal('navigator', { canShare: () => true, share: async (data: ShareData) => { payload = data } })
  expect(await shareTrack(track, 'Beat my time')).toBe(true)
  expect(payload?.text).toBe('Beat my time')
  expect(payload?.files?.[0]?.name).toMatch(/\.trackforge\.json$/)
})

it('returns false when sharing fails and true when the user cancels', async () => {
  vi.stubGlobal('navigator', { canShare: () => true, share: async () => { throw new Error('unavailable') } })
  expect(await shareTrack(track)).toBe(false)
  vi.stubGlobal('navigator', { canShare: () => true, share: async () => { throw new DOMException('Canceled', 'AbortError') } })
  expect(await shareTrack(track)).toBe(true)
})

it('rejects sharing a system-owned seeded circuit before opening the platform share sheet', async () => {
  const openShare = vi.fn()
  vi.stubGlobal('navigator', { canShare: () => true, share: openShare })
  const seeded = { ...track, origin: 'seeded' as const,
    creator: { id: 'trackforge-system', name: 'Track Forge' } }
  await expect(shareTrack(seeded)).rejects.toThrow('Built-in tracks cannot be shared.')
  expect(openShare).not.toHaveBeenCalled()
})
