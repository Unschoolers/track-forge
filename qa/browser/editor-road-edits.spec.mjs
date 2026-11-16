import { expect, test } from '@playwright/test'
import { contact, releaseTouches, touch } from './touch.mjs'

test('adds and moves road points on an elevated course with a single redraw per edit frame', async ({ page, context }) => {
  const points = Array.from({ length: 17 }, (_, index) => {
    const angle = (index % 16) * Math.PI / 8
    return {
      x: 860 * Math.cos(angle), y: 1050 * Math.sin(angle), surface: 'street',
      structure: index >= 9 && index <= 13 ? 'overpass' : 'surface',
    }
  })
  const cells = Array.from({ length: 500 }, (_, index) => ({
    column: index % 40 - 20, row: Math.floor(index / 40) - 27, kind: 'hill',
  }))
  await page.setViewportSize({ width: 844, height: 390 })
  await page.addInitScript(({ points, cells }) => {
    localStorage.setItem('trackforge-library-v2', JSON.stringify([{
      id: 'road-edit-stress', name: 'Elevated Road Edit', version: 8, points,
      terrain: { cellSize: 32, cells }, trees: [], createdAt: 1, updatedAt: 1,
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, { points, cells })
  await page.goto('/?qa')
  await page.evaluate(async () => {
    const { EditorScene } = await import('/src/phaser/scenes/EditorScene.ts')
    const original = EditorScene.prototype.renderWorldPresentation
    window.roadEditRedraws = 0
    EditorScene.prototype.renderWorldPresentation = function (...args) {
      window.roadEditRedraws += 1
      return original.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  await page.getByRole('button', { name: 'EDIT', exact: true }).click()
  const redraws = () => page.evaluate(() => window.roadEditRedraws)
  const read = () => page.evaluate(() => window.__trackForgeQa.snapshot())
  await expect.poll(redraws).toBeGreaterThan(0)
  const before = await redraws()
  const canvas = await page.locator('#game-container canvas').boundingBox()
  const x = canvas.x + canvas.width / 2
  const y = canvas.y + canvas.height / 2
  const pointer = await context.newCDPSession(page)
  try {
    await touch(pointer, 'touchStart', [contact(1, x + 150, y + 70)])
    await releaseTouches(pointer)
    await expect.poll(async () => (await read()).editor.history).toBe(1)
    await expect.poll(redraws).toBe(before + 1)

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page.getByRole('button', { name: 'Move points', exact: true }).click()
    const camera = (await read()).camera
    const control = points[4]
    const screenX = x + (control.x - camera.x) * camera.zoom
    const screenY = y + (control.y - camera.y) * camera.zoom
    await touch(pointer, 'touchStart', [contact(1, screenX, screenY)])
    await touch(pointer, 'touchMove', [contact(1, screenX + 45, screenY)])
    await releaseTouches(pointer)
    await expect.poll(async () => (await read()).editor.history).toBe(1)
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('trackforge-library-v2'))[0].points)
    await expect.poll(async () => (await saved())[4].x).toBeGreaterThan(control.x + 100)
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
