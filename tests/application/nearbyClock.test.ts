import { describe, expect, it, vi } from 'vitest'
import { RaceSession } from '@/application/race/raceSession'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'

const track = createStarterTrack(asTrackId('nearby-clock'), 1)
const setup = { car: 'blue' as const, difficulty: 'normal' as const, laps: 1,
  mode: 'nearby' as const }
const coast = { steering: 0, throttle: 0, braking: false }

function sessionWithClock(readClock: () => number) {
  return new RaceSession({
    scoreStore: { forTrack: () => [], record: () => true, removeTrack: () => true },
    random: { next: () => 0.5 },
    feedback: { unlock: vi.fn(), setEnabled: vi.fn(), handle: vi.fn(),
      silenceContinuous: vi.fn(), destroy: vi.fn() },
    monotonicNow: readClock,
    now: () => 1_000_000_000, // Wall clock deliberately differs.
  })
}

describe('Nearby race monotonic countdown', () => {
  it.each(['staged', 'already-armed'] as const)(
    'uses an injected clock consistently from %s start to GO', mode => {
      let now = 10_000
      const session = sessionWithClock(() => now)
      const startAt = 14_000
      session.start(track, setup, mode === 'already-armed' ? startAt : undefined)
      if (mode === 'staged') {
        session.advance(1, coast)
        expect(session.snapshot().state?.phase).toBe('countdown')
        expect(session.snapshot().state?.elapsed).toBe(0)
        session.scheduleNearbyStart(startAt)
        session.scheduleNearbyStart(startAt + 1000) // Duplicate must not move GO.
      }
      expect(session.snapshot().state?.countdown).toBeCloseTo(4)
      now = 12_500
      session.advance(1 / 60, coast)
      expect(session.snapshot().state?.countdown).toBeCloseTo(1.5)
      expect(session.snapshot().state?.phase).toBe('countdown')
      now = 14_000
      session.advance(1 / 60, coast)
      expect(session.snapshot().state?.phase).toBe('running')
      session.destroy()
    },
  )
})
