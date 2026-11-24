// @vitest-environment node
import { expect, it } from 'vitest'
import { CAR_IDS, type CarId, type DifficultyId } from '@/domain/model'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

// Cover every car on every official course at Hard pace. Exercise all three
// difficulties on a balanced pair of car specs per course instead of running
// the entire 6 x 4 x 3 integration matrix for a single global median.
const courses = OFFICIAL_CIRCUITS.map(({ track }, index) => ({
  name: track.name,
  path: prepareLanePath(track),
  representativeCars: CAR_IDS.filter((_, carIndex) => carIndex % 2 === index % 2),
}))

function finishTime(
  course: (typeof courses)[number],
  car: CarId,
  difficulty: DifficultyId,
): number {
  const run = runLaneCheck({
    path: course.path,
    trackName: course.name,
    seed: 1,
    difficulty,
    car,
    mode: 'solo',
    reversed: false,
    seconds: 120,
    laps: 1,
  })
  expect(run.vehicles[0]?.recoveries, `${course.name} / ${car} / ${difficulty}`).toBe(0)
  expect(run.stoppedReason, `${course.name} / ${car} / ${difficulty}`).toBe('finished')
  const finish = run.vehicles[0]?.finishedAt
  expect(finish, `${course.name} / ${car} / ${difficulty}`).toBeTypeOf('number')
  if (finish === null || finish === undefined) throw new Error('Finished race has no finish time')
  return finish
}

it.each(courses)('$name: every car finishes at Hard, representative cars keep difficulty order', (course) => {
  for (const car of CAR_IDS) {
    const hard = finishTime(course, car, 'hard')
    if (!course.representativeCars.includes(car)) continue

    const normal = finishTime(course, car, 'normal')
    const easy = finishTime(course, car, 'easy')
    // Simple layouts can yield nearly identical times across difficulties.
    // Only fail a meaningful inversion; the tight-course tests protect
    // noticeable differences in difficulty.
    expect(normal, `${course.name} / ${car}: Normal should not meaningfully beat Hard`).toBeGreaterThanOrEqual(hard * 0.99)
    expect(easy, `${course.name} / ${car}: Easy should not meaningfully beat Normal`).toBeGreaterThanOrEqual(normal * 0.99)
  }
}, 120_000)
