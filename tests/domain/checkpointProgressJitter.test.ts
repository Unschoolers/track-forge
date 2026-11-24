import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { advanceArcadeTimingGate } from '@/domain/race/arcadeTimingGate'
import { createRace } from '@/domain/race/raceFactory'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

const path = buildRoadPath([
  { x: 0, y: 0, surface: 'street' },
  { x: 850, y: 0, surface: 'street' },
  { x: 850, y: 850, surface: 'street' },
  { x: 0, y: 850, surface: 'street' },
], EMPTY_TERRAIN)

const race = createRace({
  path, recoveryCheckpoints: [0.25], playerCar: 'blue', difficulty: 'normal', laps: 1,
})
const player = race.vehicles[0]
if (!player) throw new Error('Missing player fixture')
const count = path.points.length
const gate = race.timingGates?.[0]
if (gate === undefined) throw new Error('Authored checkpoint not resolved')
const lower = Math.floor(gate)
const a = path.points[lower]
const b = path.points[(lower + 1) % count]
if (!a || !b) throw new Error('Missing checkpoint fixture')
const dx = b.x - a.x
const dy = b.y - a.y
const length = Math.hypot(dx, dy)
if (length <= 0) throw new Error('Degenerate checkpoint fixture')
const tx = dx / length
const ty = dy / length
const gx = a.x + dx * (gate - lower)
const gy = a.y + dy * (gate - lower)
const at = (along: number, lateral = 0) => ({
  x: gx + tx * along - ty * lateral,
  y: gy + ty * along + tx * lateral,
})

describe('arcade checkpoint authority with route-index jitter', () => {
  it('does not falsely flag a checkpoint while the car is still before its painted plane', () => {
    // A nearest-path jump around a bend can read several samples ahead.
    const before = { ...player, ...at(-18), pathIndex: lower + 2, nextSector: 1 as const }
    const after = { ...before, ...at(-4), pathIndex: lower + 4 }
    const result = advanceArcadeTimingGate(race, before, after, 3, true, () => true)
    expect(result.vehicle.nextSector).toBe(1)
    expect(result.missedCheckpoint).toBeUndefined()
  })

  it('still warns when the car actually bypasses a checkpoint outside its stripe', () => {
    const before = { ...player, ...at(-22, 100), pathIndex: lower + 2, nextSector: 1 as const }
    const after = { ...before, ...at(30, 100), pathIndex: lower + 4 }
    const result = advanceArcadeTimingGate(race, before, after, 3, false, () => false)
    expect(result.vehicle.nextSector).toBe(1)
    expect(result.missedCheckpoint).toMatchObject({ gate: 1, remainingSeconds: 2 })
  })

  it('accepts a near-edge circuit pass without accepting a wider off-road shortcut', () => {
    const attempt = (offset: number) => {
      const before = { ...player, ...at(-14, offset), pathIndex: lower, nextSector: 1 as const }
      const after = { ...before, ...at(14, offset), pathIndex: lower + 1 }
      return advanceArcadeTimingGate(race, before, after, 3, false, () => false)
    }

    const forgiven = attempt(ROAD_GEOMETRY.onRoadRadius + ROAD_GEOMETRY.checkpointGrace - 1)
    expect(forgiven.vehicle.nextSector).toBe(2)
    expect(forgiven.missedCheckpoint).toBeUndefined()

    const bypass = attempt(ROAD_GEOMETRY.onRoadRadius + ROAD_GEOMETRY.checkpointGrace + 4)
    expect(bypass.vehicle.nextSector).toBe(1)
    expect(bypass.missedCheckpoint?.gate).toBe(1)
  })

  it('continues awarding an actual centerline crossing even when the path index advances', () => {
    const before = { ...player, ...at(-12), pathIndex: lower, nextSector: 1 as const }
    const after = { ...before, ...at(12), pathIndex: lower + 2 }
    const result = advanceArcadeTimingGate(race, before, after, 3, true, () => true)
    expect(result.vehicle.nextSector).toBe(2)
    expect(result.missedCheckpoint).toBeUndefined()
  })
})
