// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type Phaser from 'phaser'
import { renderBoostFlames, renderGhostVehicle, renderNearbyVehicle, renderPlayerTopper } from '@/phaser/rendering/vehicleRenderer'
import { TOPPER_COLORS } from '@/application/multiplayer/playerIdentity'
import { CAR_SPECS } from '@/domain/config'
import { VEHICLE_VISUAL_SCALE } from '@/presentation/vehicleArtwork'
import { getVehicleGeometry } from '@/phaser/rendering/vehicleRenderer'
import type { GhostPose } from '@/application/race/ghostReplay'
import type { RaceVehicle } from '@/domain/race/raceState'

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

describe('drift boost exhaust rendering', () => {
  const vehicle = {
    ...pose, id: 'player', player: true, vx: 0, vy: 0, yawRate: 0, speed: 100,
    slip: 0, braking: false, lane: 0, ai: null, aiPace: 1, pathIndex: 0,
    pathDistance: 0, verticalVelocity: 0, grounded: false,
    suspensionCompression: 0, landingIntensity: 0, contactLoad: 0,
    structureRunId: 'bridge', nextSector: 0, lap: 0,
    currentSurface: 'street', onCurb: false, stuckDuration: 0, finishedAt: null,
    driftBoost: { phase: 'active', charge: 0, remainingTicks: 30 },
  } satisfies RaceVehicle

  it('draws bounded twin flames in the topper color, following pose and elevation', () => {
    const { graphics, calls } = recordingGraphics()
    renderBoostFlames(graphics, { ...vehicle, angle: Math.PI / 2 }, TOPPER_COLORS.violet, 0.5, 18)
    expect(calls).toContainEqual({ name: 'translateCanvas', args: [20, 10] })
    expect(calls).toContainEqual({ name: 'rotateCanvas', args: [Math.PI / 2] })
    expect(calls).toContainEqual({ name: 'scaleCanvas', args: [VEHICLE_VISUAL_SCALE * 1.11, VEHICLE_VISUAL_SCALE * 1.11] })
    const colors = calls.filter(({ name }) => name === 'fillStyle').map(({ args }) => args)
    expect(colors).toEqual([
      [TOPPER_COLORS.violet, 0.55 + 0.3 * 0.5], [0xffffff, 0.5],
      [TOPPER_COLORS.violet, 0.55 + 0.3 * 0.5], [0xffffff, 0.5],
    ])
    expect(calls.filter(({ name }) => name === 'lineTo').every(({ args }) =>
      typeof args[0] === 'number' && args[0] >= -30 && args[0] <= -18,
    )).toBe(true)
  })

  it('produces a brighter and longer initial backfire, then flickers in the topper color', () => {
    const sample = (remainingTicks: number, pulse: number) => {
      const { graphics, calls } = recordingGraphics()
      renderBoostFlames(graphics, {
        ...vehicle, driftBoost: { ...vehicle.driftBoost, remainingTicks },
      }, TOPPER_COLORS.pink, pulse)
      const colors = calls.filter(({ name }) => name === 'fillStyle').map(({ args }) => args)
      const outerTip = calls.find(({ name }) => name === 'lineTo')?.args[0]
      return { colors, outerTip }
    }
    const ignition = sample(60, 0)
    const quiet = sample(30, 0)
    const flicker = sample(30, 1)
    expect(ignition.colors).toContainEqual([TOPPER_COLORS.pink, 0.95])
    expect(quiet.colors).toContainEqual([TOPPER_COLORS.pink, 0.55])
    expect(flicker.colors).toContainEqual([TOPPER_COLORS.pink, 0.55 + 0.3])
    expect(ignition.outerTip).toBeLessThan(Number(flicker.outerTip))
    expect(flicker.outerTip).toBeLessThan(Number(quiet.outerTip))
  })

  it('uses each vehicle artwork taillight pair as its exhaust anchor', () => {
    for (const car of Object.keys(CAR_SPECS) as (keyof typeof CAR_SPECS)[]) {
      const { graphics, calls } = recordingGraphics()
      renderBoostFlames(graphics, { ...vehicle, car }, TOPPER_COLORS.cyan)
      const anchors = calls.filter(({ name }) => name === 'moveTo')
        .filter((_, index) => index % 2 === 0)
        .map(({ args }) => args)
      expect(anchors).toEqual(getVehicleGeometry(car).taillights.map(({ x, y }) => [x - 1, y - 2.2]))
    }
  })

  it('draws nothing when boost is inactive or the vehicle is not the player', () => {
    const { graphics, calls } = recordingGraphics()
    renderBoostFlames(graphics, { ...vehicle, driftBoost: { ...vehicle.driftBoost, phase: 'returning' } }, TOPPER_COLORS.violet)
    renderBoostFlames(graphics, { ...vehicle, player: false }, TOPPER_COLORS.violet)
    expect(calls).toEqual([])
  })
})
