import { describe, expect, it } from 'vitest'
import { runPlayerBalanceMatrix, runPlayerBalanceProbe } from '../../qa/lanes/balancePlayerProbes'

describe('player balance probes', () => {
  it('measures every car on each road with finite, repeatable results', () => {
    const matrix = runPlayerBalanceMatrix()
    expect(matrix).toHaveLength(12)
    expect(new Set(matrix.map(row => `${row.car}/${row.surface}`)).size).toBe(12)
    expect(matrix).toEqual(runPlayerBalanceMatrix())
    for (const row of matrix) {
      expect(row.acceleration.distanceAt8s).toBeGreaterThan(row.acceleration.distanceAt1_5s)
      expect(row.acceleration.speedAt8s).toBeGreaterThan(0)
      expect(row.braking.stopped).toBe(true)
      expect(row.braking.distance).toBeGreaterThan(0)
      expect(row.cornering.lateralDistance).toBeGreaterThan(0)
      for (const group of [row.acceleration, row.braking, row.cornering]) {
        for (const value of Object.values(group)) {
          if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
        }
      }
    }
  })

  it('captures known speed and surface differences without relying on AI', () => {
    const redStreet = runPlayerBalanceProbe('red', 'street')
    const blueStreet = runPlayerBalanceProbe('blue', 'street')
    const redIce = runPlayerBalanceProbe('red', 'ice')
    expect(redStreet.acceleration.speedAt8s).toBeGreaterThan(blueStreet.acceleration.speedAt8s)
    expect(redIce.braking.distance).toBeGreaterThan(redStreet.braking.distance)
  })
})
