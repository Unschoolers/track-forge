export type TrackNameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string }

export function normalizeTrackName(value: string): TrackNameResult {
  const name = value.replace(/\s+/g, ' ').trim().slice(0, 32)
  return name.length > 0
    ? { ok: true, name }
    : { ok: false, message: 'Enter a track name.' }
}
