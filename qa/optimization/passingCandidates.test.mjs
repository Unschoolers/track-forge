import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generatePassingCandidates } from './passingCandidates.mjs'
import { assessCandidate, trialKey } from './score.mjs'

const baseline = {
  triggerDistanceScale: 1, passSpeedAdvantage: 0,
  abandonAfterSeconds: 8, rejoinClearSeconds: 0.25,
}
test('passing candidates are car-scoped, deterministic and distinct from steering search', () => {
  const red = generatePassingCandidates('red', baseline, 12)
  const yellow = generatePassingCandidates('yellow', baseline, 12)
  assert.deepEqual(red, generatePassingCandidates('red', baseline, 12))
  assert.equal(red.length, 12)
  assert.equal(yellow.length, 12)
  assert.ok(red.every(x => x.car === 'red' && x.id.startsWith('pass-red-')))
  assert.ok(yellow.every(x => x.car === 'yellow' && x.id.startsWith('pass-yellow-')))
  assert.ok(red.every(x => Object.keys(x.changes).every(key => Object.hasOwn(baseline, key))))
  assert.throws(() => generatePassingCandidates('red', baseline, 0), /Candidates/)
  assert.throws(() => generatePassingCandidates('purple', baseline, 8), /Unknown car/)
})
test('matched duet keys do not collide with road-line trials or different opponents', () => {
  const task = {
    car: 'red', playerCar: 'red', seed: 1, mode: 'duel',
    scenarioId: 'kids-room', focusRole: 'player', difficulty: 'hard',
    opponentCar: 'green', policyKind: 'passing',
  }
  assert.notEqual(trialKey(task), trialKey({ ...task, policyKind: 'driving' }))
  assert.notEqual(trialKey(task), trialKey({ ...task, opponentCar: 'yellow' }))
  assert.notEqual(trialKey(task), trialKey({ ...task, mode: 'solo', opponentCar: undefined }))
})
