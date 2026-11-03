import { describe, expect, it } from 'vitest'
import { CAR_IDS } from '@/domain/model'
import {
  calculateGearboxTone,
  gearboxBoundaries,
} from '@/domain/audio/gearbox'

describe('audio gearbox', () => {
  it('gives each car its characteristic gear count', () => {
    expect(gearboxBoundaries('yellow')).toHaveLength(6)
    expect(gearboxBoundaries('blue')).toHaveLength(7)
    expect(gearboxBoundaries('green')).toHaveLength(8)
    expect(gearboxBoundaries('red')).toHaveLength(9)
  })

  it('makes every successive gear cover more vehicle speed', () => {
    for (const car of CAR_IDS) {
      const boundaries = gearboxBoundaries(car)
      const widths = boundaries.slice(1).map(
        (boundary, index) => boundary - (boundaries[index] ?? 0),
      )

      expect(
        widths.every(
          (width, index) =>
            index === 0 || width > (widths[index - 1] ?? 0),
        ),
      ).toBe(true)
      expect((widths.at(-1) ?? 1) / (widths[0] ?? 1)).toBeLessThan(1.4)
    }
  })

  it('drops pitch on an upshift and holds the gear near its boundary', () => {
    const firstShift = gearboxBoundaries('blue')[1] ?? 0
    const before = calculateGearboxTone('blue', firstShift - 0.001, 1)
    const held = calculateGearboxTone(
      'blue',
      firstShift + 0.006,
      1,
      before.gear,
    )
    const after = calculateGearboxTone(
      'blue',
      firstShift + 0.013,
      1,
      before.gear,
    )

    expect(held.gear).toBe(before.gear)
    expect(after.gear).toBe(before.gear + 1)
    expect(after.shift).toBe('up')
    expect(after.frequency).toBeLessThan(before.frequency)
  })

  it('keeps top gear below the normal redline pitch', () => {
    for (const car of CAR_IDS) {
      const boundaries = gearboxBoundaries(car)
      const topGearStart = boundaries.at(-2) ?? 0
      const previousGearAtRedline = calculateGearboxTone(
        car,
        topGearStart - 0.000_001,
        1,
      )
      const maximumSpeed = calculateGearboxTone(car, 1, 1)

      expect(maximumSpeed.gear).toBe(boundaries.length - 2)
      expect(maximumSpeed.revRatio).toBe(1)
      expect(maximumSpeed.frequency).toBeLessThan(
        previousGearAtRedline.frequency * 0.8,
      )
    }
  })

  it('downshifts under heavy cornering load', () => {
    const cruising = calculateGearboxTone('red', 0.9, 1)
    const cornering = calculateGearboxTone(
      'red',
      0.9,
      1,
      cruising.gear,
      1,
    )

    expect(cruising.gear).toBe(7)
    expect(cornering.gear).toBeLessThan(cruising.gear)
    expect(cornering.shift).toBe('down')
  })

  it('clamps external inputs and reports normalized tone values', () => {
    const tone = calculateGearboxTone('red', 4, -2, 99)

    expect(tone.gear).toBe(7)
    expect(tone.revRatio).toBe(1)
    expect(tone.load).toBeGreaterThanOrEqual(0)
    expect(tone.load).toBeLessThanOrEqual(1)
    expect(Number.isFinite(tone.frequency)).toBe(true)
  })
})
