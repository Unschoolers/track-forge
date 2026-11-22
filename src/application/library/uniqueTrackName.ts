/** Allocate a case-insensitively unique name within the 32-character track limit. */
export function allocateUniqueTrackName(
  requested: string,
  existingNames: readonly string[],
): string {
  const base = requested.slice(0, 32)
  const existing = new Set(existingNames.map(name => name.toLowerCase()))
  if (!existing.has(base.toLowerCase())) return base
  let number = 2
  while (true) {
    const suffix = ` (${number++})`
    const candidate = base.slice(0, 32 - suffix.length) + suffix
    if (!existing.has(candidate.toLowerCase())) return candidate
  }
}
