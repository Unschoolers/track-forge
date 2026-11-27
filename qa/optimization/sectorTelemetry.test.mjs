import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectorCollector } from './sectorTelemetry.mjs'
const car = { x: 0, y: 0, speed: 60, braking: false, currentSurface: 'street', finishedAt: null }
test('partitions actual brake time and distance at ordered gates', () => {
  const c = sectorCollector()
  const next = { ...car, x: 1, braking: true }
  c.observe(car, next, [])
  c.observe(next, { ...car, x: 2, speed: 120, currentSurface: 'grass' }, [{ lap: 0, gate: 1, time: 2 / 60 }])
  c.observe({ ...car, x: 2 }, { ...car, x: 3 }, [{ lap: 0, gate: 2, time: 3 / 60 }])
  assert.equal(c.sectors[0].averageSpeed, 90)
  assert.equal(c.sectors[0].brakeSeconds, 1 / 60)
  assert.equal(c.sectors[0].grassSeconds, 1 / 60)
  assert.equal(c.sectors[0].distance, 2)
  assert.equal(c.sectors[1].distance, 1)
  assert.equal(c.sectors[1].brakeSeconds, 0)
  assert.ok(Math.abs(c.sectors[1].seconds - 1 / 60) < 1e-9)
})
test('rejects invalid telemetry and ignores already finished cars', () => {
  const c = sectorCollector()
  assert.throws(() => c.observe(car, { ...car, speed: NaN }, []), /Non-finite/)
  c.observe({ ...car, finishedAt: 1 }, car, [{ time: 1 }])
  assert.deepEqual(c.sectors, [])
})
