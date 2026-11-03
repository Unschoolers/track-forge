export function formatRaceTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.---'
  const minutes = Math.floor(seconds / 60)
  const wholeSeconds = Math.floor(seconds % 60)
  const milliseconds = Math.floor(
    (seconds - Math.floor(seconds)) * 1000 + 1e-6,
  )
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}
