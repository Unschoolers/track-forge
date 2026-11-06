import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Track } from '@/domain/model'

const nativeExporter = registerPlugin<{
  save(options: { filename: string; content: string }): Promise<{ saved: boolean }>
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
