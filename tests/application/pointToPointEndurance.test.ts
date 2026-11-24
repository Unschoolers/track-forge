// @vitest-environment node
import { expect, it } from 'vitest'
import { parseTrackImport } from '@/application/library/trackImport'
import { MAX_GHOST_FRAMES } from '@/application/race/ghostReplay'
import { RaceSession, type RaceMode, type RaceSetup } from '@/application/race/raceSession'
import { applyEditorCommand, createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { validateTrack } from '@/domain/track/trackValidation'
import { serializeTrack } from '@/infrastructure/export/trackExport'
import { BrowserGhostRepository } from '@/infrastructure/storage/ghostRepository'
import { BrowserScoreRepository } from '@/infrastructure/storage/scoreRepository'
import { BrowserTrackRepository } from '@/infrastructure/storage/trackRepository'
import { requireFixture } from '../fixtures/requireFixture'

it('authors, shares and completes a five-minute route in all three modes', () => {
  let editor = createEditorState([], [])
  editor = applyEditorCommand(editor, { type: 'set-route-kind', routeKind: 'point-to-point' }).state
  for (let x = 0; x <= 55_000; x += 5_000) {
    const result = applyEditorCommand(editor, {
      type: 'add-point',
      point: { x, y: 0, surface: 'dirt' },
    })
    expect(result.rejection).toBeNull()
    editor = result.state
  }
  const authored = {
    ...createStarterTrack(asTrackId('endurance-qa'), 1),
    routeKind: editor.routeKind,
    points: editor.points,
    terrain: editor.terrain,
    trees: editor.trees,
  }
  const imported = parseTrackImport(serializeTrack(authored).content)
  if (!imported.ok) throw new Error(imported.message)

  const data = new Map<string, string>()
  const storage = {
    get: (key: string) => data.get(key) ?? null,
    set: (key: string, value: string) => { data.set(key, value); return true },
    remove: (key: string) => data.delete(key),
  }
  const tracks = new BrowserTrackRepository(storage)
  expect(tracks.save(imported.track)).toBe(true)
  const track = requireFixture(tracks.find(imported.track.id))
  const geometry = new TrackGeometryService()
  const course = geometry.get(track)
  expect(course.path.totalLength).toBeCloseTo(55_000)
  expect(course.path.closed).toBe(false)
  expect(course.start.position).toEqual({ x: 0, y: 0 })
  expect(course.finish?.position).toEqual({ x: 55_000, y: 0 })
  expect(validateTrack(track, course.path.totalLength).ready).toBe(true)

  const ghosts = new BrowserGhostRepository(storage)
  const scores = new BrowserScoreRepository(storage)
  const session = new RaceSession({
    geometry, scoreStore: scores, ghostStore: ghosts, random: { next: () => 0.5 },
    feedback: {
      unlock: () => {}, setEnabled: () => {}, handle: () => {},
      silenceContinuous: () => {}, destroy: () => {},
    },
  })
  const setup: RaceSetup = { car: 'red', difficulty: 'hard', laps: 1 }
  const input = { throttle: 1, steering: 0, braking: false }
  expect(session.ghostAvailability(track, setup).kind).toBe('none')

  function run(mode: RaceMode) {
    session.start(track, { ...setup, mode })
    expect(session.snapshot().state?.vehicles).toHaveLength(mode === 'normal' ? 4 : 1)
    for (let frame = 0; frame < 1_400 && !session.snapshot().result; frame += 1) {
      session.advance(0.25, input)
    }
    const finish = requireFixture(session.snapshot().result)
    expect(finish.outcome).toBe('finished')
    const time = requireFixture(finish.playerTime)
    expect(time).toBeGreaterThan(270)
    expect(time).toBeLessThan(330)
    const splits = requireFixture(finish.splits)
    expect(splits.map(({ gate }) => gate)).toEqual([1, 2, 3, 4])
    for (const [index, split] of splits.entries()) {
      expect(split.time).toBeGreaterThan(splits[index - 1]?.time ?? 0)
    }
    expect(splits.at(-1)?.time).toBe(time)
    session.advance(1, input)
    expect(session.snapshot().result).toBe(finish)
    return time
  }

  const time = run('time-trial')
  const replay = requireFixture(ghosts.load(track, setup))
  expect(replay.frames.length).toBeLessThanOrEqual(MAX_GHOST_FRAMES)
  expect(replay.splits).toHaveLength(4)
  expect(run('ghost')).toBe(time)
  expect(session.snapshot().result?.ghostTime).toBe(time)
  run('normal')
  expect(new Set(scores.forTrack(track.id).map(({ category }) => category?.mode)))
    .toEqual(new Set(['time-trial', 'ghost', 'normal']))
  session.restart()
  expect(session.snapshot().setup?.mode).toBe('normal')
  session.destroy()
}, 30_000)
