export const STORAGE_KEYS = {
  tracks: 'trackforge-library-v2',
  legacyTracks: 'trackforge-library-v1',
  trackMigration: 'trackforge-library-v1-migrated',
  legacyAutosaves: [
    'trackforge-autosave-v2',
    'trackforge-manual-v2',
  ],
  scores: 'trackforge-highscores-v2',
  legacyScores: 'trackforge-highscores-v1',
  scoreMigration: 'trackforge-highscores-v1-migrated',
  car: 'trackforge-last-car',
  difficulty: 'trackforge-difficulty',
  lighting: 'trackforge-lighting',
  audio: 'trackforge-audio-enabled',
  haptics: 'trackforge-haptics-enabled',
  dynamicZoom: 'trackforge-dynamic-zoom',
} as const
