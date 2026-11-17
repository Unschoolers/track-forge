import { expect, test } from '@playwright/test'
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
  await page.evaluate(async () => {
    const { EditorScene } = await import('/src/phaser/scenes/EditorScene.ts')
    const { TrackGeometryCache } = await import('/src/domain/track/trackGeometryCache.ts')
    const work = { redraws: 0, builds: 0, writes: 0 }
    window.roadEditWork = work
    const render = EditorScene.prototype.renderWorldPresentation
    EditorScene.prototype.renderWorldPresentation = function (...args) {
      work.redraws++
      return render.apply(this, args)
    }
    const cache = TrackGeometryCache.prototype.set
    TrackGeometryCache.prototype.set = function (...args) {
      work.builds++
      return cache.apply(this, args)
    }
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'trackforge-library-v2') work.writes++
      return setItem.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  await page.getByRole('button', { name: 'EDIT', exact: true }).click()
  const work = () => page.evaluate(() => window.roadEditWork)
  const read = () => page.evaluate(() => window.__trackForgeQa.snapshot())
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('trackforge-library-v2'))[0].points)
  await expect.poll(async () => (await work()).redraws).toBeGreaterThan(0)
  const expectEditWork = async (before) => {
    const after = await work()
    expect(after.redraws - before.redraws).toBe(1)
    expect(after.builds - before.builds).toBeLessThanOrEqual(1)
    expect(after.writes - before.writes).toBe(1)
  }
  const canvas = await page.locator('#game-container canvas').boundingBox()
  const x = canvas.x + canvas.width / 2
  const y = canvas.y + canvas.height / 2
  const pointer = await context.newCDPSession(page)
  try {
    let before = await work()
    await touch(pointer, 'touchStart', [contact(1, x + 150, y + 70)])
    await releaseTouches(pointer)
    await expect.poll(async () => (await read()).editor.history).toBe(1)
    await expect.poll(async () => (await saved()).length).toBe(points.length + 1)
    await expectEditWork(before)

    before = await work()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await saved()).length).toBe(points.length)
    await expectEditWork(before)

    await page.getByRole('button', { name: 'Move points', exact: true }).click()
    const camera = (await read()).camera
    const control = points[4]
    const screenX = x + (control.x - camera.x) * camera.zoom
    const screenY = y + (control.y - camera.y) * camera.zoom
    before = await work()
    await touch(pointer, 'touchStart', [contact(1, screenX, screenY)])
    await touch(pointer, 'touchMove', [contact(1, screenX + 45, screenY)])
    await releaseTouches(pointer)
    await expect.poll(async () => (await read()).editor.history).toBe(1)
    await expect.poll(async () => (await saved())[4].x).toBeGreaterThan(control.x + 100)
    await expectEditWork(before)

    before = await work()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await saved())[4].x).toBe(control.x)
    await expectEditWork(before)
  } finally {
    await pointer.detach()
  }
})

test('can drag the same starter control point twice, then tap for point controls', async ({ page, context }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/?qa')
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  await page.getByRole('button', { name: 'EDIT', exact: true }).click()
  const read = () => page.evaluate(() => window.__trackForgeQa.snapshot())
  await expect.poll(async () => (await read()).camera).not.toBeNull()
  await page.getByRole('button', { name: 'Move points', exact: true }).click()
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('trackforge-library-v2'))[0].points)
  const control = (await saved())[2]
  const camera = (await read()).camera
  const canvas = await page.locator('#game-container canvas').boundingBox()
  const x = canvas.x + canvas.width / 2 + (control.x - camera.x) * camera.zoom
  const y = canvas.y + canvas.height / 2 + (control.y - camera.y) * camera.zoom
  const panel = page.getByRole('complementary', { name: 'Curve point' })
  const pointer = await context.newCDPSession(page)
  try {
    await touch(pointer, 'touchStart', [contact(1, x, y)])
    await touch(pointer, 'touchStart', [contact(2, x + 160, y)])
    await touch(pointer, 'touchMove', [contact(1, x + 40, y), contact(2, x + 200, y)])
    await expect.poll(async () => (await read()).camera.x).not.toBe(camera.x)
    expect((await read()).camera.zoom).toBeCloseTo(camera.zoom, 4)
    await expect(panel).toHaveCount(0)
    await releaseTouches(pointer)
    await page.getByRole('button', { name: 'Fit track', exact: true }).click()
    await expect.poll(async () => (await read()).camera).toEqual(camera)

    await touch(pointer, 'touchStart', [contact(1, x, y)])
    await expect(panel).toHaveCount(0)
    await touch(pointer, 'touchMove', [contact(1, x + 52, y)])
    await releaseTouches(pointer)
    await expect.poll(async () => (await read()).editor.history).toBe(1)
    await expect.poll(async () => (await saved())[2].x).toBeGreaterThan(control.x + 50)

    await touch(pointer, 'touchStart', [contact(1, x + 52, y)])
    await touch(pointer, 'touchMove', [contact(1, x + 100, y)])
    await releaseTouches(pointer)
    await expect.poll(async () => (await read()).editor.history).toBe(2)
    await expect.poll(async () => (await saved())[2].x).toBeGreaterThan(control.x + 200)

    await touch(pointer, 'touchStart', [contact(1, x + 100, y)])
    await releaseTouches(pointer)
    await expect(panel).toBeVisible()
    expect((await read()).editor.history).toBe(2)
  } finally {
    await pointer.detach()
  }
})
