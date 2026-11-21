/**
 * Creator IDs are stable per installation. Names are editable labels, not ownership proof.
 * Imported creator IDs are attribution only: never use them for authorization.
 */
export interface TrackCreator {
  readonly id: string
  readonly name: string
}

export function normalizeDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim().replace(/\s+/g, ' ')
  return name.length >= 2 && name.length <= 24 &&
    /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u.test(name) ? name : undefined
}

export function normalizeCreatorId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(value)
    ? value : undefined
}

export function normalizeTrackCreator(value: unknown): TrackCreator | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const fields = value as Record<string, unknown>
  const id = normalizeCreatorId(fields.id)
  const name = normalizeDisplayName(fields.name)
  return id && name ? { id, name } : undefined
}
