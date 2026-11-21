import { describe, expect, it, vi } from 'vitest'
import { CAR_IDS } from '@/domain/model'
import { CAR_SPECS } from '@/domain/config'
import {
  drawVehicleArtworkOnCanvas,
  getVehicleArtwork,
  vehiclePaintColor,
  VEHICLE_VISUAL_SCALE,
} from '@/presentation/vehicleArtwork'

describe('distinct car artwork', () => {
  it('applies a purely visual scale without modifying source geometry', () => {
    expect(VEHICLE_VISUAL_SCALE).toBe(0.88)
    expect(getVehicleArtwork('red').body.some(({ x }) => x === 23)).toBe(true)
  })

  it('gives each existing car a unique silhouette without changing its gameplay identity', () => {
    expect(CAR_IDS.map((id) => getVehicleArtwork(id).style))
      .toEqual(['sport', 'muscle', 'rally', 'pickup'])
    expect(new Set(CAR_IDS.map((id) => JSON.stringify(getVehicleArtwork(id).body))).size)
      .toBe(4)
    for (const id of CAR_IDS) {
      const art = getVehicleArtwork(id)
      expect(art.id).toBe(id)
      expect(art.layers.filter(({ tone }) => tone !== 'rubber').length).toBeGreaterThanOrEqual(10)
      expect(art.layers.filter(({ tone }) => tone === 'rubber'))
        .toHaveLength(id === 'yellow' ? 4 : 0)
      expect(art.body.length).toBeGreaterThan(6) // avoid a plain rectangular soapbox
      expect(vehiclePaintColor(id, 'body')).toBe(Number.parseInt(CAR_SPECS[id].color.slice(1), 16))
      expect(getVehicleArtwork(id)).toBe(art) // geometry is never regenerated per frame
    }
  })

  it('makes the pickup bed a visible recess behind a separate cabin, unlike the cars', () => {
    const truck = getVehicleArtwork('yellow')
    const bed = truck.layers.find(({ tone }) => tone === 'bed')
    expect(bed).toBeDefined()
    const cabRear = Math.min(...truck.cabin.map(({ x }) => x))
    const bedFront = Math.max(...(bed?.points ?? []).map(({ x }) => x))
    expect(bedFront).toBeLessThan(cabRear)
    expect(CAR_IDS.filter((id) => getVehicleArtwork(id).layers.some(({ tone }) => tone === 'bed')))
      .toEqual(['yellow'])
  })

  it('keeps visual geometry bounded, valid and fixtures at each vehicle end', () => {
    for (const id of CAR_IDS) {
      const art = getVehicleArtwork(id)
      const points = art.layers.flatMap((layer) => layer.points)
      expect(points.length).toBeGreaterThan(0)
      for (const point of points) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
        expect(Math.abs(point.x)).toBeLessThanOrEqual(26)
        expect(Math.abs(point.y)).toBeLessThanOrEqual(16)
      }
      const nose = Math.max(...art.body.map(({ x }) => x))
      const rear = Math.min(...art.body.map(({ x }) => x))
      expect(art.headlights.every(({ x }) => x >= nose - 4)).toBe(true)
      expect(art.taillights.every(({ x }) => x <= rear + 4)).toBe(true)
    }
  })

  it('renders every authored layer in the canvas flyover, including both fixture pairs', () => {
    for (const id of CAR_IDS) {
      const ctx = {
        beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
        fill: vi.fn(), stroke: vi.fn(), arc: vi.fn(),
      } as unknown as CanvasRenderingContext2D
      drawVehicleArtworkOnCanvas(ctx, id)
      expect(ctx.fill).toHaveBeenCalledTimes(getVehicleArtwork(id).layers.length + 4)
      expect(ctx.arc).toHaveBeenCalledTimes(4)
      expect(ctx.stroke).toHaveBeenCalledTimes(
        getVehicleArtwork(id).layers.filter(({ outline }) => outline).length,
      )
    }
  })
})
