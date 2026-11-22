import { describe, expect, it } from 'vitest'
import { RaceDiagnosticsRecording } from '@/application/race/raceDiagnostics'
import type { RaceResult, RaceSetup } from '@/application/race/raceSession'
import { createRace } from '@/domain/race/raceFactory'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'

const track = createStarterTrack(asTrackId('replay-example'), 2)
const setup: RaceSetup = { car: 'red', difficulty: 'hard', laps: 2, handling: 'arcade', mode: 'normal' }
const result: RaceResult = {
  outcome: 'finished', trackId: track.id, trackName: track.name, playerPlace: 1,
  playerTime: 42, playerWrecked: false, newRecord: true, standings: [], highScores: [],
}
const initial = createRace({
  path: new TrackGeometryService().get(track).path,
  playerCar: setup.car, difficulty: setup.difficulty, laps: setup.laps,
})
const input = { throttle: 1, braking: false, steering: 0.2 }

describe('all-car race diagnostics', () => {
  it('exports a replay with every rival and the exact track independently of the best ghost', () => {
    const recording = new RaceDiagnosticsRecording(initial)
    const next = {
      ...initial, tick: 3, elapsed: 0.05,
      vehicles: initial.vehicles.map(vehicle => ({ ...vehicle, x: vehicle.x + 10, speed: 44 })),
    }
    recording.record(next, [{ type: 'gate-crossed', vehicleId: 'player', gate: 1, lap: 0, time: 0.05 }], input)
    const report = recording.report(track, setup, result)

    expect(report.format).toBe('trackforge-race-replay')
    expect(report.track).toEqual(track)
    expect(report.setup).toEqual(setup)
    expect(report.frames).toHaveLength(2)
    expect(report.frames[1]?.vehicles.map(vehicle => vehicle.id)).toEqual(initial.vehicles.map(vehicle => vehicle.id))
    expect(report.frames[1]?.vehicles.find(vehicle => vehicle.player)?.speed).toBe(44)
    expect(report.frames[1]?.input).toEqual(input)
    expect(report.events[0]?.event.type).toBe('gate-crossed')
    expect(JSON.parse(JSON.stringify(report)).frames).toHaveLength(2)
  })

  it('forces a recovery frame between sample ticks and records the one-off event', () => {
    const recording = new RaceDiagnosticsRecording(initial)
    const moved = { ...initial, tick: 1, elapsed: 1 / 60 }
    recording.record(moved, [{ type: 'vehicle-recovered', vehicleId: 'player', reason: 'off-road', x: 0, y: 0, pathIndex: 0 }], input)
    const report = recording.report(track, setup, result)
    expect(report.frames.map(frame => frame.tick)).toEqual([0, 1])
    expect(report.frames[1]?.vehicles.find(vehicle => vehicle.id === 'player')?.cut).toBe(true)
    expect(report.events.map(item => item.event.type)).toEqual(['vehicle-recovered'])
  })

  it('marks a manual teleport as a cut, records the terminal tick and avoids duplicate timestamps', () => {
    const recording = new RaceDiagnosticsRecording(initial)
    const moved = {
      ...initial, tick: 1, elapsed: 1 / 60,
      vehicles: initial.vehicles.map(vehicle => vehicle.player ? { ...vehicle, x: vehicle.x + 500 } : vehicle),
    }
    recording.manualReset(moved, 'player')
    recording.record(moved, [], input)
    const finish = { ...moved, tick: 2, elapsed: 2 / 60, phase: 'finished' as const }
    recording.record(finish, [{ type: 'race-finished', reason: 'finished' }], input)

    const report = recording.report(track, setup, result)
    expect(report.frames.map(frame => frame.tick)).toEqual([0, 1, 2])
    expect(report.frames[1]?.vehicles.find(vehicle => vehicle.player)?.cut).toBe(true)
    expect(report.events.map(item => item.event.type)).toEqual(['manual-reset', 'race-finished'])
    expect(report.frames[2]?.vehicles).toHaveLength(initial.vehicles.length)
  })
})
