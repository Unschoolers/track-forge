export function formatRaceTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.---'
  const minutes = Math.floor(seconds / 60)
  const wholeSeconds = Math.floor(seconds % 60)
  const milliseconds = Math.floor(
    (seconds - Math.floor(seconds)) * 1000 + 1e-6,
  )
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}

export function ordinalSuffix(place: number): string {
  if (place % 100 >= 11 && place % 100 <= 13) return 'TH'
  if (place % 10 === 1) return 'ST'
  if (place % 10 === 2) return 'ND'
  if (place % 10 === 3) return 'RD'
  return 'TH'
}

