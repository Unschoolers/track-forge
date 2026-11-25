import { CAR_SPECS } from '@/domain/config'
import type { DriverInput, RaceState } from '@/domain/race/raceState'
import type { RaceStep } from '@/domain/race/raceEngine'
import type { FeedbackPort } from '@/application/ports/feedback'

/** Translate race state/events to continuous and one-shot feedback commands. */
export function routeRaceFeedback(
  feedback: FeedbackPort,
  state: RaceState,
  events: ReturnType<RaceStep>['events'],
  input: DriverInput,
  peakLanding: number,
): void {
    const player = state.vehicles.find((vehicle) => vehicle.player)
    if (player) {
      const speedRatio = Math.min(
        1,
        player.speed / CAR_SPECS[player.car].max,
      )
      feedback.handle({
        type: 'engine',
        car: player.car,
        speedRatio,
        throttle: player.braking ? 0 : input.throttle,
        cornering: Math.min(1, Math.abs(input.steering)),
      })
      feedback.handle({
        type: 'surface',
        surface: player.currentSurface,
        speedRatio,
      })
      feedback.handle({
        type: 'tire-slip',
        strength: player.slip > 8 ? Math.min(1, player.slip / 80) : 0,
        speedRatio,
        surface: player.currentSurface,
      })
      if (peakLanding > 0.1) {
        feedback.handle({ type: 'landing', strength: peakLanding })
      }
      const rival = state.vehicles
        .filter((vehicle) => !vehicle.player && vehicle.finishedAt === null)
        .map((vehicle) => ({ vehicle, distance: Math.hypot(vehicle.x - player.x, vehicle.y - player.y) }))
        .sort((a, b) => a.distance - b.distance)[0]
      const dx = (rival?.vehicle.x ?? player.x) - player.x
      const dy = (rival?.vehicle.y ?? player.y) - player.y
      feedback.handle({
        type: 'rival',
        proximity: rival ? Math.max(0, 1 - rival.distance / 250) : 0,
        pan: rival && rival.distance > 0 ? Math.max(-1, Math.min(1, (-Math.sin(player.angle) * dx + Math.cos(player.angle) * dy) / rival.distance)) : 0,
        speedRatio: rival ? Math.min(1, rival.vehicle.speed / CAR_SPECS[rival.vehicle.car].max) : 0,
      })
    }
    for (const event of events) {
      if (event.type === 'boost-activated' && event.vehicleId === player?.id) {
        feedback.handle({ type: 'boost-ignition' })
      }
      if (event.type === 'curb-hit' && event.vehicleId === 'player') {
        feedback.handle({
          type: 'curb',
          speed: event.speed,
        })
      }
    }
  }
