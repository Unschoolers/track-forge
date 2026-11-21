// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { SceneControllerPort } from '@/phaser/scenes/EditorScene'
import type { RaceSessionPort } from '@/application/race/raceSession'
import type { RaceControlsPort } from '@/application/ports/input'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'

const { sceneStart, sceneStop } = vi.hoisted(() => ({
  sceneStart: vi.fn(),
  sceneStop: vi.fn(),
}))

vi.mock('phaser', () => ({
  default: {
    Game: class {
      scene = { start: sceneStart, stop: sceneStop }
    },
    Scale: { RESIZE: 0, CENTER_BOTH: 0 },
  },
}))
vi.mock('@/phaser/scenes/BootScene', () => ({ BootScene: class {} }))
vi.mock('@/phaser/scenes/EditorScene', () => ({ EditorScene: class {} }))
vi.mock('@/phaser/scenes/RaceScene', () => ({ RaceScene: class {} }))
vi.mock('@/phaser/rendering/racePresentationPreparation', () => ({
  RacePresentationPreparation: class { cancel = vi.fn() },
}))

import { PhaserSceneHost } from '@/phaser/sceneHost'

describe('PhaserSceneHost', () => {
  it('recreates the race scene for a same-track Nearby rematch, but not for countdown or frame updates', () => {
    let runId = 1
    const controller = {
      snapshot: () => ({ currentTrack: { id: 'same-circuit' } }),
    } as unknown as SceneControllerPort
    const raceSession = {
      snapshot: () => ({ runId, setup: { lighting: 'day' } }),
    } as unknown as RaceSessionPort
    const host = new PhaserSceneHost(
      document.createElement('div'),
      controller,
      raceSession,
      {} as RaceControlsPort,
      {} as TrackGeometryService,
    )

    host.start('home')
    host.start('race')
    expect(sceneStart).toHaveBeenCalledWith('RaceScene')
    sceneStart.mockClear()
    sceneStop.mockClear()

    // Normal state / countdown publications must not re-create graphics or inputs.
    host.start('race')
    expect(sceneStart).not.toHaveBeenCalled()
    expect(sceneStop).not.toHaveBeenCalled()

    // Nearby rematches remain on the same screen, circuit and lighting.
    runId += 1
    host.start('race')
    expect(sceneStop).toHaveBeenCalledExactlyOnceWith('RaceScene')
    expect(sceneStart).toHaveBeenCalledExactlyOnceWith('RaceScene')

    sceneStart.mockClear()
    sceneStop.mockClear()
    host.start('race')
    expect(sceneStart).not.toHaveBeenCalled()
    expect(sceneStop).not.toHaveBeenCalled()
  })
})
