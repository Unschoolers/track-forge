import { describe, expect, it } from 'vitest'
import { DIFFICULTY_SPECS } from '@/domain/config'
import { CAR_DRIVING_PROFILES } from '@/domain/race/ai/aiCarDrivingProfiles'
import { asTrackId, type DifficultyId } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { EMILE_COURSE } from '@/domain/race/ai/emileRacingLines'
import {
  aiSteeringDifficulty,
  arcadeCornerMargin,
  authoredLineSpeedRatio,
  raceRivalPace,
} from '@/domain/race/ai/difficultyPolicy'

const difficulties: readonly DifficultyId[] = ['easy', 'normal', 'hard']

describe('AI difficulty policy', () => {
  it('keeps distinct legal driver decisions without hard-coding one car\'s tuned values', () => {
    expect(Object.keys(CAR_DRIVING_PROFILES).sort()).toEqual(['blue', 'green', 'red', 'yellow'])
    const signatures = new Set<string>()
    for (const profile of Object.values(CAR_DRIVING_PROFILES)) {
      expect(profile.hardReaction).toBeGreaterThan(0)
      expect(profile.hardSteerGain).toBeGreaterThan(0)
      expect(profile.hardLookAheadSamples).toBeGreaterThan(0)
      expect(profile.hardCornerReserve).toBeGreaterThanOrEqual(0)
      expect(profile.hardCornerReserve).toBeLessThan(0.12)
      signatures.add(JSON.stringify(profile))
    }
    expect(signatures.size).toBe(4)
  })

  it.each(difficulties)('uses Hard technique for %s Arcade or authored-line AI without overwriting the chosen difficulty', difficulty => {
    expect(aiSteeringDifficulty(difficulty, 'arcade', false)).toBe('hard')
    expect(aiSteeringDifficulty(difficulty, 'simulation', true)).toBe('hard')
    expect(aiSteeringDifficulty(difficulty, 'simulation', false)).toBe(difficulty)
  })

  it('keeps authored-line speed targets and non-authored Arcade corner reserves ordered', () => {
    expect(authoredLineSpeedRatio('hard')).toBe(1)
    expect(authoredLineSpeedRatio('hard')).toBeGreaterThan(authoredLineSpeedRatio('normal'))
    expect(authoredLineSpeedRatio('normal')).toBeGreaterThan(authoredLineSpeedRatio('easy'))
    expect(arcadeCornerMargin('hard')).toBe(0)
    expect(arcadeCornerMargin('hard', 'blue')).toBe(0)
    expect(arcadeCornerMargin('hard', 'red')).toBeGreaterThan(0)
    expect(arcadeCornerMargin('hard', 'red')).toBeLessThan(arcadeCornerMargin('normal', 'red'))
    expect(arcadeCornerMargin('hard', 'green')).toBe(CAR_DRIVING_PROFILES.green.hardCornerReserve)
    expect(arcadeCornerMargin('hard', 'green')).toBeLessThan(arcadeCornerMargin('normal', 'green'))
    expect(arcadeCornerMargin('easy')).toBeGreaterThan(arcadeCornerMargin('normal'))
    expect(arcadeCornerMargin('normal')).toBeGreaterThan(arcadeCornerMargin('hard'))
  })

  it('reuses the Hard grid-rival pacing in Arcade but retains the simulation fallback', () => {
    for (const difficulty of difficulties) {
      expect(raceRivalPace(difficulty, 'arcade', 0)).toBe(DIFFICULTY_SPECS.hard.aiPaces[0])
      expect(raceRivalPace(difficulty, undefined, 1)).toBe(DIFFICULTY_SPECS.hard.aiPaces[1])
    }
    expect(raceRivalPace('normal', 'simulation', 0)).toBe(0.985)
    expect(raceRivalPace('easy', 'simulation', 1)).toBe(0.977)
    expect(raceRivalPace('hard', 'simulation', 2)).toBe(DIFFICULTY_SPECS.hard.aiPaces[2])
  })

  it('wires the chosen pace and authored racing line into race initialization, not the car physics specs', () => {
    const starter = createStarterTrack(asTrackId('ai-policy'), 1)
    const path = buildRoadPath(starter.points, starter.terrain)
    for (const difficulty of difficulties) {
      const race = createRace({
        path,
        courseIdentity: EMILE_COURSE,
        playerCar: 'blue',
        difficulty,
        handling: 'arcade',
        laps: 1,
      })
      const rivals = race.vehicles.filter(vehicle => !vehicle.player)
      expect(rivals).toHaveLength(3)
      for (const [index, rival] of rivals.entries()) {
        expect(rival.aiPace).toBe(raceRivalPace(difficulty, 'arcade', index))
        expect(rival.racingLine?.speedRatio).toBe(authoredLineSpeedRatio(difficulty))
      }
    }
  })
})
