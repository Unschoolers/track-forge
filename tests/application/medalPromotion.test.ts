import { describe, expect, it } from 'vitest'
import { promotedTimeMedal } from '@/application/race/raceRecords'

describe('race result medal announcements', () => {
  it('announces a newly earned medal and every improved tier', () => {
    expect(promotedTimeMedal(null, 'bronze')).toBe('bronze')
    expect(promotedTimeMedal('bronze', 'silver')).toBe('silver')
    expect(promotedTimeMedal('silver', 'gold')).toBe('gold')
    expect(promotedTimeMedal(null, 'gold')).toBe('gold')
  })

  it('never re-announces equal or downgraded medals', () => {
    expect(promotedTimeMedal('bronze', 'bronze')).toBeNull()
    expect(promotedTimeMedal('gold', 'silver')).toBeNull()
    expect(promotedTimeMedal('silver', 'bronze')).toBeNull()
    expect(promotedTimeMedal('gold', null)).toBeNull()
    expect(promotedTimeMedal(null, null)).toBeNull()
  })
})
