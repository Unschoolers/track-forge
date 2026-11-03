export const legacyTrack = {
  id: 'legacy-harbor',
  name: 'Midnight Harbor',
  version: 5,
  points: [
    { x: 0, y: 0, surface: 'street' },
    { x: 120, y: 0, surface: 'dirt' },
    { x: 120, y: 120, surface: 'ice' },
  ],
  trees: [{ x: 25, y: 40 }],
  timeOfDay: 'night',
  createdAt: 100,
  updatedAt: 200,
} as const

export const legacyScore = {
  time: 42.5,
  car: 'green',
  difficulty: 'hard',
  date: 300,
} as const
