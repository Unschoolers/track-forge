import { parseTrackImport } from '@/application/library/trackImport'
import type { Track } from '@/domain/model'
import { TRACK_EXPORT_FORMAT, TRACK_EXPORT_FORMAT_VERSION } from '@/domain/track/trackCodec'
import { Packet } from './raceWire'

const CHUNK_BYTES = 16_000
const MAX_TRACK_BYTES = 2_000_000
const MAX_COMPRESSED_BYTES = MAX_TRACK_BYTES + 4096
export const MAX_TRACK_CHUNKS = Math.ceil(MAX_COMPRESSED_BYTES / CHUNK_BYTES)

export async function packTrack(track: Track): Promise<Uint8Array[]> {
  const input = JSON.stringify({ format: TRACK_EXPORT_FORMAT, formatVersion: TRACK_EXPORT_FORMAT_VERSION, track })
  const bytes = new TextEncoder().encode(input)
  if (bytes.length > MAX_TRACK_BYTES) throw new Error('This track is too large for Nearby Race.')
  const packed = new Uint8Array(await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer())
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < packed.length; offset += CHUNK_BYTES) {
    const chunk = packed.subarray(offset, offset + CHUNK_BYTES)
    const packet = new Uint8Array(3 + chunk.length)
    packet.set([Packet.Track, chunks.length, Math.ceil(packed.length / CHUNK_BYTES)])
    packet.set(chunk, 3)
    chunks.push(packet)
  }
  return chunks
}

export class TrackReceiver {
  private readonly chunks = new Map<number, Uint8Array>()
  private count: number | undefined

  async receive(packet: Uint8Array<ArrayBuffer>): Promise<Track | null> {
    const index = packet[1]
    const count = packet[2]
    if (index === undefined || count === undefined || count > MAX_TRACK_CHUNKS || index >= count ||
        packet.length <= 3 || packet.length > 3 + CHUNK_BYTES ||
        (this.count !== undefined && this.count !== count)) throw new Error('Invalid nearby track transfer.')
    this.count = count
    this.chunks.set(index, packet.subarray(3))
    if (this.chunks.size !== count) return null
    const parts = Array.from({ length: count }, (_, i) => this.chunks.get(i)!)
    this.chunks.clear()
    const reader = new Blob(parts).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let content = ''
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_TRACK_BYTES) throw new Error('Nearby track exceeds the maximum size.')
        content += decoder.decode(value, { stream: true })
      }
      const imported = parseTrackImport(content + decoder.decode())
      if (!imported.ok) throw new Error(imported.message)
      return imported.track
    } finally {
      await reader.cancel()
    }
  }
}
