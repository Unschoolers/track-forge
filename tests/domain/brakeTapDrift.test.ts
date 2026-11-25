import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { raceVehicleContext } from '@/domain/race/raceVehicleStepper'
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { advanceDriftBoost, DRIFT_BOOST_V1_RULES, initialDriftBoostSnapshot } from '@/domain/race/driftBoost'
import type { DriverInput, RaceVehicle } from '@/domain/race/raceState'

const dt = 1 / 60
const boost = { rules: DRIFT_BOOST_V1_RULES, activated: false, active: false, speedCeilingMultiplier: 1 }

function fixture(speed = 200) {
  const track = createStarterTrack(asTrackId('brake-tap'), 1)
  const race = createRace({
    path: buildRoadPath(track.points, track.terrain),
    playerCar: 'green',
    difficulty: 'normal',
    laps: 1,
    driftBoostRules: DRIFT_BOOST_V1_RULES,
  })
  const player = race.vehicles.find(vehicle => vehicle.player)
  if (!player) throw new Error('Missing player')
  const vehicle: RaceVehicle = {
    ...player, angle: 0, vx: speed, vy: 0, speed,
    grounded: true, contactLoad: 1, currentSurface: 'street', surfaceGrip: 1,
  }
  const context = { ...raceVehicleContext(race, player), surface: 'street' as const,
    onRoad: true, onCurb: false, grade: 0, tangent: { x: 1, y: 0 } }
  const step = (v: RaceVehicle, input: DriverInput, enabled = true) =>
    stepVehicle(v, input, context, dt, undefined, undefined, enabled ? boost : undefined)
  return { vehicle, step }
}

const drive = (steering: number, braking = false): DriverInput =>
  ({ steering, throttle: 1, braking })

describe('arcade brake-tap drift initiation', () => {
  it.each([-1, 1])('turns one short brake tap into genuine boost-qualifying slip in direction %s', direction => {
    const { vehicle, step } = fixture()
    let v = vehicle
    for (let i = 0; i < 6; i++) v = step(v, drive(direction, true))
    expect(v.driftTap?.assistSeconds).toBe(0)
    let charge = initialDriftBoostSnapshot()
    let maxSlip = 0
    for (let i = 0; i < 48; i++) {
      v = step(v, drive(direction))
      const forward = v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle)
      const sideways = -v.vx * Math.sin(v.angle) + v.vy * Math.cos(v.angle)
      maxSlip = Math.max(maxSlip, -direction * Math.atan2(sideways, forward))
      charge = advanceDriftBoost(charge, DRIFT_BOOST_V1_RULES, {
        angle: v.angle, vx: v.vx, vy: v.vy, onRoad: true, grounded: true,
        collision: false, recovering: false, braking: false,
      }, dt).snapshot
    }
    expect(maxSlip).toBeGreaterThan(12 * Math.PI / 180)
    expect(charge.charge).toBeGreaterThan(0)
    v = step(v, drive(direction))
    expect(v.driftTap?.assistSeconds).toBe(0)
  })

  it('does not trigger on sustained braking, straight braking, low speed or ordinary races', () => {
    const { vehicle, step } = fixture()
    let held = vehicle
    for (let i = 0; i < 20; i++) held = step(held, drive(1, true))
    expect(step(held, drive(1)).driftTap?.assistSeconds).toBe(0)
    expect(step(step(vehicle, drive(0, true)), drive(0)).driftTap?.assistSeconds).toBe(0)
    const slow = fixture(60)
    expect(slow.step(slow.step(slow.vehicle, drive(1, true)), drive(1)).driftTap?.assistSeconds).toBe(0)
    const ordinary = step(step(vehicle, drive(1, true), false), drive(1), false)
    expect(ordinary.driftTap).toBeUndefined()
  })

  it('requires a valid turn throughout the tap and a fresh press after cancellation', () => {
    const { vehicle, step } = fixture()
    const straight = step(vehicle, drive(0, true))
    const turning = step(straight, drive(1, true))
    const released = step(turning, drive(1))
    expect(released.driftTap?.assistSeconds).toBe(0)
    const reversed = step(step(vehicle, drive(1, true)), drive(-1))
    expect(reversed.driftTap?.assistSeconds).toBe(0)
    const fresh = step(step(released, drive(1, true)), drive(1))
    expect(fresh.driftTap?.assistSeconds).toBeGreaterThan(0)
  })

  it('ends assistance on countersteering, neutral steering or a new brake press', () => {
    const { vehicle, step } = fixture()
    const active = step(step(vehicle, drive(1, true)), drive(1))
    expect(active.driftTap?.assistSeconds).toBeGreaterThan(0)
    for (const input of [drive(-1), drive(0), drive(1, true)]) {
      expect(step(active, input).driftTap?.assistSeconds).toBe(0)
    }
  })
})
