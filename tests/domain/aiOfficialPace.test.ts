// @vitest-environment node
import { expect, it } from 'vitest'
import { CAR_IDS, type CarId } from '@/domain/model'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'

// Cover every car on every official course at Hard pace.
const courses = OFFICIAL_CIRCUITS.map(({ track }) => ({
  name: track.name,
  path: prepareLanePath(track),
}))

function finishTime(
  course: (typeof courses)[number],
  car: CarId,
): number {
  const run = runLaneCheck({
    path: course.path,
    trackName: course.name,
    seed: 1,
    difficulty: 'hard',
    car,
    mode: 'solo',
    reversed: false,
    seconds: 120,
    laps: 1,
  })
  expect(run.stoppedReason, `${course.name} / ${car} / hard`).toBe('finished')
  const finish = run.vehicles[0]?.finishedAt
  expect(finish, `${course.name} / ${car} / hard`).toBeTypeOf('number')
  if (finish === null || finish === undefined) throw new Error('Finished race has no finish time')
  return finish
}

it.each(courses)('$name: every car finishes at Hard', (course) => {
  for (const car of CAR_IDS) finishTime(course, car)
}, 120_000)
