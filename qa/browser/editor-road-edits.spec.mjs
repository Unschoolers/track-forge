import { expect, test } from '@playwright/test'
import { readSavedTracks } from './saved-tracks.mjs'
import { enterTrackForge } from '../enter-game.mjs'
import { contact, releaseTouches, touch } from './touch.mjs'

test('bounds editing work on a course with Sandy Beach-sized terrain and scenery', async ({ page, context }) => {
  const points = Array.from({ length: 21 }, (_, index) => {
    const angle = (index % 20) * Math.PI / 10
    return {
      x: 860 * Math.cos(angle), y: 1050 * Math.sin(angle), surface: 'street',
      structure: index >= 9 && index <= 13 ? 'overpass' : 'surface',
    }
  })
  const cells = Array.from({ length: 3901 }, (_, index) => ({
    column: index % 80 - 40, row: Math.floor(index / 80) - 25, kind: 'hill',
  }))
  const scenery = Array.from({ length: 72 }, (_, index) => ({
    kind: 'desert-cactus', x: index % 12 * 55 - 300, y: Math.floor(index / 12) * 55 - 300,
  }))
  await page.setViewportSize({ width: 844, height: 390 })
  await page.addInitScript(({ points, cells, scenery }) => {
    localStorage.setItem('trackforge-library-v2', JSON.stringify([{
      id: 'road-edit-stress', name: 'Elevated Road Edit', version: 8, points,
      terrain: { cellSize: 32, cells }, trees: [{ x: 50, y: -100 }],
      environmentId: 'desert', scenery, createdAt: 1, updatedAt: 1,
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, { points, cells, scenery })
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.evaluate(async () => {
    const { EditorScene } = await import('/src/phaser/scenes/EditorScene.ts')
    const { EditorTerrainPresentation } = await import('/src/phaser/rendering/editorTerrainPresentation.ts')
    const { TrackGeometryCache } = await import('/src/domain/track/trackGeometryCache.ts')
    const work = { previews: 0, redraws: 0, terrainRedraws: 0, builds: 0, writes: 0 }
    window.roadEditWork = work
    const render = EditorScene.prototype.renderWorldPresentation
    EditorScene.prototype.renderWorldPresentation = function (...args) {
      work.redraws++
      return render.apply(this, args)
    }
    const preview = EditorScene.prototype.renderRoadDragPreview
    EditorScene.prototype.renderRoadDragPreview = function (...args) {
      const previous = this.lastRoadPreview
      preview.apply(this, args)
      if (this.lastRoadPreview && previous !== this.lastRoadPreview) work.previews++
    }
    const terrain = EditorTerrainPresentation.prototype.renderTerrain
    if (typeof terrain !== 'function') throw new Error('Missing terrain redraw instrumentation target')
    EditorTerrainPresentation.prototype.renderTerrain = function (...args) {
      work.terrainRedraws++
      return terrain.apply(this, args)
    }
    const cache = TrackGeometryCache.prototype.set
    TrackGeometryCache.prototype.set = function (...args) {
      work.builds++
      return cache.apply(this, args)
    }
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'tracks' && this.transaction.db.name === 'trackforge-track-library') work.writes++
      return put.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'Track editor', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Elevated Road Edit', exact: true }).click()
  const work = () => page.evaluate(() => window.roadEditWork)
  const read = () => page.evaluate(() => window.__trackForgeQa.snapshot())
  const draft = () => page.evaluate(() => window.__trackForgeQa.snapshot().editor.controlPoints)
  const saved = async () => (await readSavedTracks(page)).find(track => track.id === 'road-edit-stress').points
  const initiallySaved = await saved()
  await expect.poll(async () => (await work()).redraws).toBeGreaterThan(0)
  const expectEditWork = async (before) => {
    const after = await work()
    expect(after.redraws - before.redraws).toBe(1)
    expect(after.builds - before.builds).toBeLessThanOrEqual(1)
    expect(after.writes - before.writes).toBe(0)
  }
  const canvas = await page.locator('#game-container canvas').boundingBox()
  const x = canvas.x + canvas.width / 2
  const y = canvas.y + canvas.height / 2
  const pointer = await context.newCDPSession(page)
  try {
    const camera = (await read()).camera
    const last = points.at(-1)
    const endX = x + (last.x - camera.x) * camera.zoom
    const endY = y + (last.y - camera.y) * camera.zoom
    const drawPoint = await page.evaluate(({ endX, endY }) => {
      const canvas = document.querySelector('#game-container canvas')
      return [[60, 0], [-60, 0], [0, 60], [0, -60], [45, 45], [-45, -45]]
        .map(([dx, dy]) => ({ x: endX + dx, y: endY + dy }))
        .find(({ x, y }) => document.elementFromPoint(x, y) === canvas)
    }, { endX, endY })
    expect(drawPoint).toBeDefined()
    let before = await work()
    await touch(pointer, 'touchStart', [contact(1, drawPoint.x, drawPoint.y)])
    await releaseTouches(pointer)
    await expect.poll(async () => (await read()).editor.history).toBe(1)
    await expect.poll(async () => (await draft()).length).toBe(points.length + 1)
    await expectEditWork(before)

    before = await work()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await draft()).length).toBe(points.length)
    await expectEditWork(before)

    await page.locator('summary.editor-toolbox-summary').click()

    await page.getByRole('button', { name: 'Move points', exact: true }).click()
    const moveCamera = (await read()).camera
    const control = points[4]
    const screenX = x + (control.x - moveCamera.x) * moveCamera.zoom
    const screenY = y + (control.y - moveCamera.y) * moveCamera.zoom
    before = await work()
    await touch(pointer, 'touchStart', [contact(1, screenX, screenY)])
    await touch(pointer, 'touchMove', [contact(1, screenX + 22, screenY)])
    await expect.poll(async () => (await work()).previews).toBeGreaterThan(before.previews)
    expect(await work()).toMatchObject({ redraws: before.redraws, terrainRedraws: before.terrainRedraws, builds: before.builds })
    expect((await draft())[4].x).toBe(control.x)
    const firstMove = await work()
    await touch(pointer, 'touchMove', [contact(1, screenX + 45, screenY)])
    await expect.poll(async () => (await work()).previews).toBeGreaterThan(firstMove.previews)
    expect(await work()).toMatchObject({ redraws: before.redraws, terrainRedraws: before.terrainRedraws, builds: before.builds })
    await releaseTouches(pointer)
    await expect.poll(async () => (await read()).editor.history).toBe(1)
    await expect.poll(async () => (await draft())[4].x).toBeGreaterThan(control.x + 100)
    await expect.poll(async () => (await work()).terrainRedraws - before.terrainRedraws).toBe(1)
    await expectEditWork(before)

    before = await work()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await draft())[4].x).toBe(control.x)
    await expectEditWork(before)
    // No storage writes should occur for a gesture or its Undo.
    expect(await saved()).toEqual(initiallySaved)
    const beforeSave = await work()
    await page.getByRole('button', { name: 'Save track', exact: true }).click()
    await expect.poll(async () => (await work()).writes - beforeSave.writes).toBe(1)
    await expect.poll(saved).toEqual(await draft())
  } finally {
    await pointer.detach()
  }
})
