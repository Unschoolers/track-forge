import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Track } from '@/domain/model'

const nativeExporter = registerPlugin<{
  save(options: { filename: string; content: string }): Promise<{ saved: boolean }>
  share(options: { filename: string; content: string; text?: string }): Promise<{ shared: boolean }>
}>('TrackExport')

export function serializeTrack(track: Track): { filename: string; content: string } {
  const name = track.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'track'
  return {
    filename: `${name}.trackforge.json`,
    content: JSON.stringify({ format: 'trackforge-track', formatVersion: 1, track }, null, 2),
  }
}

export async function exportTrack(track: Track): Promise<boolean> {
  const file = serializeTrack(track)
  if (Capacitor.isNativePlatform()) return (await nativeExporter.save(file)).saved
  const url = URL.createObjectURL(new Blob([file.content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

/** Returns false when sharing is unavailable so the caller can offer a file export. */
export async function shareTrack(track: Track, text?: string): Promise<boolean> {
  const file = serializeTrack(track)
  if (Capacitor.isNativePlatform()) return (await nativeExporter.share({ ...file, ...(text === undefined ? {} : { text }) })).shared
  const attachment = new File([file.content], file.filename, { type: 'application/json' })
  try {
    if (!navigator.share || !navigator.canShare?.({ files: [attachment] })) return false
    await navigator.share({ title: 'Track Forge challenge', ...(text === undefined ? {} : { text }), files: [attachment] })
    return true
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError'
  }
}
