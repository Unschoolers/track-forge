// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type Phaser from 'phaser'
import { renderGhostVehicle, renderNearbyVehicle, renderPlayerTopper } from '@/phaser/rendering/vehicleRenderer'
import { TOPPER_COLORS } from '@/application/multiplayer/playerIdentity'
import { CAR_SPECS } from '@/domain/config'
import { VEHICLE_VISUAL_SCALE } from '@/presentation/vehicleArtwork'
import type { GhostPose } from '@/application/race/ghostReplay'

function recordingGraphics() {
  const calls: { name: string; args: unknown[] }[] = []
  const graphics: Record<string, (...args: unknown[]) => void> = {}
  for (const name of ['save', 'restore', 'translateCanvas', 'rotateCanvas', 'fillStyle', 'fillEllipse',
    'fillCircle', 'fillRect', 'scaleCanvas', 'lineStyle', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fillPath', 'strokePath']) {
    graphics[name] = (...args: unknown[]) => { calls.push({ name, args }) }
  }
  return { graphics: graphics as unknown as Phaser.GameObjects.Graphics, calls }
}

const pose: GhostPose = {
  car: 'red', t: 0, x: 20, y: 10, z: 0, angle: 0,
  structureRunId: null,
  identity: { icon: 'diamond', color: 'violet' },
}

describe('nearby player topper rendering', () => {
  it('draws a solid rival in its original car color with a colored topper', () => {
    const { graphics, calls } = recordingGraphics()
    renderNearbyVehicle(graphics, pose)
    const colors = calls.filter(({ name }) => name === 'fillStyle').map(({ args }) => args)
    expect(colors).toContainEqual([Number.parseInt(CAR_SPECS.red.color.slice(1), 16), 1])
    expect(colors).toContainEqual([TOPPER_COLORS.violet, 1])
    expect(calls.some(({ name }) => name === 'lineStyle')).toBe(true)
    expect(calls).toContainEqual({
      name: 'scaleCanvas', args: [VEHICLE_VISUAL_SCALE, VEHICLE_VISUAL_SCALE],
    })
  })

  it('keeps recorded solo ghosts translucent and without a topper', () => {
    const { graphics, calls } = recordingGraphics()
    renderGhostVehicle(graphics, pose)
    const colors = calls.filter(({ name }) => name === 'fillStyle').map(({ args }) => args)
    expect(colors).toContainEqual([0x99ecff, 0.28])
    expect(colors).not.toContainEqual([TOPPER_COLORS.violet, 1])
    expect(calls.some(({ name }) => name === 'lineStyle')).toBe(false)
    expect(calls).toContainEqual({
      name: 'scaleCanvas', args: [VEHICLE_VISUAL_SCALE, VEHICLE_VISUAL_SCALE],
    })
  })

  it('draws the remembered local topper independently from the car', () => {
    const { graphics, calls } = recordingGraphics()
    renderPlayerTopper(graphics, pose, { icon: 'ball', color: 'pink' })
    expect(calls.filter(({ name }) => name === 'fillStyle').map(({ args }) => args))
      .toContainEqual([TOPPER_COLORS.pink, 1])
    expect(calls).toContainEqual({
      name: 'scaleCanvas', args: [VEHICLE_VISUAL_SCALE, VEHICLE_VISUAL_SCALE],
    })
  })
})
